import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { paperMutationCoordinator, PaperMutationCoordinator } from '@/application/paper-mutation-coordinator';
import { AnalysisRun, Evidence, PaperAnalysis } from '@/domain/analysis-run';
import { NonEmptyStringSchema, RevisionSchema, UuidSchema } from '@/domain/storage-types';
import { evaluateEvidenceGate } from '@/lib/evidence/finding-gate';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { VaultContext } from '@/lib/storage/vault-path';

const EditableTextBlockSchema = z.strictObject({ block_id: UuidSchema.nullable(), text: NonEmptyStringSchema });
const EditableEvidenceSchema = z.strictObject({ evidence_id: UuidSchema.nullable(), model_quote: NonEmptyStringSchema, model_reported_page: z.number().int().min(1).nullable() });
const EditableFindingSchema = z.strictObject({ finding_id: UuidSchema.nullable(), claim: NonEmptyStringSchema, evidence: z.array(EditableEvidenceSchema) });
const EditablePaperAnalysisSchema = z.strictObject({
  metadata_candidate: z.strictObject({ title: z.string().nullable(), authors: z.array(z.string()), year: z.number().int().nullable(), journal: z.string().nullable(), doi: z.string().nullable() }),
  background: z.array(EditableTextBlockSchema), research_questions: z.array(EditableTextBlockSchema), sample: EditableTextBlockSchema.nullable(), methods: z.array(EditableTextBlockSchema), study_design: z.array(EditableTextBlockSchema), findings: z.array(EditableFindingSchema), user_notes: z.array(EditableTextBlockSchema),
});
export const SaveDraftRequestSchema = z.strictObject({ expected_draft_revision: RevisionSchema, paper_analysis: EditablePaperAnalysisSchema });

export class DraftServiceError extends Error {
  constructor(readonly code: 'RUN_NOT_FOUND' | 'RUN_STATE_INVALID' | 'DRAFT_REVISION_CONFLICT' | 'REQUEST_INVALID', message: string, readonly status: 400 | 404 | 409, readonly details: Record<string, unknown>) {
    super(message); this.name = 'DraftServiceError';
  }
}

function pendingEvidence(evidence: Pick<Evidence, 'evidence_id' | 'finding_id' | 'model_quote' | 'model_reported_page'>): Evidence {
  return { ...evidence, source_quote: null, pdf_page_index: null, display_page_number: null, source_span_start: null, source_span_end: null, normalization_steps: [], locator_status: 'unresolved', verification_status: 'pending', content_hash: null, failure_reason: null };
}

function rebuildAnalysis(previous: PaperAnalysis, editable: z.infer<typeof EditablePaperAnalysisSchema>): PaperAnalysis {
  const rebuildBlocks = (key: 'background' | 'research_questions' | 'methods' | 'study_design' | 'user_notes') => {
    const previousIds = new Set(previous[key].map((block) => block.block_id));
    const ids = new Set<string>();
    return editable[key].map((block) => {
      if (block.block_id !== null && !previousIds.has(block.block_id)) throw new DraftServiceError('REQUEST_INVALID', 'TextBlock ID 不属于当前 Draft。', 400, { field: key });
      const blockId = block.block_id ?? randomUUID();
      if (ids.has(blockId)) throw new DraftServiceError('REQUEST_INVALID', 'TextBlock ID 不得重复。', 400, { field: key });
      ids.add(blockId); return { block_id: blockId, text: block.text };
    });
  };
  const previousSample = previous.sample;
  const sample = editable.sample === null ? null : {
    block_id: editable.sample.block_id ?? randomUUID(), text: editable.sample.text,
  };
  if (editable.sample !== null && editable.sample.block_id !== null && editable.sample.block_id !== previousSample?.block_id) throw new DraftServiceError('REQUEST_INVALID', 'sample block_id 不属于当前 Draft。', 400, { field: 'sample' });
  const findingIds = new Set<string>();
  const findings = editable.findings.map((finding) => {
    const existing = finding.finding_id === null ? null : previous.findings.find((item) => item.finding_id === finding.finding_id);
    if (finding.finding_id !== null && !existing) throw new DraftServiceError('REQUEST_INVALID', 'Finding ID 不属于当前 Draft。', 400, { field: 'findings' });
    const findingId = finding.finding_id ?? randomUUID();
    if (findingIds.has(findingId)) throw new DraftServiceError('REQUEST_INVALID', 'finding_id 不得重复。', 400, { field: 'findings' });
    findingIds.add(findingId);
    const claimChanged = existing?.claim !== finding.claim;
    const evidenceIds = new Set<string>();
    const evidence = finding.evidence.map((item) => {
      const prior = item.evidence_id === null ? null : existing?.evidence.find((value) => value.evidence_id === item.evidence_id);
      if (item.evidence_id !== null && !prior) throw new DraftServiceError('REQUEST_INVALID', 'Evidence ID 不属于当前 Finding。', 400, { field: 'findings' });
      const evidenceId = item.evidence_id ?? randomUUID();
      if (evidenceIds.has(evidenceId)) throw new DraftServiceError('REQUEST_INVALID', 'evidence_id 不得重复。', 400, { field: 'findings' });
      evidenceIds.add(evidenceId);
      if (!prior || claimChanged || prior.model_quote !== item.model_quote || prior.model_reported_page !== item.model_reported_page) {
        return pendingEvidence({ evidence_id: evidenceId, finding_id: findingId, model_quote: item.model_quote, model_reported_page: item.model_reported_page });
      }
      return prior;
    });
    return { finding_id: findingId, claim: finding.claim, evidence };
  });
  return { metadata_candidate: editable.metadata_candidate, background: rebuildBlocks('background'), research_questions: rebuildBlocks('research_questions'), sample, methods: rebuildBlocks('methods'), study_design: rebuildBlocks('study_design'), findings, user_notes: rebuildBlocks('user_notes'), deep_reading: previous.deep_reading };
}

