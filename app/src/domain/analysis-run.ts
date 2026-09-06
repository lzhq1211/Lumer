import { z } from 'zod';

import {
  addIssue,
  hasUniqueValues,
  isSameOrAfter,
  NonEmptyStringSchema,
  RevisionSchema,
  SchemaVersionSchema,
  Sha256Schema,
  UtcDateTimeSchema,
  UuidSchema,
  VaultRelativePathSchema,
} from '@/domain/storage-types';

export const AnalysisRunStateSchema = z.enum([
  'running',
  'preview',
  'draft',
  'finalizing',
  'finalized',
  'failed',
  'cancelled',
  'interrupted',
]);

export const AnalysisStageSchema = z.enum([
  'validating_pdf',
  'extracting_text',
  'calling_provider',
  'validating_schema',
  'repairing_schema',
  'verifying_evidence',
  'draft_ready',
  'preview_ready',
  'finalizing',
  'save_conflict',
  'final_saved',
  'syncing_markdown',
  'markdown_sync_error',
  'interrupted',
  'failed',
]);

export const AnalysisProviderSchema = z.enum(['codex', 'openai_compatible']);
const DraftRevisionSchema = z.number().int().min(0);
const NullableStringSchema = z.string().nullable();
const PaperCardPathSchema = VaultRelativePathSchema.refine(
  (value) => value.startsWith('Paper Cards/') && value.endsWith('.md') && value.split('/').length === 2,
  '必须位于 Paper Cards/ 且使用 .md 扩展名。',
);

export const TextBlockSchema = z.strictObject({
  block_id: UuidSchema,
  text: NonEmptyStringSchema,
});

export const MetadataCandidateSchema = z.strictObject({
  title: NullableStringSchema,
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  journal: NullableStringSchema,
  doi: NullableStringSchema,
});

const NormalizationStepSchema = z.enum([
  'nfkc',
  'remove_soft_hyphen',
  'collapse_whitespace',
  'join_linebreak_hyphenation',
  'normalize_quotes',
  'normalize_dashes',
]);

const EvidenceFailureReasonSchema = z.enum([
  'content_hash_mismatch',
  'page_out_of_range',
  'ambiguous_match',
  'quote_not_found',
  'cross_page_quote',
  'invalid_span',
]);

export const EvidenceSchema = z.strictObject({
  evidence_id: UuidSchema,
  finding_id: UuidSchema,
  model_quote: NonEmptyStringSchema,
  source_quote: NullableStringSchema,
  model_reported_page: z.number().int().min(1).nullable(),
  pdf_page_index: z.number().int().min(0).nullable(),
  display_page_number: z.number().int().min(1).nullable(),
  source_span_start: z.number().int().min(0).nullable(),
  source_span_end: z.number().int().nullable(),
  normalization_steps: z.array(NormalizationStepSchema),
  locator_status: z.enum(['unresolved', 'exact', 'normalized', 'ambiguous', 'not_found']),
  verification_status: z.enum(['pending', 'verified', 'failed']),
  content_hash: Sha256Schema.nullable(),
  failure_reason: EvidenceFailureReasonSchema.nullable(),
}).superRefine((value, context) => {
  if (value.source_span_end !== null && (value.source_span_start === null || value.source_span_end <= value.source_span_start)) {
    addIssue(context, ['source_span_end'], '必须大于 source_span_start。');
  }
  if (value.pdf_page_index !== null && value.display_page_number !== value.pdf_page_index + 1) {
    addIssue(context, ['display_page_number'], '必须等于 pdf_page_index + 1。');
  }

  const hasLocation = value.source_quote !== null
    && value.pdf_page_index !== null
    && value.display_page_number !== null
    && value.source_span_start !== null
    && value.source_span_end !== null;
  if (value.verification_status === 'verified') {
    if (!['exact', 'normalized'].includes(value.locator_status) || !hasLocation || value.content_hash === null || value.failure_reason !== null) {
      addIssue(context, ['verification_status'], 'verified 必须具有成功唯一定位、完整位置和 content_hash。');
    }
  }
  if (value.verification_status !== 'verified' && hasLocation) {
    addIssue(context, ['source_quote'], '未验证 Evidence 不得保留成功定位字段。');
  }
  if (value.locator_status === 'exact' && value.normalization_steps.length > 0) {
    addIssue(context, ['normalization_steps'], 'exact 定位不得记录 normalization steps。');
  }
  if (value.locator_status === 'ambiguous' || value.locator_status === 'not_found') {
    if (value.verification_status !== 'failed' || value.failure_reason === null) {
      addIssue(context, ['verification_status'], 'ambiguous/not_found 必须是 failed 且具有 failure_reason。');
    }
  }
  if (value.verification_status === 'failed' && value.failure_reason === null) {
    addIssue(context, ['failure_reason'], 'failed 必须具有 failure_reason。');
  }
  if (value.verification_status !== 'failed' && value.failure_reason !== null) {
    addIssue(context, ['failure_reason'], '非 failed Evidence 不得具有 failure_reason。');
  }
});

