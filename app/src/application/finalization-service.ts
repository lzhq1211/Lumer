import { analyzeCoordinator } from '@/application/analyze-coordinator';
import { MarkdownSyncService } from '@/application/markdown-sync-service';
import { paperMutationCoordinator, PaperMutationCoordinator } from '@/application/paper-mutation-coordinator';
import { isOverviewRun } from '@/domain/analysis-run';
import { RevisionSchema, Sha256Schema } from '@/domain/storage-types';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { VaultContext } from '@/lib/storage/vault-path';

export class FinalizationServiceError extends Error {
  constructor(readonly code: 'RUN_NOT_FOUND' | 'RUN_STATE_INVALID' | 'DRAFT_REVISION_CONFLICT' | 'PAPER_RECORD_REVISION_CONFLICT' | 'CONTENT_HASH_MISMATCH' | 'EVIDENCE_GATE_FAILED' | 'FINAL_COMMIT_FAILED', message: string, readonly status: 404 | 409 | 422 | 500, readonly details: Record<string, unknown>) { super(message); this.name = 'FinalizationServiceError'; }
}

export interface FinalizeRequest { expected_draft_revision: number; expected_paper_record_revision: number; markdown_action: 'create' | 'overwrite' | 'save_as'; expected_markdown_hash: string | null }
export interface FinalizationServiceOptions {
  readonly beforePaperCommit?: () => void | Promise<void>;
  readonly afterPaperCommit?: () => void | Promise<void>;
  readonly beforeRunFinalized?: () => void | Promise<void>;
}

export class FinalizationService {
  constructor(
    private readonly coordinator: PaperMutationCoordinator = paperMutationCoordinator,
    private readonly options: FinalizationServiceOptions = {},
  ) {}
  async finalize(context: VaultContext, runId: string, request: FinalizeRequest) {
    if (!Number.isInteger(request.expected_draft_revision) || request.expected_draft_revision < 0) throw new FinalizationServiceError('DRAFT_REVISION_CONFLICT', '结果版本无效。', 409, { run_id: runId });
    RevisionSchema.parse(request.expected_paper_record_revision);
    if ((request.markdown_action === 'overwrite') !== (request.expected_markdown_hash !== null)) throw new FinalizationServiceError('RUN_STATE_INVALID', 'Markdown hash 与写入方式不一致。', 409, { run_id: runId, state: 'draft', action: 'finalize' });
    if (request.expected_markdown_hash) Sha256Schema.parse(request.expected_markdown_hash);
    const runs = new AnalysisRunRepository(context); const source = await runs.findById(runId);
    if (!source) throw new FinalizationServiceError('RUN_NOT_FOUND', '未找到 AnalysisRun。', 404, { run_id: runId });
    return this.coordinator.runMutation(source.paper_id, async () => {
      const run = await runs.read(source.paper_id, runId);
      const overview = isOverviewRun(run);
      if (run.state !== (overview ? 'preview' : 'draft')) throw new FinalizationServiceError('RUN_STATE_INVALID', '当前 Run 不能保存为 Final。', 409, { run_id: runId, state: run.state, action: 'finalize' });
      if (run.draft_revision !== request.expected_draft_revision) throw new FinalizationServiceError('DRAFT_REVISION_CONFLICT', 'Draft 已更新。', 409, { expected_revision: request.expected_draft_revision, actual_revision: run.draft_revision });
      if (!overview && run.evidence_gate.status !== 'passed') throw new FinalizationServiceError('EVIDENCE_GATE_FAILED', 'Evidence Gate 未通过。', 422, { run_id: runId });
      const extraction = await new ExtractionRepository(context).read(run.paper_id);
      if (extraction.content_hash !== run.content_hash) throw new FinalizationServiceError('CONTENT_HASH_MISMATCH', '正文身份已改变。', 409, { paper_id: run.paper_id, run_id: runId });
      const papers = new PaperRepository(context); const paper = await papers.read(run.paper_id);
      if (paper.record_revision !== request.expected_paper_record_revision) throw new FinalizationServiceError('PAPER_RECORD_REVISION_CONFLICT', '论文记录已更新。', 409, { expected_revision: request.expected_paper_record_revision, actual_revision: paper.record_revision });
      const markdownSync = new MarkdownSyncService();
      const markdownContext = await markdownSync.createContext(context, paper, run, request);
      const contextData = { expected_draft_revision: run.draft_revision, expected_paper_record_revision: paper.record_revision, markdown_action: markdownContext.markdown_action, target_card_path: markdownContext.target_card_path, expected_markdown_hash: markdownContext.expected_markdown_hash } as const;
      const finalizing = await analyzeCoordinator.replaceRun(runs, { ...run, state: 'finalizing', finalization_context: contextData, failure_stage: null, failure_message: null, updated_at: new Date().toISOString() });
      let pending: typeof paper;
      try {
        await this.options.beforePaperCommit?.();
        pending = await papers.replace(markdownSync.pendingRecord({ ...paper, current_final_run_id: runId }, markdownContext));
        await this.options.afterPaperCommit?.();
      } catch {
        const committedPaper = await papers.read(run.paper_id).catch(() => null);
        if (committedPaper?.current_final_run_id !== runId) {
          await analyzeCoordinator.replaceRun(runs, {
            ...finalizing,
            state: overview ? 'preview' : 'draft',
            finalization_context: null,
            failure_stage: 'finalizing',
            failure_message: 'Final commit 在 Current Final 指针写入前失败。',
            updated_at: new Date().toISOString(),
          });
          throw new FinalizationServiceError('FINAL_COMMIT_FAILED', 'Final commit 在 Current Final 指针写入前失败。', 500, { run_id: runId });
        }
        pending = committedPaper;
      }
      let finalized: typeof finalizing;
      try {
        await this.options.beforeRunFinalized?.();
        finalized = await analyzeCoordinator.replaceRun(runs, { ...finalizing, state: 'finalized', finalized_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      } catch {
        return { run: finalizing, paper: pending, committed: true, recovery_required: true };
      }
      const synced = await markdownSync.writePending(context, pending, finalized);
      return { run: finalized, paper: synced, committed: true, recovery_required: false };
    });
  }
}
