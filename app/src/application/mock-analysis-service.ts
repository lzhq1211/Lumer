import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { AnalyzeCoordinator } from '@/application/analyze-coordinator';
import { AnalysisRunControlServiceError } from '@/application/analysis-run-control-service';
import type { AnalyzeRunStartedReporter } from '@/application/codex-analysis-service';
import { paperMutationCoordinator, PaperMutationCoordinator } from '@/application/paper-mutation-coordinator';
import { AnalysisRun } from '@/domain/analysis-run';
import { UuidSchema } from '@/domain/storage-types';
import { FixtureAnalyzeProviderAdapter } from '@/lib/ai-providers/fixture-analyze-adapter';
import { collectProviderTask } from '@/lib/ai-providers/task-contract';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { VaultContext } from '@/lib/storage/vault-path';

export const CreateMockAnalysisRunRequestSchema = z.strictObject({
  paper_id: UuidSchema,
  provider: z.literal('codex'),
});

const FixtureAnalyzeResponseSchema = z.strictObject({
  summary_language: z.literal('zh-CN'),
  evidence_quote: z.string().trim().min(1),
  evidence_page: z.number().int().min(1),
});

export class MockAnalysisServiceError extends Error {
  constructor(
    readonly code: 'PAPER_NOT_FOUND' | 'DATA_INTEGRITY_ERROR',
    message: string,
    readonly status: 404 | 500,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MockAnalysisServiceError';
  }
}

function firstFixtureQuote(pages: Array<{ readonly text: string; readonly display_page_number: number }>) {
  for (const page of pages) {
    const quote = page.text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
    if (quote) return { quote, pageNumber: page.display_page_number };
  }
  throw new MockAnalysisServiceError(
    'DATA_INTEGRITY_ERROR',
    '论文正文不包含可用于 Mock Analyze 的引文。',
    500,
    { object_kind: 'extracted_paper' },
  );
}

function createRunningRun(
  paper: { readonly paper_id: string; readonly source_sha256: string },
  extraction: { readonly content_hash: string; readonly pages: Array<{ readonly text: string; readonly display_page_number: number }> },
  provider: 'codex',
  providerResult: { readonly provider_session_id: string; readonly model: string },
  retryOfRunId: string | null = null,
): AnalysisRun {
  const now = new Date().toISOString();
  const analysisRunId = randomUUID();
  return {
    schema_version: 1,
    analysis_run_id: analysisRunId,
    paper_id: paper.paper_id,
    state: 'running',
    retry_of_run_id: retryOfRunId,
    derived_from_run_id: null,
    draft_revision: 0,
    provider,
    model: providerResult.model,
    provider_session_id: providerResult.provider_session_id,
    prompt_version: 'mock-paper-analysis-v1',
    analysis_schema_version: '1.0.0',
    source_sha256: paper.source_sha256,
    content_hash: extraction.content_hash,
    raw_model_output: null,
    paper_analysis: null,
    evidence_gate: {
      status: 'pending',
      content_hash: extraction.content_hash,
      checked_at: null,
      finding_results: [],
    },
    attempts: [{ attempt_number: 1, started_at: now, ended_at: null, outcome: 'running' }],
    finalization_context: null,
    failure_stage: null,
    failure_message: null,
    created_at: now,
    updated_at: now,
    finalized_at: null,
  };
}

function createDraftRun(
  running: AnalysisRun,
  response: z.infer<typeof FixtureAnalyzeResponseSchema>,
  paperTitle: string,
): AnalysisRun {
  const findingId = randomUUID();
  const evidenceId = randomUUID();
  return {
    ...running,
    state: 'draft',
    draft_revision: 1,
    raw_model_output: JSON.stringify(response),
    paper_analysis: {
      metadata_candidate: { title: `${paperTitle}（Mock 候选）`, authors: ['Lumer Fixture'], year: 2026, journal: null, doi: null },
      background: [{ block_id: randomUUID(), text: '这是基于已导入正文生成的确定性模拟分析草稿。' }],
      research_questions: [{ block_id: randomUUID(), text: '论文正文包含哪些可复核的核心描述？' }],
      sample: null,
      methods: [{ block_id: randomUUID(), text: '当前结果来自固定 Mock Analyze fixture，不调用外部 Provider。' }],
      study_design: [],
      findings: [{
        finding_id: findingId,
        claim: '正文中存在一条可供后续验证的原始描述。',
        evidence: [{
          evidence_id: evidenceId,
          finding_id: findingId,
          model_quote: response.evidence_quote,
          source_quote: null,
          model_reported_page: response.evidence_page,
          pdf_page_index: null,
          display_page_number: null,
          source_span_start: null,
          source_span_end: null,
          normalization_steps: [],
          locator_status: 'unresolved',
          verification_status: 'pending',
          content_hash: null,
          failure_reason: null,
        }],
      }],
      user_notes: [],
      deep_reading: {
        bibliographic_metadata: { title: null, authors: [], year: null, venue: null, volume: null, issue: null, pages: null, doi: null },
        author_profiles: [],
        core_question: { summary: '当前 Mock Analyze 仅验证产品主链。', technical_terms: [] },
        hypotheses: [],
        research_design: { type: '固定 Mock', overview: '当前结果来自固定 Mock Analyze fixture，不调用外部 Provider。', rationale: null, strengths: [], limitations: [] },
        sample: { size: null, population: null, demographics: null, recruitment: null, inclusion_criteria: [], exclusion_criteria: [], implications: null },
        methods: [], analysis_pipeline: [], analysis_methods: [], primary_results: [],
      },
    },
    attempts: [{ ...running.attempts[0], ended_at: new Date().toISOString(), outcome: 'succeeded' }],
    updated_at: new Date().toISOString(),
  };
}