export const FindingSchema = z.strictObject({
  finding_id: UuidSchema,
  claim: NonEmptyStringSchema,
  evidence: z.array(EvidenceSchema),
});

const DeepReadingTextSchema = z.string().trim().min(1);
const DeepReadingNullableTextSchema = DeepReadingTextSchema.nullable();

export const DeepReadingSchema = z.strictObject({
  bibliographic_metadata: z.strictObject({
    title: DeepReadingNullableTextSchema,
    authors: z.array(DeepReadingTextSchema),
    year: z.number().int().nullable(),
    venue: DeepReadingNullableTextSchema,
    volume: DeepReadingNullableTextSchema,
    issue: DeepReadingNullableTextSchema,
    pages: DeepReadingNullableTextSchema,
    doi: DeepReadingNullableTextSchema,
  }),
  author_profiles: z.array(z.strictObject({
    name: DeepReadingTextSchema,
    affiliation: DeepReadingNullableTextSchema,
    research_areas: z.array(DeepReadingTextSchema),
    source: z.enum(['paper_text', 'unavailable']),
  })),
  core_question: z.strictObject({
    summary: DeepReadingTextSchema,
    technical_terms: z.array(z.strictObject({
      term: DeepReadingTextSchema,
      explanation: DeepReadingTextSchema,
      analogy: DeepReadingNullableTextSchema,
    })),
  }),
  hypotheses: z.array(z.strictObject({
    statement: DeepReadingTextSchema,
    rationale: DeepReadingNullableTextSchema,
    theoretical_basis: DeepReadingNullableTextSchema,
  })),
  research_design: z.strictObject({
    type: DeepReadingNullableTextSchema,
    overview: DeepReadingTextSchema,
    rationale: DeepReadingNullableTextSchema,
    strengths: z.array(DeepReadingTextSchema),
    limitations: z.array(DeepReadingTextSchema),
  }),
  sample: z.strictObject({
    size: DeepReadingNullableTextSchema,
    population: DeepReadingNullableTextSchema,
    demographics: DeepReadingNullableTextSchema,
    recruitment: DeepReadingNullableTextSchema,
    inclusion_criteria: z.array(DeepReadingTextSchema),
    exclusion_criteria: z.array(DeepReadingTextSchema),
    implications: DeepReadingNullableTextSchema,
  }),
  methods: z.array(z.strictObject({
    name: DeepReadingTextSchema,
    procedure: DeepReadingTextSchema,
    purpose: DeepReadingTextSchema,
    rationale: DeepReadingNullableTextSchema,
    strengths: z.array(DeepReadingTextSchema),
    limitations: z.array(DeepReadingTextSchema),
    plain_language_explanation: DeepReadingTextSchema,
  })),
  analysis_pipeline: z.array(z.strictObject({
    step: DeepReadingTextSchema,
    purpose: DeepReadingTextSchema,
    rationale: DeepReadingNullableTextSchema,
    output: DeepReadingTextSchema,
  })),
  analysis_methods: z.array(z.strictObject({
    method: DeepReadingTextSchema,
    metric: DeepReadingNullableTextSchema,
    interpretation: DeepReadingTextSchema,
    why_used: DeepReadingNullableTextSchema,
    formula_note: DeepReadingNullableTextSchema,
  })),
  primary_results: z.array(z.strictObject({
    claim: DeepReadingTextSchema,
    quantitative_results: DeepReadingNullableTextSchema,
    statistical_test: DeepReadingNullableTextSchema,
    effect_size: DeepReadingNullableTextSchema,
    confidence_interval: DeepReadingNullableTextSchema,
    p_value: DeepReadingNullableTextSchema,
    interpretation: DeepReadingTextSchema,
    evidence: z.array(z.strictObject({
      quote: DeepReadingTextSchema,
      page: z.number().int().min(1).nullable(),
    })),
  })),
});

