import { analyzeCoordinator } from '@/application/analyze-coordinator';
import { MarkdownSyncService } from '@/application/markdown-sync-service';
import { paperMutationCoordinator, PaperMutationCoordinator } from '@/application/paper-mutation-coordinator';
import { isOverviewRun } from '@/domain/analysis-run';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { VaultContext } from '@/lib/storage/vault-path';

export class FinalizationRecoveryService {
  constructor(private readonly coordinator: PaperMutationCoordinator = paperMutationCoordinator) {}

  async recover(context: VaultContext): Promise<void> {
    const runs = new AnalysisRunRepository(context);
    const papers = new PaperRepository(context);
    for (const run of await runs.listAll()) {
      if (run.state !== 'finalizing') continue;
      await this.coordinator.runMutation(run.paper_id, async () => {
        const current = await runs.read(run.paper_id, run.analysis_run_id);
        if (current.state !== 'finalizing') return;
        const paper = await papers.read(current.paper_id);
        if (paper.current_final_run_id === current.analysis_run_id) {
          await analyzeCoordinator.replaceRun(runs, { ...current, state: 'finalized', finalized_at: current.finalized_at ?? new Date().toISOString(), updated_at: new Date().toISOString() });
          return;
        }
        await analyzeCoordinator.replaceRun(runs, { ...current, state: isOverviewRun(current) ? 'preview' : 'draft', finalization_context: null, failure_stage: 'finalizing', failure_message: 'Final commit 在 Current Final 指针写入前中断。', updated_at: new Date().toISOString() });
      });
    }
    const markdownSync = new MarkdownSyncService();
    for (const paper of await papers.list()) {
      if (!['pending', 'error', 'conflict'].includes(paper.markdown_sync_status) || paper.markdown_sync_context === null || paper.current_final_run_id === null) continue;
      await this.coordinator.runMutation(paper.paper_id, async () => {
        const currentPaper = await papers.read(paper.paper_id);
        if (!['pending', 'error', 'conflict'].includes(currentPaper.markdown_sync_status) || currentPaper.markdown_sync_context === null || currentPaper.current_final_run_id === null) return;
        const currentRun = await runs.read(currentPaper.paper_id, currentPaper.current_final_run_id);
        if (!['finalizing', 'finalized'].includes(currentRun.state)) return;
        await markdownSync.writePending(context, currentPaper, currentRun);
      });
    }
  }
}
