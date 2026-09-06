import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnalyzeCoordinator } from '@/application/analyze-coordinator';
import { EvidenceVerificationService } from '@/application/evidence-verification-service';
import { ImportPaperService } from '@/application/import-paper-service';
import { MockAnalysisService } from '@/application/mock-analysis-service';
import { createVaultContext, initializeVaultLayout, VaultContext } from '@/lib/storage/vault-path';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

let testRoot = '';
let context: VaultContext;
let sourcePath = '';

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-evidence-verify-'));
  await generatePdfFixtures(testRoot);
  const vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
  sourcePath = path.join(testRoot, 'single-column.pdf');
});

afterEach(async () => { await fs.rm(testRoot, { recursive: true, force: true }); });

describe('EvidenceVerificationService', () => {
  it('locates every Draft Evidence, increments revision and opens the Gate only when all Findings verify', async () => {
    const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
    const draft = await new MockAnalysisService(new AnalyzeCoordinator()).createDraft(context, { paper_id: imported.paper.paper_id, provider: 'codex' });

    const verified = await new EvidenceVerificationService().verify(context, draft.analysis_run_id, { expected_draft_revision: 1 });

    expect(verified).toMatchObject({ state: 'draft', draft_revision: 2, evidence_gate: { status: 'passed' } });
    expect(verified.paper_analysis?.findings[0].evidence[0]).toMatchObject({
      source_quote: 'Physical page 1',
      display_page_number: 1,
      locator_status: 'exact',
      verification_status: 'verified',
    });
  });
});