const EmptyDeepReading = {
  bibliographic_metadata: { title: null, authors: [], year: null, venue: null, volume: null, issue: null, pages: null, doi: null },
  author_profiles: [],
  core_question: { summary: '未提供足以概括核心科学问题的论文正文信息。', technical_terms: [] },
  hypotheses: [],
  research_design: { type: null, overview: '未提供足以概述研究设计的论文正文信息。', rationale: null, strengths: [], limitations: [] },
  sample: { size: null, population: null, demographics: null, recruitment: null, inclusion_criteria: [], exclusion_criteria: [], implications: null },
  methods: [],
  analysis_pipeline: [],
  analysis_methods: [],
  primary_results: [],
};

export const PaperAnalysisSchema = z.strictObject({
  metadata_candidate: MetadataCandidateSchema,
  background: z.array(TextBlockSchema),
  research_questions: z.array(TextBlockSchema),
  sample: TextBlockSchema.nullable(),
  methods: z.array(TextBlockSchema),
  study_design: z.array(TextBlockSchema),
  findings: z.array(FindingSchema),
  user_notes: z.array(TextBlockSchema),
  deep_reading: DeepReadingSchema.default(EmptyDeepReading),
}).superRefine((value, context) => {
  const blockIds = [
    ...value.background,
    ...value.research_questions,
    ...(value.sample ? [value.sample] : []),
    ...value.methods,
    ...value.study_design,
    ...value.user_notes,
  ].map((block) => block.block_id);
  if (!hasUniqueValues(blockIds)) addIssue(context, [], 'TextBlock block_id 不得重复。');

  const findingIds = value.findings.map((finding) => finding.finding_id);
  if (!hasUniqueValues(findingIds)) addIssue(context, ['findings'], 'finding_id 不得重复。');
  const evidenceIds = value.findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.evidence_id));
  if (!hasUniqueValues(evidenceIds)) addIssue(context, ['findings'], 'evidence_id 在 Run 内不得重复。');
  value.findings.forEach((finding, findingIndex) => {
    finding.evidence.forEach((evidence, evidenceIndex) => {
      if (evidence.finding_id !== finding.finding_id) {
        addIssue(context, ['findings', findingIndex, 'evidence', evidenceIndex, 'finding_id'], 'Evidence 必须属于其所在 Finding。');
      }
    });
  });
});

const EvidenceGateReasonSchema = z.enum([
  'missing_finding',
  'no_verified_evidence',
  'unverified_evidence',
  'content_hash_mismatch',
]);

const EvidenceGateFindingResultSchema = z.strictObject({
  finding_id: UuidSchema,
  status: z.enum(['passed', 'failed']),
  reasons: z.array(EvidenceGateReasonSchema),
});

export const EvidenceGateSchema = z.strictObject({
  status: z.enum(['pending', 'passed', 'failed']),
  content_hash: Sha256Schema,
  checked_at: UtcDateTimeSchema.nullable(),
  finding_results: z.array(EvidenceGateFindingResultSchema),
}).superRefine((value, context) => {
  if (value.status === 'pending' && value.checked_at !== null) {
    addIssue(context, ['checked_at'], 'pending Gate 的 checked_at 必须为 null。');
  }
  if (value.status !== 'pending' && value.checked_at === null) {
    addIssue(context, ['checked_at'], '已检查 Gate 必须具有 checked_at。');
  }
  if (value.status === 'passed' && (value.finding_results.length === 0 || value.finding_results.some((result) => result.status !== 'passed'))) {
    addIssue(context, ['finding_results'], 'passed Gate 必须含至少一个且全部通过的 Finding。');
  }
  if (value.status === 'failed' && !value.finding_results.some((result) => result.status === 'failed')) {
    addIssue(context, ['finding_results'], 'failed Gate 必须包含失败 Finding。');
  }
});