function createFixtureProviderOutput(extraction: { readonly pages: Array<{ readonly text: string; readonly display_page_number: number }> }): string {
  const { quote, pageNumber } = firstFixtureQuote(extraction.pages);
  return JSON.stringify({ summary_language: 'zh-CN', evidence_quote: quote, evidence_page: pageNumber });
}

function createAnalyzePrompt(extraction: { readonly pages: Array<{ readonly text: string; readonly display_page_number: number }> }): { system_prompt: string; user_input: string } {
  return {
    system_prompt: '你是 Lumer Paper Card Analyze。总结必须使用简体中文；Evidence quote 必须逐字保留论文原语言。仅返回严格 JSON。',
    user_input: `<untrusted_paper_text>\n${extraction.pages.map((page) => `[physical_page=${page.display_page_number}]\n${page.text}`).join('\n\n')}\n</untrusted_paper_text>`,
  };
}

export class MockAnalysisService {
  constructor(
    private readonly analyzeCoordinator: AnalyzeCoordinator,
    private readonly paperCoordinator: PaperMutationCoordinator = paperMutationCoordinator,
  ) {}

  async createDraft(
    context: VaultContext,
    value: unknown,
    retryOfRunId: string | null = null,
    reportRunStarted: AnalyzeRunStartedReporter = () => {},
  ): Promise<AnalysisRun> {
    const parsed = CreateMockAnalysisRunRequestSchema.safeParse(value);
    if (!parsed.success) {
      throw new MockAnalysisServiceError('DATA_INTEGRITY_ERROR', 'Mock Analyze 请求不符合合同。', 500, { object_kind: 'analysis_request' });
    }
    const { paper_id: paperId, provider } = parsed.data;
    return this.paperCoordinator.runMutation(paperId, async () => {
      const papers = new PaperRepository(context);
      if (!await papers.exists(paperId)) {
        throw new MockAnalysisServiceError('PAPER_NOT_FOUND', '未找到该论文。', 404, { paper_id: paperId });
      }
      const paper = await papers.read(paperId);
      const extractions = new ExtractionRepository(context);
      if (!await extractions.exists(paperId)) {
        throw new MockAnalysisServiceError('DATA_INTEGRITY_ERROR', '论文缺少正文提取结果。', 500, {
          object_kind: 'extracted_paper', paper_id: paperId,
        });
      }
      const extraction = await extractions.read(paperId);
      if (extraction.source_sha256 !== paper.source_sha256) {
        throw new MockAnalysisServiceError('DATA_INTEGRITY_ERROR', '论文与正文提取身份不一致。', 500, {
          object_kind: 'extracted_paper', paper_id: paperId,
        });
      }
      const repository = new AnalysisRunRepository(context);
      const prompt = createAnalyzePrompt(extraction);
      const providerTask = await collectProviderTask(
        new FixtureAnalyzeProviderAdapter(createFixtureProviderOutput(extraction)),
        {
          provider,
          task_kind: 'analyze',
          session_mode: 'new',
          provider_session_id: null,
          model: null,
          ...prompt,
        },
      );
      const response = FixtureAnalyzeResponseSchema.safeParse(JSON.parse(providerTask.result.final_text));
      if (!response.success) {
        throw new MockAnalysisServiceError('DATA_INTEGRITY_ERROR', 'Mock Provider 输出不符合 fixture 合同。', 500, {
          object_kind: 'provider_output', issues: response.error.issues,
        });
      }
      const running = createRunningRun(paper, extraction, provider, providerTask.result, retryOfRunId);
      const draft = createDraftRun(running, response.data, paper.title);
      await this.analyzeCoordinator.createRun(repository, running);
      reportRunStarted(running);
      return this.analyzeCoordinator.replaceRun(repository, draft);
    });
  }

  async retryDraft(context: VaultContext, rawRunId: string, reportRunStarted: AnalyzeRunStartedReporter = () => {}): Promise<AnalysisRun> {
    const runId = UuidSchema.safeParse(rawRunId);
    if (!runId.success) throw new MockAnalysisServiceError('DATA_INTEGRITY_ERROR', 'Retry Run ID 不符合合同。', 500, { object_kind: 'analysis_run' });
    const source = await new AnalysisRunRepository(context).findById(runId.data);
    if (!source) throw new AnalysisRunControlServiceError('RUN_NOT_FOUND', '未找到要 Retry 的 AnalysisRun。', 404, { run_id: runId.data });
    if (!['failed', 'cancelled', 'interrupted'].includes(source.state)) {
      throw new AnalysisRunControlServiceError('RUN_STATE_INVALID', '当前 Run 不可创建 Retry。', 409, { run_id: source.analysis_run_id, state: source.state, action: 'retry' });
    }
    return this.createDraft(context, { paper_id: source.paper_id, provider: source.provider }, source.analysis_run_id, reportRunStarted);
  }
}
