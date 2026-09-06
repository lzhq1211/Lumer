import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnalyzeCoordinator } from '@/application/analyze-coordinator';
import { ChatService } from '@/application/chat-service';
import { FinalizationService } from '@/application/finalization-service';
import { ImportPaperService } from '@/application/import-paper-service';
import { MockAnalysisService } from '@/application/mock-analysis-service';
import { PaperChatContextError } from '@/application/paper-chat-context-builder';
import { CodexAnalyzeAdapter } from '@/lib/ai-providers/codex-analyze-adapter';
import { OpenAICompatibleAdapter } from '@/lib/ai-providers/openai-compatible-adapter';
import type { OpenAICompatibleConfig } from '@/lib/ai-providers/openai-compatible-config';
import { evaluateEvidenceGate } from '@/lib/evidence/finding-gate';
import { locateEvidence } from '@/lib/evidence/locate-quote';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { ChatSessionRepository } from '@/lib/storage/chat-session-repository';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { apiError } from '@/lib/http/api-response';
import { createVaultContext, initializeVaultLayout, VaultContext } from '@/lib/storage/vault-path';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

let root = '';
let context: VaultContext;
let sourcePath = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-chat-'));
  await generatePdfFixtures(root);
  const vaultPath = path.join(root, 'Vault');
  await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
  sourcePath = path.join(root, 'single-column.pdf');
});

afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

function availableStatus() {
  return { provider: 'codex' as const, installed: true, authenticated: true, available: true, detected_model: null, failure_code: null };
}

function httpAvailableStatus() {
  return { provider: 'openai_compatible' as const, installed: null, authenticated: true, available: true, detected_model: 'fixture-http-model', configured: true };
}

function makeService(
  execute: ConstructorParameters<typeof CodexAnalyzeAdapter>[0],
) {
  return new ChatService(new CodexAnalyzeAdapter(execute), undefined, async () => availableStatus());
}

function makeHttpService(
  fetchImpl: typeof fetch,
  codexExecute: ConstructorParameters<typeof CodexAnalyzeAdapter>[0] = async () => ({ provider_session_id: 'unused', model: 'unused', final_text: 'unused' }),
) {
  const config: OpenAICompatibleConfig = { base_url: 'https://provider.example/v1', model: 'fixture-http-model', api_key: null };
  const httpAdapter = new OpenAICompatibleAdapter({ readConfig: () => config, fetchImpl });
  return new ChatService(new CodexAnalyzeAdapter(codexExecute), undefined, async (provider) => provider === 'openai_compatible' ? httpAvailableStatus() : availableStatus(), httpAdapter);
}

async function finalizedPaper() {
  const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
  const draft = await new MockAnalysisService(new AnalyzeCoordinator()).createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });
  const extraction = await new ExtractionRepository(context).read(draft.paper_id);
  const analysis = {
    ...draft.paper_analysis!,
    findings: draft.paper_analysis!.findings.map((finding) => ({
      ...finding,
      evidence: finding.evidence.map((evidence) => locateEvidence(evidence, extraction)),
    })),
  };
  const next = { ...draft, paper_analysis: analysis, draft_revision: 2, updated_at: new Date().toISOString() };
  const complete = { ...next, evidence_gate: evaluateEvidenceGate(next) };
  await new AnalysisRunRepository(context).replace(complete);
  await new FinalizationService().finalize(context, complete.analysis_run_id, {
    expected_draft_revision: 2,
    expected_paper_record_revision: imported.paper.record_revision,
    markdown_action: 'create',
    expected_markdown_hash: null,
  });
  return { imported, run: complete };
}

const request = { provider: 'codex', message: '请总结正文。', selected_text: null, intent: 'free_chat' } as const;