export const AnalysisAttemptSchema = z.strictObject({
  attempt_number: z.number().int().min(1),
  started_at: UtcDateTimeSchema,
  ended_at: UtcDateTimeSchema.nullable(),
  outcome: z.enum(['running', 'succeeded', 'schema_invalid', 'provider_failed', 'cancelled', 'interrupted']),
}).superRefine((value, context) => {
  if ((value.ended_at === null) !== (value.outcome === 'running')) {
    addIssue(context, [], '进行中 attempt 必须 ended_at=null 且 outcome=running。');
  }
  if (value.ended_at !== null && !isSameOrAfter(value.ended_at, value.started_at)) {
    addIssue(context, ['ended_at'], 'ended_at 不得早于 started_at。');
  }
});

export const FinalizationContextSchema = z.strictObject({
  expected_draft_revision: DraftRevisionSchema,
  expected_paper_record_revision: RevisionSchema,
  markdown_action: z.enum(['create', 'overwrite', 'save_as']),
  target_card_path: PaperCardPathSchema,
  expected_markdown_hash: Sha256Schema.nullable(),
}).superRefine((value, context) => {
  if ((value.markdown_action === 'overwrite') !== (value.expected_markdown_hash !== null)) {
    addIssue(context, ['expected_markdown_hash'], 'overwrite 必须提供 hash，create/save_as 必须为 null。');
  }
});

