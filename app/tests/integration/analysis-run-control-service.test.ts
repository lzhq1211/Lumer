import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnalyzeCoordinator } from '@/application/analyze-coordinator';
import { AnalysisRunControlService } from '@/application/analysis-run-control-service';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { createVaultContext, initializeVaultLayout, VaultContext } from '@/lib/storage/vault-path';
import { analysisRun, draftRun } from '../helpers/analysis-run-fixture';

let testRoot = '';
let context: VaultContext;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-analysis-control-'));
  const vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
});

afterEach(async () => { await fs.rm(testRoot, { recursive: true, force: true }); });

function runningWithAttempt(overrides: Parameters<typeof analysisRun>[0] = {}) {
  return analysisRun({
    attempts: [{
      attempt_number: 1,
      started_at: '2026-09-01T02:00:00.000Z',
      ended_at: null,
      outcome: 'running',
    }],
    ...overrides,
  });
}

describe('AnalysisRunControlService', () => {
  it('cancels only running Run and prevents a late Draft write from replacing the terminal state', async () => {
    const coordinator = new AnalyzeCoordinator();
    const repository = new AnalysisRunRepository(context);
    const running = await coordinator.createRun(repository, runningWithAttempt());
    const cancelled = await new AnalysisRunControlService(coordinator).cancel(context, running.analysis_run_id);

    expect(cancelled).toMatchObject({ state: 'cancelled', attempts: [{ outcome: 'cancelled', ended_at: expect.any(String) }] });
    await expect(coordinator.replaceRun(repository, draftRun())).rejects.toThrow('cancelled');
    await expect(repository.read(running.paper_id, running.analysis_run_id)).resolves.toEqual(cancelled);
    await expect(new AnalysisRunControlService(coordinator).cancel(context, running.analysis_run_id)).rejects.toMatchObject({ code: 'RUN_STATE_INVALID' });
  });

  it('marks unowned leftover running Runs interrupted while retaining a live in-process Run', async () => {
    const coordinator = new AnalyzeCoordinator();
    const repository = new AnalysisRunRepository(context);
    const live = await coordinator.createRun(repository, analysisRun());
    const leftover = runningWithAttempt({
      analysis_run_id: '323e4567-e89b-42d3-a456-426614174000',
      paper_id: '423e4567-e89b-42d3-a456-426614174000',
    });
    await repository.create(leftover);

    const recovered = await new AnalysisRunControlService(coordinator).interruptUnownedRunning(context);

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      analysis_run_id: leftover.analysis_run_id,
      state: 'interrupted',
      attempts: [{ outcome: 'interrupted', ended_at: expect.any(String) }],
      failure_stage: 'interrupted',
    });
    await expect(repository.read(live.paper_id, live.analysis_run_id)).resolves.toEqual(live);
  });
});