export class DraftService {
  constructor(private readonly coordinator: PaperMutationCoordinator = paperMutationCoordinator) {}

  async save(context: VaultContext, runId: string, value: unknown): Promise<AnalysisRun> {
    const request = SaveDraftRequestSchema.safeParse(value);
    if (!request.success) throw new DraftServiceError('REQUEST_INVALID', 'Draft 请求不符合合同。', 400, { fields: request.error.issues.map((issue) => issue.path.join('.')) });
    const repository = new AnalysisRunRepository(context);
    const current = await repository.findById(runId);
    if (!current) throw new DraftServiceError('RUN_NOT_FOUND', '未找到 AnalysisRun。', 404, { run_id: runId });
    return this.coordinator.runMutation(current.paper_id, async () => {
      const latest = await repository.read(current.paper_id, current.analysis_run_id);
      if (latest.state !== 'draft' || latest.paper_analysis === null) throw new DraftServiceError('RUN_STATE_INVALID', '当前 Run 不可编辑。', 409, { run_id: runId, state: latest.state, action: 'save_draft' });
      if (latest.draft_revision !== request.data.expected_draft_revision) throw new DraftServiceError('DRAFT_REVISION_CONFLICT', 'Draft 已被更新，请重新载入。', 409, { expected_revision: request.data.expected_draft_revision, actual_revision: latest.draft_revision });
      const paperAnalysis = rebuildAnalysis(latest.paper_analysis, request.data.paper_analysis);
      const next = { ...latest, paper_analysis: paperAnalysis, draft_revision: latest.draft_revision + 1, updated_at: new Date().toISOString() };
      return repository.replace({ ...next, evidence_gate: evaluateEvidenceGate(next) });
    });
  }

  async derive(context: VaultContext, runId: string): Promise<AnalysisRun> {
    const repository = new AnalysisRunRepository(context);
    const source = await repository.findById(runId);
    if (!source) throw new DraftServiceError('RUN_NOT_FOUND', '未找到 AnalysisRun。', 404, { run_id: runId });
    if (source.state !== 'finalized' || source.paper_analysis === null) throw new DraftServiceError('RUN_STATE_INVALID', '只有 Finalized Run 可以派生 Draft。', 409, { run_id: runId, state: source.state, action: 'derive_draft' });
    return this.coordinator.runMutation(source.paper_id, () => repository.create({ ...source, analysis_run_id: randomUUID(), state: 'draft', derived_from_run_id: source.analysis_run_id, draft_revision: 1, provider_session_id: null, attempts: [], finalization_context: null, failure_stage: null, failure_message: null, finalized_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
  }
}
