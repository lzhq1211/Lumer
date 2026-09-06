import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnalyzeCoordinator, AnalyzeCoordinatorError } from '@/application/analyze-coordinator';
import { AnalysisRun } from '@/domain/analysis-run';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { createVaultContext, initializeVaultLayout, VaultContext } from '@/lib/storage/vault-path';
import { analysisRun, draftRun } from '../helpers/analysis-run-fixture';

const SECOND_PAPER_ID = '323e4567-e89b-42d3-a456-426614174000';
const SECOND_RUN_ID = '423e4567-e89b-42d3-a456-426614174000';

let testRoot = '';
let context: VaultContext;

function secondRun(): AnalysisRun {
  return analysisRun({ paper_id: SECOND_PAPER_ID, analysis_run_id: SECOND_RUN_ID });
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-analysis-run-'));
  const vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('AnalysisRunRepository', () => {
  it('persists Run JSON under the paper-scoped canonical path and reads it back', async () => {
    const repository = new AnalysisRunRepository(context);
    const run = analysisRun();

    await repository.create(run);

    expect(await repository.read(run.paper_id, run.analysis_run_id)).toEqual(run);
    expect(await fs.readFile(path.join(context.rootPath, repository.relativePath(run.paper_id, run.analysis_run_id)), 'utf8'))
      .toContain(`\"analysis_run_id\": \"${run.analysis_run_id}\"`);
    expect(await repository.listForPaper(run.paper_id)).toEqual([run]);
    expect(await repository.findActive()).toEqual(run);
  });

  it('读取旧 Run 时丢弃已移除的作者解释和局限性字段', async () => {
    const repository = new AnalysisRunRepository(context);
    const run = draftRun();
    const legacyRun = {
      ...run,
      paper_analysis: { ...run.paper_analysis!, author_interpretation: [{ block_id: '323e4567-e89b-42d3-a456-426614174000', text: '旧字段' }], limitations: [] },
    };
    const filePath = path.join(context.rootPath, repository.relativePath(run.paper_id, run.analysis_run_id));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(legacyRun, null, 2)}\n`);

    const read = await repository.read(run.paper_id, run.analysis_run_id);
    expect(read.paper_analysis).toEqual(run.paper_analysis);
    expect(read.paper_analysis).not.toHaveProperty('author_interpretation');
    expect(read.paper_analysis).not.toHaveProperty('limitations');
  });

  it('rejects invalid state updates and saves only a correctly incremented Draft revision', async () => {
    const repository = new AnalysisRunRepository(context);
    const run = analysisRun();
    await repository.create(run);

    await expect(repository.replace(draftRun())).resolves.toEqual(draftRun());
    await expect(repository.replace(draftRun({ draft_revision: 1, updated_at: '2026-09-01T02:02:00.000Z' })))
      .rejects.toThrow('draft_revision');
    await expect(repository.replace(draftRun({ draft_revision: 2, updated_at: '2026-09-01T02:02:00.000Z' })))
      .resolves.toMatchObject({ state: 'draft', draft_revision: 2 });
  });

  it('atomically admits one global running Run and blocks finalization while another Run is active', async () => {
    const repository = new AnalysisRunRepository(context);
    const coordinator = new AnalyzeCoordinator();
    const [left, right] = await Promise.allSettled([
      coordinator.createRun(repository, analysisRun()),
      coordinator.createRun(repository, secondRun()),
    ]);

    expect([left.status, right.status].filter((status) => status === 'fulfilled')).toHaveLength(1);
    expect([left, right].filter((result) => result.status === 'rejected')[0]?.reason).toBeInstanceOf(AnalyzeCoordinatorError);
    expect((await repository.listAll()).filter((run) => run.state === 'running')).toHaveLength(1);

    const active = await repository.findActive();
    if (!active) throw new Error('expected active run');
    const inactive = active.analysis_run_id === analysisRun().analysis_run_id ? secondRun() : analysisRun();
    await repository.create(draftRun({
      paper_id: inactive.paper_id,
      analysis_run_id: inactive.analysis_run_id,
      derived_from_run_id: '523e4567-e89b-42d3-a456-426614174000',
      provider_session_id: null,
    }));
    const finalizing = draftRun({
      paper_id: inactive.paper_id,
      analysis_run_id: inactive.analysis_run_id,
      derived_from_run_id: '523e4567-e89b-42d3-a456-426614174000',
      provider_session_id: null,
      state: 'finalizing',
      finalization_context: {
        expected_draft_revision: 1,
        expected_paper_record_revision: 1,
        markdown_action: 'create',
        target_card_path: 'Paper Cards/Card--123e4567.md',
        expected_markdown_hash: null,
      },
      updated_at: '2026-09-01T02:02:00.000Z',
    });

    await expect(coordinator.replaceRun(repository, finalizing)).rejects.toBeInstanceOf(AnalyzeCoordinatorError);
  });
});
