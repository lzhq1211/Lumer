import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyzeCoordinator } from '@/application/analyze-coordinator';
import { AnalysisRunControlService, AnalyzeCancelledError } from '@/application/analysis-run-control-service';
import { CodexAnalysisService } from '@/application/codex-analysis-service';
import { ImportPaperService } from '@/application/import-paper-service';
import { CodexAnalyzeAdapter, CodexExecutionAbortedError, CodexExecutionTimeoutError } from '@/lib/ai-providers/codex-analyze-adapter';
import { OpenAICompatibleAdapter } from '@/lib/ai-providers/openai-compatible-adapter';
import { ProviderRegistry } from '@/lib/ai-providers/provider-registry';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { createVaultContext, initializeVaultLayout, VaultContext } from '@/lib/storage/vault-path';
import { validCodexProviderOutput } from '../helpers/codex-analysis-output';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

let testRoot = '';
let context: VaultContext;
let sourcePath = '';

function availableCodex() {
  return async () => ({ provider: 'codex' as const, installed: true, authenticated: true, available: true, detected_model: null, failure_code: null });
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-codex-analysis-'));
  await generatePdfFixtures(testRoot);
  const vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
  sourcePath = path.join(testRoot, 'single-column.pdf');
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('CodexAnalysisService', () => {
  it('将真实 Provider 边界的结构化结果持久化为可验证 Draft', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    const adapter = new CodexAnalyzeAdapter(async () => ({
      provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
      model: 'unknown',
      final_text: JSON.stringify(validCodexProviderOutput()),
    }));
    const service = new CodexAnalysisService(
      new AnalyzeCoordinator(),
      adapter,
      undefined,
      availableCodex(),
    );

    const draft = await service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });

    expect(draft).toMatchObject({
      state: 'draft', provider: 'codex', model: 'unknown',
      provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
      prompt_version: 'codex-paper-analysis-v1', analysis_schema_version: '1.0.0',
      attempts: [{ outcome: 'succeeded' }],
    });
    expect(draft.paper_analysis?.findings[0]).toMatchObject({ claim: '正文包含可定位的测试描述。' });
    expect(draft.paper_analysis?.findings[0].evidence[0]).toMatchObject({ model_quote: 'Physical page 1', model_reported_page: 1, verification_status: 'pending' });
    expect(draft.paper_analysis?.deep_reading).toMatchObject({
      bibliographic_metadata: { title: '测试论文', volume: null, issue: null, pages: null },
      core_question: { summary: '测试论文要验证结构化精读结果能否持久化。' },
    });
    await expect(new AnalysisRunRepository(context).read(imported.paper.paper_id, draft.analysis_run_id)).resolves.toEqual(draft);
  });

  it('真实概览使用纯文本 Provider 任务并持久化为可见 Preview', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    const requests: Array<{ task_kind: string; session_mode: string; provider_session_id: string | null; system_prompt: string }> = [];
    const adapter = new CodexAnalyzeAdapter(async (request) => {
      requests.push(request);
      return {
        provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
        model: 'gpt-5.6-codex',
        final_text: '## 研究问题\n- 这是一个可见的简短概览。\n\n## 样本与方法\n- 文中未明确。',
      };
    });
    const service = new CodexAnalysisService(new AnalyzeCoordinator(), adapter, undefined, availableCodex());

    const preview = await service.createOverview(context, { paper_id: imported.paper.paper_id, provider: 'codex' });

    expect(requests.map(({ task_kind, session_mode, provider_session_id }) => ({ task_kind, session_mode, provider_session_id }))).toEqual([
      { task_kind: 'overview', session_mode: 'new', provider_session_id: null },
    ]);
    expect(requests[0].system_prompt).toContain('每条内容不超过200字');
    expect(requests[0].system_prompt).not.toContain('作者结论');
    expect(requests[0].system_prompt).not.toContain('局限性、未来启示');
    expect(preview).toMatchObject({
      state: 'preview', provider: 'codex', provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
      prompt_version: 'codex-paper-overview-v3', analysis_schema_version: 'unstructured-text-v1',
      raw_model_output: expect.stringContaining('可见的简短概览'), paper_analysis: null,
      attempts: [{ attempt_number: 1, outcome: 'succeeded' }],
    });
    await expect(new AnalysisRunRepository(context).read(imported.paper.paper_id, preview.analysis_run_id)).resolves.toEqual(preview);
  });

  it('OpenAI-compatible 概览经 Registry 进入只读 Preview，并保存 task/model provenance', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://provider.example/v1/chat/completions');
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer secret-not-persisted' });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: 'remote-model', stream: false });
      expect(body).not.toHaveProperty('api_key');
      return new Response(JSON.stringify({ id: 'task-remote-1', model: 'remote-model', choices: [{ message: { content: '## Remote overview\n\n这是只读概览。' } }] }), { status: 200 });
    });
    const httpAdapter = new OpenAICompatibleAdapter({
      readConfig: () => ({ base_url: 'https://provider.example/v1', model: 'remote-model', api_key: 'secret-not-persisted' }),
      fetchImpl,
    });
    const codexAdapter = new CodexAnalyzeAdapter(async () => ({ provider_session_id: 'codex-session', model: 'unknown', final_text: '' }));
    const status = async (provider: 'codex' | 'openai_compatible') => provider === 'openai_compatible'
      ? { provider, configured: true, installed: null, authenticated: true, available: true, detected_model: 'remote-model', failure_code: null }
      : { provider, configured: true, installed: true, authenticated: true, available: true, detected_model: null, failure_code: null };
    const service = new CodexAnalysisService(
      new AnalyzeCoordinator(),
      codexAdapter,
      undefined,
      status,
      new ProviderRegistry({ codexAdapter, openAICompatibleAdapter: httpAdapter }),
    );

    const preview = await service.createOverview(context, { paper_id: imported.paper.paper_id, provider: 'openai_compatible' });

    expect(preview).toMatchObject({
      state: 'preview', provider: 'openai_compatible', model: 'remote-model', provider_session_id: 'task-remote-1',
      raw_model_output: '## Remote overview\n\n这是只读概览。', paper_analysis: null,
      attempts: [{ outcome: 'succeeded' }],
    });
    expect(await new AnalysisRunRepository(context).read(imported.paper.paper_id, preview.analysis_run_id)).toEqual(preview);
    expect(JSON.stringify(preview)).not.toContain('secret-not-persisted');

    const retry = await service.retryDraft(context, preview.analysis_run_id, undefined, undefined, undefined, 'openai_compatible');
    expect(retry).toMatchObject({
      state: 'preview', provider: 'openai_compatible', retry_of_run_id: preview.analysis_run_id,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('首次结构不合格时仅在同一 Codex Session 中修复一次', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    const requests: Array<{ task_kind: string; session_mode: string; provider_session_id: string | null }> = [];
    const adapter = new CodexAnalyzeAdapter(async (request) => {
      requests.push(request);
      return {
        provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
        model: 'gpt-5.6-codex',
        final_text: request.task_kind === 'analyze'
          ? JSON.stringify({ background: [] })
          : JSON.stringify(validCodexProviderOutput()),
      };
    });
    const service = new CodexAnalysisService(new AnalyzeCoordinator(), adapter, undefined, availableCodex());

    const draft = await service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });

    expect(requests.map(({ task_kind, session_mode, provider_session_id }) => ({ task_kind, session_mode, provider_session_id }))).toEqual([
      { task_kind: 'analyze', session_mode: 'new', provider_session_id: null },
      { task_kind: 'schema_repair', session_mode: 'resume', provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d' },
    ]);
    expect(draft).toMatchObject({
      state: 'draft', provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d', model: 'gpt-5.6-codex',
      attempts: [{ attempt_number: 1, outcome: 'schema_invalid' }, { attempt_number: 2, outcome: 'succeeded' }],
    });
    expect(draft.raw_model_output).toBe(JSON.stringify(validCodexProviderOutput()));
  });

  it('Schema Repair 第二次仍不合格时保存 failed Run 且不再重试', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    let calls = 0;
    const adapter = new CodexAnalyzeAdapter(async () => {
      calls += 1;
      return {
        provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
        model: 'gpt-5.6-codex',
        final_text: JSON.stringify({ background: [] }),
      };
    });
    const service = new CodexAnalysisService(new AnalyzeCoordinator(), adapter, undefined, availableCodex());

    await expect(service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' }))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_INVALID' });

    const [failed] = await new AnalysisRunRepository(context).listForPaper(imported.paper.paper_id);
    expect(calls).toBe(2);
    expect(failed).toMatchObject({
      state: 'failed', failure_stage: 'repairing_schema',
      attempts: [{ attempt_number: 1, outcome: 'schema_invalid' }, { attempt_number: 2, outcome: 'schema_invalid' }],
    });
  });

  it('Provider 协议失败时在同一 Run 内仅重试一次', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    const requests: Array<{ task_kind: string; session_mode: string; provider_session_id: string | null }> = [];
    const adapter = new CodexAnalyzeAdapter(async (request) => {
      requests.push(request);
      if (requests.length === 1) throw new Error('temporary codex failure');
      return {
        provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
        model: 'gpt-5.6-codex',
        final_text: JSON.stringify(validCodexProviderOutput()),
      };
    });
    const service = new CodexAnalysisService(new AnalyzeCoordinator(), adapter, undefined, availableCodex());

    const draft = await service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });

    expect(requests.map(({ task_kind, session_mode, provider_session_id }) => ({ task_kind, session_mode, provider_session_id }))).toEqual([
      { task_kind: 'analyze', session_mode: 'new', provider_session_id: null },
      { task_kind: 'analyze', session_mode: 'new', provider_session_id: null },
    ]);
    expect(draft).toMatchObject({
      state: 'draft', retry_of_run_id: null,
      attempts: [{ attempt_number: 1, outcome: 'provider_failed' }, { attempt_number: 2, outcome: 'succeeded' }],
    });
  });

  it('Provider 重试第二次仍失败时终止同一 Run 且不创建第三次调用', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    let calls = 0;
    const adapter = new CodexAnalyzeAdapter(async () => {
      calls += 1;
      throw new Error('temporary codex failure');
    });
    const service = new CodexAnalysisService(new AnalyzeCoordinator(), adapter, undefined, availableCodex());

    await expect(service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' }))
      .rejects.toMatchObject({ code: 'PROVIDER_PROTOCOL_ERROR' });

    const [failed] = await new AnalysisRunRepository(context).listForPaper(imported.paper.paper_id);
    expect(calls).toBe(2);
    expect(failed).toMatchObject({
      state: 'failed', failure_stage: 'calling_provider',
      attempts: [{ attempt_number: 1, outcome: 'provider_failed' }, { attempt_number: 2, outcome: 'provider_failed' }],
    });
  });

  it('Codex 超过 5 分钟时不再发起第二次 Provider 调用，并将 Run 落为 failed', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    let calls = 0;
    const adapter = new CodexAnalyzeAdapter(async () => {
      calls += 1;
      throw new CodexExecutionTimeoutError();
    });
    const service = new CodexAnalysisService(new AnalyzeCoordinator(), adapter, undefined, availableCodex());

    await expect(service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' }))
      .rejects.toMatchObject({ code: 'PROVIDER_PROTOCOL_ERROR', message: 'Codex Analyze 超过 5 分钟，已停止。' });

    const [failed] = await new AnalysisRunRepository(context).listForPaper(imported.paper.paper_id);
    expect(calls).toBe(1);
    expect(failed).toMatchObject({
      state: 'failed',
      failure_stage: 'calling_provider',
      failure_message: 'Codex Analyze 超过 5 分钟，已停止。',
      attempts: [{ attempt_number: 1, outcome: 'provider_failed', ended_at: expect.any(String) }],
    });
  });

  it('取消先落盘时丢弃 Provider 的迟到成功结果，不把 Run 恢复为 Draft', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    let started!: () => void;
    let finish!: () => void;
    const startedProvider = new Promise<void>((resolve) => { started = resolve; });
    const finishProvider = new Promise<void>((resolve) => { finish = resolve; });
    const adapter = new CodexAnalyzeAdapter(async () => {
      started();
      await finishProvider;
      return {
        provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
        model: 'gpt-5.6-codex',
        final_text: JSON.stringify(validCodexProviderOutput()),
      };
    });
    const coordinator = new AnalyzeCoordinator();
    const service = new CodexAnalysisService(coordinator, adapter, undefined, availableCodex());
    const pending = service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });
    await startedProvider;
    const active = await new AnalysisRunRepository(context).findActive();
    if (!active) throw new Error('expected running Analyze');

    await new AnalysisRunControlService(coordinator).cancel(context, active.analysis_run_id);
    finish();

    await expect(pending).rejects.toBeInstanceOf(AnalyzeCancelledError);
    await expect(new AnalysisRunRepository(context).read(imported.paper.paper_id, active.analysis_run_id)).resolves.toMatchObject({
      state: 'cancelled',
      attempts: [{ outcome: 'cancelled', ended_at: expect.any(String) }],
      paper_analysis: null,
    });
  });

  it('流中断先落盘时丢弃 Provider 的迟到成功结果，并保留 interrupted 终态', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    let started!: () => void;
    let finish!: () => void;
    const startedProvider = new Promise<void>((resolve) => { started = resolve; });
    const finishProvider = new Promise<void>((resolve) => { finish = resolve; });
    const adapter = new CodexAnalyzeAdapter(async () => {
      started();
      await finishProvider;
      return {
        provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
        model: 'gpt-5.6-codex',
        final_text: JSON.stringify(validCodexProviderOutput()),
      };
    });
    const coordinator = new AnalyzeCoordinator();
    const service = new CodexAnalysisService(coordinator, adapter, undefined, availableCodex());
    const pending = service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });
    await startedProvider;
    const active = await new AnalysisRunRepository(context).findActive();
    if (!active) throw new Error('expected running Analyze');

    await new AnalysisRunControlService(coordinator).interrupt(context, active.analysis_run_id);
    finish();

    await expect(pending).rejects.toBeInstanceOf(AnalyzeCancelledError);
    await expect(new AnalysisRunRepository(context).read(imported.paper.paper_id, active.analysis_run_id)).resolves.toMatchObject({
      state: 'interrupted',
      attempts: [{ outcome: 'interrupted', ended_at: expect.any(String) }],
      failure_stage: 'interrupted',
      paper_analysis: null,
    });
  });

  it('SSE 断开信号会中止 Codex task，且不覆盖已持久化的 interrupted 终态', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    let started!: () => void;
    const startedProvider = new Promise<void>((resolve) => { started = resolve; });
    const adapter = new CodexAnalyzeAdapter(async (_request, signal) => {
      started();
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new CodexExecutionAbortedError()), { once: true });
      });
      throw new Error('unreachable');
    });
    const coordinator = new AnalyzeCoordinator();
    const service = new CodexAnalysisService(coordinator, adapter, undefined, availableCodex());
    const abort = new AbortController();
    const pending = service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' }, () => {}, null, () => {}, abort.signal);
    await startedProvider;
    const active = await new AnalysisRunRepository(context).findActive();
    if (!active) throw new Error('expected running Analyze');

    await new AnalysisRunControlService(coordinator).interrupt(context, active.analysis_run_id);
    abort.abort();

    await expect(pending).rejects.toBeInstanceOf(AnalyzeCancelledError);
    await expect(new AnalysisRunRepository(context).read(imported.paper.paper_id, active.analysis_run_id)).resolves.toMatchObject({
      state: 'interrupted',
      attempts: [{ outcome: 'interrupted', ended_at: expect.any(String) }],
      paper_analysis: null,
    });
  });
});