export const AnalysisRunSchema = z.strictObject({
  schema_version: SchemaVersionSchema,
  analysis_run_id: UuidSchema,
  paper_id: UuidSchema,
  state: AnalysisRunStateSchema,
  retry_of_run_id: UuidSchema.nullable(),
  derived_from_run_id: UuidSchema.nullable(),
  draft_revision: DraftRevisionSchema,
  provider: AnalysisProviderSchema,
  model: NonEmptyStringSchema,
  provider_session_id: NonEmptyStringSchema.nullable(),
  prompt_version: NonEmptyStringSchema,
  analysis_schema_version: NonEmptyStringSchema,
  source_sha256: Sha256Schema,
  content_hash: Sha256Schema,
  raw_model_output: NullableStringSchema,
  paper_analysis: PaperAnalysisSchema.nullable(),
  evidence_gate: EvidenceGateSchema,
  attempts: z.array(AnalysisAttemptSchema),
  finalization_context: FinalizationContextSchema.nullable(),
  failure_stage: AnalysisStageSchema.nullable(),
  failure_message: NullableStringSchema,
  created_at: UtcDateTimeSchema,
  updated_at: UtcDateTimeSchema,
  finalized_at: UtcDateTimeSchema.nullable(),
}).superRefine((value, context) => {
  if (!isSameOrAfter(value.updated_at, value.created_at)) {
    addIssue(context, ['updated_at'], 'updated_at 不得早于 created_at。');
  }
  if (value.retry_of_run_id !== null && value.retry_of_run_id === value.analysis_run_id) {
    addIssue(context, ['retry_of_run_id'], '不得指向自身。');
  }
  if (value.derived_from_run_id !== null && value.derived_from_run_id === value.analysis_run_id) {
    addIssue(context, ['derived_from_run_id'], '不得指向自身。');
  }
  if (value.evidence_gate.content_hash !== value.content_hash) {
    addIssue(context, ['evidence_gate', 'content_hash'], '必须等于 AnalysisRun content_hash。');
  }
  const overview = isOverviewRun(value);
  if (value.provider === 'openai_compatible' && ['draft', 'finalizing', 'finalized'].includes(value.state) && !overview) {
    addIssue(context, ['provider'], 'OpenAI-compatible Provider 不支持结构化 Draft 或 Final。');
  }
  if (overview && (value.state === 'draft' || value.draft_revision !== 0 || value.paper_analysis !== null)) {
    addIssue(context, ['paper_analysis'], '概览保持原始 Markdown、revision 0，不进入结构化 Draft。');
  }
  if (overview && ['preview', 'finalizing', 'finalized'].includes(value.state) && !value.raw_model_output?.trim()) {
    addIssue(context, ['raw_model_output'], '概览必须保留非空完整原文。');
  }
  value.paper_analysis?.findings.forEach((finding, findingIndex) => {
    finding.evidence.forEach((evidence, evidenceIndex) => {
      if (evidence.verification_status === 'verified' && evidence.content_hash !== value.content_hash) {
        addIssue(context, ['paper_analysis', 'findings', findingIndex, 'evidence', evidenceIndex, 'content_hash'], 'verified Evidence 必须等于 AnalysisRun content_hash。');
      }
    });
  });
  value.attempts.forEach((attempt, index) => {
    if (attempt.attempt_number !== index + 1) {
      addIssue(context, ['attempts', index, 'attempt_number'], '必须从 1 连续递增。');
    }
  });
  const runningAttempts = value.attempts.filter((attempt) => attempt.outcome === 'running');
  if (runningAttempts.length > 1 || (runningAttempts.length === 1 && value.attempts.at(-1)?.outcome !== 'running')) {
    addIssue(context, ['attempts'], '最多一个进行中 attempt，且必须位于末尾。');
  }

  if (['draft', 'finalizing', 'finalized'].includes(value.state) && value.paper_analysis === null && !overview) {
    addIssue(context, ['paper_analysis'], 'Draft/Finalizing/Finalized 必须具有 PaperAnalysis。');
  }
  if (['running', 'preview'].includes(value.state) && value.draft_revision !== 0) {
    addIssue(context, ['draft_revision'], 'running/preview Run 的 draft_revision 必须为 0。');
  }
  if (value.state === 'draft' && value.draft_revision < 1) {
    addIssue(context, ['draft_revision'], 'draft Run 的 draft_revision 至少为 1。');
  }
  if (['preview', 'draft', 'finalizing', 'finalized'].includes(value.state) && value.derived_from_run_id === null && value.provider_session_id === null) {
    addIssue(context, ['provider_session_id'], '非派生 Preview/Draft/Final Run 必须具有独占 Provider Session。');
  }
  if ((value.state === 'finalizing' || value.state === 'finalized') !== (value.finalization_context !== null)) {
    addIssue(context, ['finalization_context'], '仅 finalizing/finalized 必须具有 FinalizationContext。');
  }
  if (value.finalization_context !== null && value.finalization_context.expected_draft_revision !== value.draft_revision) {
    addIssue(context, ['finalization_context', 'expected_draft_revision'], '必须等于当前 draft_revision。');
  }
  if (['failed', 'interrupted'].includes(value.state) && (value.failure_stage === null || value.failure_message === null)) {
    addIssue(context, ['failure_stage'], 'failed/interrupted 必须同时具有 failure_stage 与 failure_message。');
  }
  if (!['failed', 'interrupted', 'draft', 'preview'].includes(value.state) && (value.failure_stage !== null || value.failure_message !== null)) {
    addIssue(context, ['failure_stage'], '仅 failed/interrupted 或回退 Draft/Preview 可保留失败信息。');
  }
  if ((value.state === 'finalized') !== (value.finalized_at !== null)) {
    addIssue(context, ['finalized_at'], '仅 finalized 必须具有 finalized_at。');
  }
});

export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;
export type AnalysisRunState = z.infer<typeof AnalysisRunStateSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type EvidenceGate = z.infer<typeof EvidenceGateSchema>;
export type PaperAnalysis = z.infer<typeof PaperAnalysisSchema>;

export function isOverviewRun(run: { analysis_schema_version: string }): boolean {
  return run.analysis_schema_version === 'unstructured-text-v1';
}

const LEGAL_TRANSITIONS: Readonly<Record<AnalysisRunState, readonly AnalysisRunState[]>> = {
  running: ['preview', 'draft', 'failed', 'cancelled', 'interrupted'],
  preview: ['finalizing'],
  draft: ['finalizing'],
  finalizing: ['finalized', 'draft', 'preview'],
  finalized: [],
  failed: [],
  cancelled: [],
  interrupted: [],
};

export function isActiveAnalysisRun(run: Pick<AnalysisRun, 'state'>): boolean {
  return run.state === 'running' || run.state === 'finalizing';
}

