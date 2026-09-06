import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DraftService } from '@/application/draft-service';
import { draftRun } from '../helpers/analysis-run-fixture';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { createVaultContext, initializeVaultLayout, VaultContext } from '@/lib/storage/vault-path';

let testRoot = '';
let context: VaultContext;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-draft-service-'));
  const vaultPath = path.join(testRoot, 'Vault'); await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath); await initializeVaultLayout(context);
});
afterEach(async () => { await fs.rm(testRoot, { recursive: true, force: true }); });

describe('DraftService', () => {
  it('increments revision and invalidates only edited Evidence', async () => {
    const run = draftRun({ derived_from_run_id: '323e4567-e89b-42d3-a456-426614174000', provider_session_id: null, paper_analysis: {
      ...draftRun().paper_analysis!, findings: [{ finding_id: '423e4567-e89b-42d3-a456-426614174000', claim: 'claim', evidence: [{ evidence_id: '523e4567-e89b-42d3-a456-426614174000', finding_id: '423e4567-e89b-42d3-a456-426614174000', model_quote: 'quote', source_quote: 'quote', model_reported_page: 1, pdf_page_index: 0, display_page_number: 1, source_span_start: 0, source_span_end: 5, normalization_steps: [], locator_status: 'exact', verification_status: 'verified', content_hash: 'a'.repeat(64), failure_reason: null }] }],
    } });
    const repository = new AnalysisRunRepository(context); await repository.create(run);
    const { deep_reading, ...editableBase } = run.paper_analysis!;
    const editable = { ...editableBase, findings: run.paper_analysis!.findings.map((finding) => ({ finding_id: finding.finding_id, claim: finding.claim, evidence: finding.evidence.map((evidence) => ({ evidence_id: evidence.evidence_id, model_quote: 'changed', model_reported_page: evidence.model_reported_page })) })), background: [], research_questions: [], sample: null, methods: [], study_design: [], user_notes: [] };
    const saved = await new DraftService().save(context, run.analysis_run_id, { expected_draft_revision: 1, paper_analysis: editable });
    expect(saved).toMatchObject({ draft_revision: 2, evidence_gate: { status: 'failed' } });
    expect(saved.paper_analysis?.findings[0].evidence[0]).toMatchObject({ verification_status: 'pending', source_quote: null, locator_status: 'unresolved' });
    expect(saved.paper_analysis?.deep_reading).toEqual(deep_reading);
  });
});
