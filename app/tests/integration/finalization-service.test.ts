import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnalyzeCoordinator } from '@/application/analyze-coordinator';
import { FinalizationRecoveryService } from '@/application/finalization-recovery-service';
import { FinalizationService, FinalizationServiceError } from '@/application/finalization-service';
import { MarkdownSyncService } from '@/application/markdown-sync-service';
import { MockAnalysisService } from '@/application/mock-analysis-service';
import { ImportPaperService } from '@/application/import-paper-service';
import { PaperLibraryService } from '@/application/paper-library-service';
import { evaluateEvidenceGate } from '@/lib/evidence/finding-gate';
import { locateEvidence } from '@/lib/evidence/locate-quote';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { markdownHash } from '@/lib/markdown/paper-card-renderer';
import { createVaultContext, initializeVaultLayout, VaultContext } from '@/lib/storage/vault-path';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

let testRoot = ''; let context: VaultContext; let sourcePath = '';
beforeEach(async () => { testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-final-')); await generatePdfFixtures(testRoot); const vault = path.join(testRoot, 'Vault'); await fs.mkdir(vault); context = await createVaultContext(vault); await initializeVaultLayout(context); sourcePath = path.join(testRoot, 'single-column.pdf'); });
afterEach(async () => { await fs.rm(testRoot, { recursive: true, force: true }); });

async function verifiedDraft() {
  const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
  const run = await new MockAnalysisService(new AnalyzeCoordinator()).createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });
  const extraction = await new ExtractionRepository(context).read(run.paper_id);
  const analysis = { ...run.paper_analysis!, findings: run.paper_analysis!.findings.map((finding) => ({ ...finding, evidence: finding.evidence.map((evidence) => locateEvidence(evidence, extraction)) })) };
  const next = { ...run, paper_analysis: analysis, draft_revision: 2, updated_at: new Date().toISOString() };
  const complete = { ...next, evidence_gate: evaluateEvidenceGate(next) };
  await new AnalysisRunRepository(context).replace(complete);
  return { imported, run: complete };
}