export function isLegalAnalysisRunTransition(from: AnalysisRunState, to: AnalysisRunState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export class AnalysisRunStateError extends Error {
  constructor(
    readonly runId: string,
    readonly state: AnalysisRunState,
    readonly action: string,
  ) {
    super(`AnalysisRun ${runId} 无法从 ${state} 执行 ${action}。`);
    this.name = 'AnalysisRunStateError';
  }
}

export class AnalysisRunRevisionError extends Error {
  constructor(
    readonly runId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(`AnalysisRun ${runId} 的 draft_revision 不匹配。`);
    this.name = 'AnalysisRunRevisionError';
  }
}

function hasSameImmutableFields(previous: AnalysisRun, next: AnalysisRun): boolean {
  return previous.schema_version === next.schema_version
    && previous.analysis_run_id === next.analysis_run_id
    && previous.paper_id === next.paper_id
    && previous.retry_of_run_id === next.retry_of_run_id
    && previous.derived_from_run_id === next.derived_from_run_id
    && previous.provider === next.provider
    && previous.prompt_version === next.prompt_version
    && previous.analysis_schema_version === next.analysis_schema_version
    && previous.source_sha256 === next.source_sha256
    && previous.content_hash === next.content_hash
    && previous.created_at === next.created_at;
}

export function assertAnalysisRunCreate(run: AnalysisRun): void {
  if (run.state === 'running' && run.draft_revision === 0) return;
  if (run.state === 'draft' && run.derived_from_run_id !== null && run.draft_revision >= 1) return;
  throw new AnalysisRunStateError(run.analysis_run_id, run.state, 'create');
}

export function assertAnalysisRunUpdate(previous: AnalysisRun, next: AnalysisRun): void {
  if (previous.state === 'preview' || previous.state === 'finalizing') {
    if (previous.raw_model_output !== next.raw_model_output
      || JSON.stringify(previous.paper_analysis) !== JSON.stringify(next.paper_analysis)
      || JSON.stringify(previous.evidence_gate) !== JSON.stringify(next.evidence_gate)) {
      throw new AnalysisRunStateError(previous.analysis_run_id, previous.state, '修改待提交内容');
    }
    if (next.state === 'preview' && !isOverviewRun(previous)) {
      throw new AnalysisRunStateError(previous.analysis_run_id, previous.state, '结构化结果回退概览');
    }
  }
  if (!hasSameImmutableFields(previous, next)) {
    throw new AnalysisRunStateError(previous.analysis_run_id, previous.state, '修改不可变字段');
  }
  if (previous.provider_session_id !== null && previous.provider_session_id !== next.provider_session_id) {
    throw new AnalysisRunStateError(previous.analysis_run_id, previous.state, '替换 Provider Session');
  }
  if (previous.provider_session_id === null && next.provider_session_id !== null && previous.state !== 'running') {
    throw new AnalysisRunStateError(previous.analysis_run_id, previous.state, '建立 Provider Session');
  }
  if (previous.model !== next.model && previous.state !== 'running') {
    throw new AnalysisRunStateError(previous.analysis_run_id, previous.state, '修改 Provider 模型');
  }
  if (isSameOrAfter(previous.updated_at, next.updated_at) && previous.updated_at !== next.updated_at) {
    throw new AnalysisRunStateError(previous.analysis_run_id, previous.state, '回退 updated_at');
  }

  if (previous.state !== next.state && !isLegalAnalysisRunTransition(previous.state, next.state)) {
    throw new AnalysisRunStateError(previous.analysis_run_id, previous.state, `转换至 ${next.state}`);
  }
  if (previous.state === next.state && ['preview', 'finalized', 'failed', 'cancelled', 'interrupted'].includes(previous.state)) {
    throw new AnalysisRunStateError(previous.analysis_run_id, previous.state, '修改终态 Run');
  }

  const expectedRevision = previous.state === 'draft' && next.state === 'draft'
    ? previous.draft_revision + 1
    : previous.state === 'running' && next.state === 'draft'
      ? 1
      : previous.draft_revision;
  if (next.draft_revision !== expectedRevision) {
    throw new AnalysisRunRevisionError(previous.analysis_run_id, expectedRevision, next.draft_revision);
  }
}
