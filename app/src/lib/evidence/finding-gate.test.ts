import { describe, expect, it } from 'vitest';

import { draftRun } from '../../../tests/helpers/analysis-run-fixture';
import { evaluateEvidenceGate } from '@/lib/evidence/finding-gate';

const HASH = 'a'.repeat(64);

describe('evaluateEvidenceGate', () => {
  it('fails Drafts without a Finding and each Finding without verified Evidence', () => {
    expect(evaluateEvidenceGate(draftRun())).toMatchObject({ status: 'failed', finding_results: [{ reasons: ['missing_finding'] }] });
    const run = draftRun({
      paper_analysis: {
        ...draftRun().paper_analysis!,
        findings: [{ finding_id: '323e4567-e89b-42d3-a456-426614174000', claim: 'claim', evidence: [] }],
      },
    });
    expect(evaluateEvidenceGate(run)).toMatchObject({ status: 'failed', finding_results: [{ reasons: ['no_verified_evidence'] }] });
  });

  it('passes only when every retained Evidence is verified against the current content hash', () => {
    const base = draftRun();
    const verified = {
      evidence_id: '423e4567-e89b-42d3-a456-426614174000', finding_id: '323e4567-e89b-42d3-a456-426614174000', model_quote: 'quote', source_quote: 'quote', model_reported_page: 1, pdf_page_index: 0, display_page_number: 1, source_span_start: 0, source_span_end: 5, normalization_steps: [], locator_status: 'exact' as const, verification_status: 'verified' as const, content_hash: HASH, failure_reason: null,
    };
    const run = draftRun({ paper_analysis: { ...base.paper_analysis!, findings: [{ finding_id: verified.finding_id, claim: 'claim', evidence: [verified] }] } });
    expect(evaluateEvidenceGate(run)).toMatchObject({ status: 'passed', finding_results: [{ status: 'passed', reasons: [] }] });
    expect(evaluateEvidenceGate({ ...run, content_hash: 'b'.repeat(64) })).toMatchObject({ status: 'failed', finding_results: [{ reasons: ['content_hash_mismatch'] }] });
  });
});