describe('ChatService 7B', () => {
  it('没有 Final Paper Card 时拒绝且不调用 Provider 或写入 Session', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    let calls = 0;
    const service = makeService(async () => {
      calls += 1;
      return { provider_session_id: 'never', model: 'never', final_text: 'never' };
    });

    await expect(service.send(context, imported.paper.paper_id, request)).rejects.toMatchObject({ code: 'PAPER_CARD_REQUIRED', status: 409 });
    expect(calls).toBe(0);
    await expect(new ChatSessionRepository(context).read(imported.paper.paper_id)).resolves.toBeNull();
  });

  it('Preview/Draft 均不能解锁 Chat', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    await expect(new ChatService().get(context, imported.paper.paper_id)).rejects.toMatchObject({ code: 'PAPER_CARD_REQUIRED' });
    await new MockAnalysisService(new AnalyzeCoordinator()).createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });
    await expect(new ChatService().get(context, imported.paper.paper_id)).rejects.toMatchObject({ code: 'PAPER_CARD_REQUIRED' });
    let calls = 0;
    const service = makeService(async () => {
      calls += 1;
      return { provider_session_id: 'never', model: 'never', final_text: 'never' };
    });
    await expect(service.send(context, imported.paper.paper_id, request)).rejects.toMatchObject({ code: 'PAPER_CARD_REQUIRED' });
    expect(calls).toBe(0);
  });

  it('Finalized 后首轮 new、后续 resume，并携带带物理页码的本地上下文', async () => {
    const { imported } = await finalizedPaper();
    const requests: Array<{ session_mode: string; provider_session_id: string | null; system_prompt: string; user_input: string }> = [];
    const service = makeService(async (providerRequest) => {
      requests.push(providerRequest);
      return { provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d', model: 'unknown', final_text: '这是 Codex 的中文回答。' };
    });

    await service.send(context, imported.paper.paper_id, request);
    const session = await service.send(context, imported.paper.paper_id, { ...request, message: '再解释。' });
    expect(requests.map(({ session_mode, provider_session_id }) => ({ session_mode, provider_session_id }))).toEqual([
      { session_mode: 'new', provider_session_id: null },
      { session_mode: 'resume', provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d' },
    ]);
    expect(requests[0].system_prompt).toContain('不可信数据');
    expect(requests[0].user_input).toContain('<untrusted_paper_text>');
    expect(requests[0].user_input).toContain('[physical_page=1]');
    expect(session.messages).toHaveLength(4);
    await expect(new ChatSessionRepository(context).read(imported.paper.paper_id)).resolves.toMatchObject({
      session_revision: 2,
      sessions: {
        codex: { provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d' },
        openai_compatible: null,
      },
    });
  });

  it('读取旧的 codex-only Session 时自动补齐 HTTP 槽位且不丢消息', async () => {
    const { imported } = await finalizedPaper();
    const now = new Date().toISOString();
    const sessionPath = path.join(context.rootPath, `.lumer/sessions/${imported.paper.paper_id}.json`);
    await fs.writeFile(sessionPath, JSON.stringify({
      schema_version: 1,
      paper_id: imported.paper.paper_id,
      session_revision: 1,
      sessions: {
        codex: {
          session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
          provider: 'codex',
          provider_session_id: 'legacy-session',
          model: 'legacy-model',
          messages: [{ message_id: '1b851f06-040c-40a4-9a10-59a4eb48bc4d', role: 'user', content: '旧消息', created_at: now }],
          created_at: now,
          updated_at: now,
        },
      },
    }));
    const service = makeService(async () => ({ provider_session_id: 'legacy-session', model: 'legacy-model', final_text: '新回答' }));

    const session = await service.send(context, imported.paper.paper_id, request);
    expect(session.messages.map((message) => message.content)).toEqual(['旧消息', '请总结正文。', '新回答']);
    await expect(new ChatSessionRepository(context).read(imported.paper.paper_id)).resolves.toMatchObject({ sessions: { openai_compatible: null } });
  });

  it('重新 Analyze 期间仍以旧的 Current Final 解锁 Chat', async () => {
    const { imported, run } = await finalizedPaper();
    const finalRun = await new AnalysisRunRepository(context).read(imported.paper.paper_id, run.analysis_run_id);
    const now = new Date().toISOString();
    await new AnalysisRunRepository(context).create({
      ...finalRun,
      analysis_run_id: randomUUID(),
      state: 'running',
      draft_revision: 0,
      provider_session_id: null,
      raw_model_output: null,
      paper_analysis: null,
      evidence_gate: { status: 'pending', content_hash: finalRun.content_hash, checked_at: null, finding_results: [] },
      attempts: [{ attempt_number: 1, started_at: now, ended_at: null, outcome: 'running' }],
      finalization_context: null,
      failure_stage: null,
      failure_message: null,
      created_at: now,
      updated_at: now,
      finalized_at: null,
    });
    const service = makeService(async () => ({ provider_session_id: 'old-final-chat', model: 'unknown', final_text: '旧 Final 仍可用' }));

    await expect(service.send(context, imported.paper.paper_id, request)).resolves.toMatchObject({ messages: expect.any(Array) });
  });

  it('Extraction 身份失败时不调用 Provider 或创建 Session', async () => {
    const { imported } = await finalizedPaper();
    const extractionRepository = new ExtractionRepository(context);
    const extraction = await extractionRepository.read(imported.paper.paper_id);
    await fs.writeFile(
      path.join(context.rootPath, extractionRepository.relativePath(imported.paper.paper_id)),
      `${JSON.stringify({ ...extraction, source_sha256: 'b'.repeat(64) })}\n`,
    );
    let calls = 0;
    const service = makeService(async () => {
      calls += 1;
      return { provider_session_id: 'never', model: 'never', final_text: 'never' };
    });

    await expect(service.send(context, imported.paper.paper_id, request)).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
    expect(calls).toBe(0);
    await expect(new ChatSessionRepository(context).read(imported.paper.paper_id)).resolves.toBeNull();
  });

  it('同一 Paper 的并发 Chat 返回 CHAT_ALREADY_ACTIVE', async () => {
    const { imported } = await finalizedPaper();
    let started = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const service = makeService(async () => {
      started = true;
      await held;
      return { provider_session_id: 'concurrent-session', model: 'unknown', final_text: '完成' };
    });

    const first = service.send(context, imported.paper.paper_id, request);
    while (!started) await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(service.send(context, imported.paper.paper_id, request)).rejects.toMatchObject({ code: 'CHAT_ALREADY_ACTIVE', retryable: true });
    release();
    await expect(first).resolves.toMatchObject({ provider_session_id: 'concurrent-session' });
  });

  it('HTTP Chat 每次 new/no-session，重放自身历史并与 Codex 槽位隔离', async () => {
    const { imported } = await finalizedPaper();
    const requests: Array<{ body: Record<string, unknown> }> = [];
    const service = makeHttpService(async (_input, init) => {
      requests.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ id: `http-task-${requests.length}`, choices: [{ message: { content: `HTTP 回答 ${requests.length}` } }] }), { status: 200 });
    });

    await service.send(context, imported.paper.paper_id, { ...request, provider: 'openai_compatible' });
    const second = await service.send(context, imported.paper.paper_id, { ...request, provider: 'openai_compatible', message: '继续解释。' });
    expect(requests).toHaveLength(2);
    expect(requests.map(({ body }) => body.model)).toEqual(['fixture-http-model', 'fixture-http-model']);
    expect(requests.every(({ body }) => body.stream === false)).toBe(true);
    expect(JSON.stringify(requests[1].body.messages)).toContain('HTTP 回答 1');
    expect(JSON.stringify(requests[1].body.messages)).toContain('继续解释。');
    expect(second.provider).toBe('openai_compatible');
    await expect(new ChatSessionRepository(context).read(imported.paper.paper_id)).resolves.toMatchObject({
      sessions: { codex: null, openai_compatible: { provider: 'openai_compatible', provider_session_id: 'http-task-2' } },
    });
  });

  it('HTTP Chat 失败时不 fallback 到 Codex，也不写入 Session', async () => {
    const { imported } = await finalizedPaper();
    let codexCalls = 0;
    const service = makeHttpService(async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }), async () => {
      codexCalls += 1;
      return { provider_session_id: 'must-not-run', model: 'must-not-run', final_text: 'must-not-run' };
    });

    await expect(service.send(context, imported.paper.paper_id, { ...request, provider: 'openai_compatible' })).rejects.toMatchObject({ code: 'PROVIDER_PROTOCOL_ERROR' });
    expect(codexCalls).toBe(0);
    await expect(new ChatSessionRepository(context).read(imported.paper.paper_id)).resolves.toBeNull();
  });

  it('API 错误保留 Chat 上下文超限的安全 details', async () => {
    const response = apiError(new PaperChatContextError(300000));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'CHAT_CONTEXT_LIMIT_EXCEEDED', details: { limit: 250000, actual: 300000 } } });
  });
});