describe('FinalizationService', () => {
  it('commits Current Final and first deterministic Markdown atomically on the happy path', async () => {
    const { imported, run } = await verifiedDraft();
    const result = await new FinalizationService().finalize(context, run.analysis_run_id, { expected_draft_revision: 2, expected_paper_record_revision: imported.paper.record_revision, markdown_action: 'create', expected_markdown_hash: null });
    expect(result).toMatchObject({ committed: true, recovery_required: false, run: { state: 'finalized' }, paper: { current_final_run_id: run.analysis_run_id, markdown_sync_status: 'synced', title: imported.paper.title } });
    const paper = await new PaperRepository(context).read(run.paper_id);
    expect(paper.card_path).not.toBeNull(); expect(await fs.readFile(path.join(context.rootPath, paper.card_path!), 'utf8')).toContain('Physical page 1');
    await expect(new PaperLibraryService().detail(context, run.paper_id)).resolves.toMatchObject({
      current_final: { analysis_run_id: run.analysis_run_id, state: 'finalized', provider: 'codex', model: 'mock-fixture-v1' },
    });
  });

  it('rejects Final before a passing Gate without changing the Draft', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    const run = await new MockAnalysisService(new AnalyzeCoordinator()).createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });
    await expect(new FinalizationService().finalize(context, run.analysis_run_id, { expected_draft_revision: 1, expected_paper_record_revision: 1, markdown_action: 'create', expected_markdown_hash: null })).rejects.toBeInstanceOf(FinalizationServiceError);
    await expect(new AnalysisRunRepository(context).read(run.paper_id, run.analysis_run_id)).resolves.toMatchObject({ state: 'draft' });
  });

  it('does not enter Finalizing when the managed Markdown changed before an overwrite choice', async () => {
    const { imported, run } = await verifiedDraft();
    const first = await new FinalizationService().finalize(context, run.analysis_run_id, { expected_draft_revision: 2, expected_paper_record_revision: imported.paper.record_revision, markdown_action: 'create', expected_markdown_hash: null });
    const cardPath = path.join(context.rootPath, first.paper.card_path!);
    await fs.writeFile(cardPath, '# 外部编辑\n');

    const next = await verifiedDraftFor(imported.paper.paper_id);
    await expect(new FinalizationService().finalize(context, next.analysis_run_id, {
      expected_draft_revision: 2,
      expected_paper_record_revision: first.paper.record_revision,
      markdown_action: 'overwrite',
      expected_markdown_hash: first.paper.markdown_hash,
    })).rejects.toMatchObject({ code: 'MARKDOWN_CONFLICT' });

    await expect(new AnalysisRunRepository(context).read(next.paper_id, next.analysis_run_id)).resolves.toMatchObject({ state: 'draft' });
    await expect(new PaperRepository(context).read(next.paper_id)).resolves.toMatchObject({ current_final_run_id: run.analysis_run_id, markdown_sync_status: 'synced' });
    await expect(fs.readFile(cardPath, 'utf8')).resolves.toBe('# 外部编辑\n');
  });

  it('allows explicit overwrite with the current external hash and replaces the managed Markdown', async () => {
    const { imported, run } = await verifiedDraft();
    const first = await new FinalizationService().finalize(context, run.analysis_run_id, { expected_draft_revision: 2, expected_paper_record_revision: imported.paper.record_revision, markdown_action: 'create', expected_markdown_hash: null });
    const cardPath = path.join(context.rootPath, first.paper.card_path!);
    const external = '# 外部编辑\n'; await fs.writeFile(cardPath, external);
    const next = await verifiedDraftFor(imported.paper.paper_id);

    expect(next).toMatchObject({ state: 'draft', retry_of_run_id: null, derived_from_run_id: null });
    expect(next.analysis_run_id).not.toBe(run.analysis_run_id);
    await expect(new PaperRepository(context).read(run.paper_id)).resolves.toMatchObject({ current_final_run_id: run.analysis_run_id });
    await expect(new AnalysisRunRepository(context).read(run.paper_id, run.analysis_run_id)).resolves.toMatchObject({ state: 'finalized' });

    const second = await new FinalizationService().finalize(context, next.analysis_run_id, {
      expected_draft_revision: 2,
      expected_paper_record_revision: first.paper.record_revision,
      markdown_action: 'overwrite',
      expected_markdown_hash: markdownHash(external),
    });

    expect(second.paper).toMatchObject({ current_final_run_id: next.analysis_run_id, card_path: first.paper.card_path, markdown_sync_status: 'synced' });
    await expect(fs.readFile(cardPath, 'utf8')).resolves.not.toBe(external);
    await expect(new AnalysisRunRepository(context).read(run.paper_id, run.analysis_run_id)).resolves.toMatchObject({ state: 'finalized' });
  });

  it('save-as keeps the externally managed file and switches the canonical card only after writing', async () => {
    const { imported, run } = await verifiedDraft();
    const first = await new FinalizationService().finalize(context, run.analysis_run_id, { expected_draft_revision: 2, expected_paper_record_revision: imported.paper.record_revision, markdown_action: 'create', expected_markdown_hash: null });
    const oldCardPath = path.join(context.rootPath, first.paper.card_path!);
    const external = '# 外部编辑\n'; await fs.writeFile(oldCardPath, external);
    const next = await verifiedDraftFor(imported.paper.paper_id);

    const second = await new FinalizationService().finalize(context, next.analysis_run_id, {
      expected_draft_revision: 2,
      expected_paper_record_revision: first.paper.record_revision,
      markdown_action: 'save_as',
      expected_markdown_hash: null,
    });

    expect(second.paper.card_path).not.toBe(first.paper.card_path);
    expect(second.paper.card_path).toMatch(/--copy-\d{8}-\d{6}\.md$/);
    await expect(fs.readFile(oldCardPath, 'utf8')).resolves.toBe(external);
    await expect(fs.readFile(path.join(context.rootPath, second.paper.card_path!), 'utf8')).resolves.toContain('Physical page 1');
  });

  it('marks a second-hash race as conflict without changing Current Final', async () => {
    const { imported, run } = await verifiedDraft();
    const final = await new FinalizationService().finalize(context, run.analysis_run_id, { expected_draft_revision: 2, expected_paper_record_revision: imported.paper.record_revision, markdown_action: 'create', expected_markdown_hash: null });
    const sync = new MarkdownSyncService(undefined, {
      beforeRename: (targetPath) => fs.writeFile(targetPath, '# rename 前外部编辑\n'),
    });

    const result = await sync.sync(context, run.paper_id, run.analysis_run_id, {
      expected_paper_record_revision: final.paper.record_revision,
      markdown_action: 'overwrite',
      expected_markdown_hash: final.paper.markdown_hash,
    });

    expect(result).toMatchObject({ current_final_run_id: run.analysis_run_id, markdown_sync_status: 'conflict' });
    await expect(fs.readFile(path.join(context.rootPath, final.paper.card_path!), 'utf8')).resolves.toBe('# rename 前外部编辑\n');
  });

  it('rolls back to Draft when PaperRecord commit point fails before the pointer is written', async () => {
    const { imported, run } = await verifiedDraft();
    const service = new FinalizationService(undefined, {
      beforePaperCommit: () => { throw new Error('injected PaperRecord failure'); },
    });

    await expect(service.finalize(context, run.analysis_run_id, {
      expected_draft_revision: run.draft_revision,
      expected_paper_record_revision: imported.paper.record_revision,
      markdown_action: 'create',
      expected_markdown_hash: null,
    })).rejects.toMatchObject({ code: 'FINAL_COMMIT_FAILED' });

    await expect(new AnalysisRunRepository(context).read(run.paper_id, run.analysis_run_id)).resolves.toMatchObject({
      state: 'draft',
      finalization_context: null,
      failure_stage: 'finalizing',
    });
    await expect(new PaperRepository(context).read(run.paper_id)).resolves.toMatchObject({
      current_final_run_id: null,
      markdown_sync_status: 'not_generated',
    });
  });

  it('continues Final when PaperRecord is already committed but its completion confirmation fails', async () => {
    const { imported, run } = await verifiedDraft();
    const result = await new FinalizationService(undefined, {
      afterPaperCommit: () => { throw new Error('injected post-commit confirmation failure'); },
    }).finalize(context, run.analysis_run_id, {
      expected_draft_revision: run.draft_revision,
      expected_paper_record_revision: imported.paper.record_revision,
      markdown_action: 'create',
      expected_markdown_hash: null,
    });

    expect(result).toMatchObject({ committed: true, recovery_required: false, run: { state: 'finalized' }, paper: { current_final_run_id: run.analysis_run_id, markdown_sync_status: 'synced' } });
  });

  it('reports committed recovery when Run finalization fails after the Current Final pointer', async () => {
    const { imported, run } = await verifiedDraft();
    const result = await new FinalizationService(undefined, {
      beforeRunFinalized: () => { throw new Error('injected Run finalization failure'); },
    }).finalize(context, run.analysis_run_id, {
      expected_draft_revision: run.draft_revision,
      expected_paper_record_revision: imported.paper.record_revision,
      markdown_action: 'create',
      expected_markdown_hash: null,
    });

    expect(result).toMatchObject({ committed: true, recovery_required: true, run: { state: 'finalizing' }, paper: { current_final_run_id: run.analysis_run_id, markdown_sync_status: 'pending' } });
    await new FinalizationRecoveryService().recover(context);

    await expect(new AnalysisRunRepository(context).read(run.paper_id, run.analysis_run_id)).resolves.toMatchObject({ state: 'finalized' });
    await expect(new PaperRepository(context).read(run.paper_id)).resolves.toMatchObject({
      current_final_run_id: run.analysis_run_id,
      markdown_sync_status: 'synced',
    });
  });

  it('restores a pre-commit finalizing Run to Draft during recovery', async () => {
    const { run } = await verifiedDraft();
    const finalizing = {
      ...run,
      state: 'finalizing' as const,
      finalization_context: {
        expected_draft_revision: run.draft_revision,
        expected_paper_record_revision: 1,
        markdown_action: 'create' as const,
        target_card_path: 'Paper Cards/recovery--123e4567.md',
        expected_markdown_hash: null,
      },
      updated_at: new Date().toISOString(),
    };
    await new AnalysisRunRepository(context).replace(finalizing);

    await new FinalizationRecoveryService().recover(context);

    await expect(new AnalysisRunRepository(context).read(run.paper_id, run.analysis_run_id)).resolves.toMatchObject({
      state: 'draft',
      finalization_context: null,
      failure_stage: 'finalizing',
    });
  });
});

async function verifiedDraftFor(paperId: string) {
  const run = await new MockAnalysisService(new AnalyzeCoordinator()).createDraft(context, { paper_id: paperId, provider: 'codex' });
  const extraction = await new ExtractionRepository(context).read(run.paper_id);
  const analysis = { ...run.paper_analysis!, findings: run.paper_analysis!.findings.map((finding) => ({ ...finding, evidence: finding.evidence.map((evidence) => locateEvidence(evidence, extraction)) })) };
  const next = { ...run, paper_analysis: analysis, draft_revision: 2, updated_at: new Date().toISOString() };
  const complete = { ...next, evidence_gate: evaluateEvidenceGate(next) };
  await new AnalysisRunRepository(context).replace(complete);
  return complete;
}
