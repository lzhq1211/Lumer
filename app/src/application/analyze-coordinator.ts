import { AnalysisRun, AnalysisRunStateError } from '@/domain/analysis-run';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export class AnalyzeCoordinatorError extends Error {
  constructor(readonly activeRun: Pick<AnalysisRun, 'analysis_run_id' | 'paper_id'>) {
    super('已有论文正在分析。');
    this.name = 'AnalyzeCoordinatorError';
  }
}

export class AnalyzeCoordinator {
  private readonly activeRunMutex = new AsyncMutex();
  private readonly ownedRunningRunIds = new Set<string>();

  async createRun(repository: AnalysisRunRepository, run: AnalysisRun): Promise<AnalysisRun> {
    if (run.state !== 'running') {
      throw new AnalysisRunStateError(run.analysis_run_id, run.state, '创建 Analyze Run');
    }
    return this.activeRunMutex.runExclusive(async () => {
      const activeRun = await repository.findActive();
      if (activeRun) throw new AnalyzeCoordinatorError(activeRun);
      const created = await repository.create(run);
      this.ownedRunningRunIds.add(created.analysis_run_id);
      return created;
    });
  }

  async replaceRun(repository: AnalysisRunRepository, run: AnalysisRun): Promise<AnalysisRun> {
    return this.activeRunMutex.runExclusive(async () => {
      if (run.state === 'finalizing') {
        const activeRun = await repository.findActive();
        if (activeRun && activeRun.analysis_run_id !== run.analysis_run_id) {
          throw new AnalyzeCoordinatorError(activeRun);
        }
      }
      const replaced = await repository.replace(run);
      if (replaced.state === 'running') this.ownedRunningRunIds.add(replaced.analysis_run_id);
      else this.ownedRunningRunIds.delete(replaced.analysis_run_id);
      return replaced;
    });
  }

  async getActiveRun(repository: AnalysisRunRepository): Promise<AnalysisRun | null> {
    return repository.findActive();
  }

  async cancelRun(repository: AnalysisRunRepository, runId: string): Promise<AnalysisRun> {
    return this.activeRunMutex.runExclusive(async () => {
      const run = await repository.findById(runId);
      if (!run) throw new AnalysisRunStateError(runId, 'failed', '取消不存在的 Run');
      if (run.state !== 'running') throw new AnalysisRunStateError(run.analysis_run_id, run.state, '取消分析');
      const now = new Date().toISOString();
      const cancelled = await repository.replace({
        ...run,
        state: 'cancelled',
        attempts: run.attempts.map((attempt, index) => index === run.attempts.length - 1
          ? { ...attempt, ended_at: now, outcome: 'cancelled' }
          : attempt),
        updated_at: now,
      });
      this.ownedRunningRunIds.delete(cancelled.analysis_run_id);
      return cancelled;
    });
  }

  async interruptRun(repository: AnalysisRunRepository, runId: string): Promise<AnalysisRun> {
    return this.activeRunMutex.runExclusive(async () => {
      const run = await repository.findById(runId);
      if (!run) throw new AnalysisRunStateError(runId, 'failed', '中断不存在的 Run');
      if (run.state !== 'running') throw new AnalysisRunStateError(run.analysis_run_id, run.state, '中断分析');
      const now = new Date().toISOString();
      const interrupted = await repository.replace({
        ...run,
        state: 'interrupted',
        attempts: run.attempts.map((attempt, index) => index === run.attempts.length - 1
          ? { ...attempt, ended_at: now, outcome: 'interrupted' }
          : attempt),
        failure_stage: 'interrupted',
        failure_message: '分析流已中断；可以创建新的 Retry Run。',
        updated_at: now,
      });
      this.ownedRunningRunIds.delete(interrupted.analysis_run_id);
      return interrupted;
    });
  }

  async interruptUnownedRunningRuns(repository: AnalysisRunRepository): Promise<AnalysisRun[]> {
    return this.activeRunMutex.runExclusive(async () => {
      const recovered: AnalysisRun[] = [];
      for (const run of await repository.listAll()) {
        if (run.state !== 'running' || this.ownedRunningRunIds.has(run.analysis_run_id)) continue;
        const now = new Date().toISOString();
        recovered.push(await repository.replace({
          ...run,
          state: 'interrupted',
          attempts: run.attempts.map((attempt, index) => index === run.attempts.length - 1
            ? { ...attempt, ended_at: now, outcome: 'interrupted' }
            : attempt),
          failure_stage: 'interrupted',
          failure_message: '分析进程已中断；可以创建新的 Retry Run。',
          updated_at: now,
        }));
      }
      return recovered;
    });
  }
}

export const analyzeCoordinator = new AnalyzeCoordinator();
