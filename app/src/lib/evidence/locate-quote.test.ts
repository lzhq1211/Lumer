import { describe, expect, it } from 'vitest';

import { Evidence } from '@/domain/analysis-run';
import { ExtractedPaper } from '@/domain/paper';
import { locateEvidence } from '@/lib/evidence/locate-quote';

const HASH = 'a'.repeat(64);
const evidence = (quote: string, page: number | null = 1): Evidence => ({
  evidence_id: '123e4567-e89b-42d3-a456-426614174000',
  finding_id: '223e4567-e89b-42d3-a456-426614174000',
  model_quote: quote,
  source_quote: null,
  model_reported_page: page,
  pdf_page_index: null,
  display_page_number: null,
  source_span_start: null,
  source_span_end: null,
  normalization_steps: [],
  locator_status: 'unresolved',
  verification_status: 'pending',
  content_hash: null,
  failure_reason: null,
});
const extraction = (pages: string[]): ExtractedPaper => ({
  schema_version: 1,
  extraction_version: 'fixture-v1',
  paper_id: '323e4567-e89b-42d3-a456-426614174000',
  source_sha256: HASH,
  content_hash: HASH,
  page_count: pages.length,
  extracted_char_count: pages.join('').length,
  pages: pages.map((text, index) => ({ pdf_page_index: index, display_page_number: index + 1, text })),
  created_at: '2026-09-01T02:00:00.000Z',
});

describe('locateEvidence', () => {
  it('locates exact text on the reported physical page with original UTF-16 offsets', () => {
    const result = locateEvidence(evidence('beta gamma'), extraction(['Alpha beta gamma delta.']));
    expect(result).toMatchObject({ locator_status: 'exact', verification_status: 'verified', pdf_page_index: 0, source_span_start: 6, source_span_end: 16 });
  });

  it('uses only the frozen normalized transformations and preserves the original source quote', () => {
    const result = locateEvidence(evidence('beta gamma'), extraction(['Alpha beta\n  gamma delta.']));
    expect(result).toMatchObject({ locator_status: 'normalized', verification_status: 'verified', source_quote: 'beta\n  gamma', normalization_steps: ['collapse_whitespace'] });
  });

  it('corrects a wrong page only for a unique full-document match', () => {
    const result = locateEvidence(evidence('target', 1), extraction(['other', 'target']));
    expect(result).toMatchObject({ verification_status: 'verified', pdf_page_index: 1, display_page_number: 2 });
  });

  it('fails closed for ambiguous, absent, and cross-page quotes', () => {
    expect(locateEvidence(evidence('target', null), extraction(['target', 'target']))).toMatchObject({ locator_status: 'ambiguous', failure_reason: 'ambiguous_match' });
    expect(locateEvidence(evidence('missing'), extraction(['target']))).toMatchObject({ locator_status: 'not_found', failure_reason: 'quote_not_found' });
    expect(locateEvidence(evidence('target', null), extraction(['tar', 'get']))).toMatchObject({ locator_status: 'not_found', failure_reason: 'cross_page_quote' });
  });
});
