import { AnalyzeCoordinator } from '@/application/analyze-coordinator';
import { UuidSchema } from '@/domain/storage-types';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { VaultContext } from '@/lib/storage/vault-path';

export class AnalysisRunControlServiceError extends Error {
  constructor(
    readonly code: 'RUN_NOT_FOUND' | 'RUN_STATE_INVALID' | 'REQUEST_INVALID',
    message: string,
    readonly status: 400 | 404 | 409,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AnalysisRunControlServiceError';
  }
}

export class AnalyzeCancelledError extends Error {
  constructor(readonly runId: string) {
    super('分析已取消。');
    this.name = 'AnalyzeCancelledError';
  }
}

export class AnalysisRunControlService {
  constructor(private readonly coordinator: AnalyzeCoordinator) {}

  async cancel(context: VaultContext, rawRunId: string) {
    const runId = UuidSchema.safeParse(rawRunId);
    if (!runId.success) {
      throw new AnalysisRunControlServiceError('REQUEST_INVALID', 'AnalysisRun ID 不符合合同。', 400, { fields: ['run_id'] });
    }
    const runs = new AnalysisRunRepository(context);
    const existing = await runs.findById(runId.data);
    if (!existing) {
      throw new AnalysisRunControlServiceError('RUN_NOT_FOUND', '未找到 AnalysisRun。', 404, { run_id: runId.data });
    }
    if (existing.state !== 'running') {
      throw new AnalysisRunControlServiceError('RUN_STATE_INVALID', '当前 Run 不可取消。', 409, {
        run_id: existing.analysis_run_id,
        state: existing.state,
        action: 'cancel',
      });
    }
    try {
      return await this.coordinator.cancelRun(runs, runId.data);
    } catch {
      const latest = await runs.findById(runId.data);
      if (!latest) throw new AnalysisRunControlServiceError('RUN_NOT_FOUND', '未找到 AnalysisRun。', 404, { run_id: runId.data });
      throw new AnalysisRunControlServiceError('RUN_STATE_INVALID', '当前 Run 不可取消。', 409, {
        run_id: latest.analysis_run_id,
        state: latest.state,
        action: 'cancel',
      });
    }
  }

  async interruptUnownedRunning(context: VaultContext) {
    return this.coordinator.interruptUnownedRunningRuns(new AnalysisRunRepository(context));
  }

  async interrupt(context: VaultContext, runId: string) {
    try {
      return await this.coordinator.interruptRun(new AnalysisRunRepository(context), runId);
    } catch {
      return null;
    }
  }
}
