import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnalyzeCoordinator, AnalyzeCoordinatorError } from '@/application/analyze-coordinator';
import { MockAnalysisService } from '@/application/mock-analysis-service';
import { ImportPaperService } from '@/application/import-paper-service';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { createVaultContext, initializeVaultLayout, VaultContext } from '@/lib/storage/vault-path';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

let testRoot = '';
let context: VaultContext;
let sourcePath = '';

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-mock-analysis-'));
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

describe('MockAnalysisService', () => {
  it('creates a deterministic Chinese Draft with an original-language pending quote', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    const service = new MockAnalysisService(new AnalyzeCoordinator());

    const draft = await service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });

    expect(draft).toMatchObject({
      paper_id: imported.paper.paper_id,
      state: 'draft',
      draft_revision: 1,
      provider: 'codex',
      model: 'mock-fixture-v1',
      provider_session_id: expect.stringMatching(/^fixture-/),
      attempts: [{ attempt_number: 1, outcome: 'succeeded' }],
      evidence_gate: { status: 'pending', content_hash: expect.any(String) },
    });
    expect(draft.paper_analysis?.background[0].text).toMatch(/模拟分析草稿/);
    expect(draft).toMatchObject({ prompt_version: 'mock-paper-analysis-v1', analysis_schema_version: '1.0.0' });
    expect(JSON.parse(draft.raw_model_output!)).toMatchObject({ summary_language: 'zh-CN', evidence_quote: 'Physical page 1', evidence_page: 1 });
    expect(draft.paper_analysis?.findings[0].evidence[0]).toMatchObject({
      model_quote: 'Physical page 1',
      model_reported_page: 1,
      locator_status: 'unresolved',
      verification_status: 'pending',
    });
    await expect(new AnalysisRunRepository(context).read(imported.paper.paper_id, draft.analysis_run_id)).resolves.toEqual(draft);
    await expect(new AnalysisRunRepository(context).findActive()).resolves.toBeNull();
  });

  it('does not create a second Run while another paper has an active Analyze', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    const coordinator = new AnalyzeCoordinator();
    const repository = new AnalysisRunRepository(context);
    const service = new MockAnalysisService(coordinator);
    const draft = await service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });
    const active = {
      ...draft,
      state: 'running' as const,
      draft_revision: 0,
      raw_model_output: null,
      paper_analysis: null,
      updated_at: draft.created_at,
    };
    await repository.create({ ...active, analysis_run_id: '623e4567-e89b-42d3-a456-426614174000' });
    await expect(service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' }))
      .rejects.toBeInstanceOf(AnalyzeCoordinatorError);
  });

  it('creates a new Run for a user Retry and preserves the terminal source Run', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    const coordinator = new AnalyzeCoordinator();
    const service = new MockAnalysisService(coordinator);
    const baseline = await service.createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });
    const repository = new AnalysisRunRepository(context);
    const source = {
      ...baseline,
      analysis_run_id: '723e4567-e89b-42d3-a456-426614174000',
      state: 'running' as const,
      draft_revision: 0,
      raw_model_output: null,
      paper_analysis: null,
      attempts: [{ attempt_number: 1, started_at: baseline.created_at, ended_at: null, outcome: 'running' as const }],
      failure_stage: null,
      failure_message: null,
    };
    await repository.create(source);
    const failed = await repository.replace({
      ...source,
      state: 'failed' as const,
      attempts: [{ ...source.attempts[0], ended_at: baseline.updated_at, outcome: 'provider_failed' as const }],
      failure_stage: 'failed' as const,
      failure_message: 'Fixture provider failed.',
      updated_at: baseline.updated_at,
    });

    const retry = await service.retryDraft(context, failed.analysis_run_id);

    expect(retry).toMatchObject({ state: 'draft', retry_of_run_id: failed.analysis_run_id, derived_from_run_id: null });
    expect(retry.analysis_run_id).not.toBe(failed.analysis_run_id);
    await expect(repository.read(imported.paper.paper_id, failed.analysis_run_id)).resolves.toEqual(failed);
  });
});
