import { AnalysisRun } from '@/domain/analysis-run';

export const PAPER_ID = '123e4567-e89b-42d3-a456-426614174000';
export const RUN_ID = '223e4567-e89b-42d3-a456-426614174000';
export const SHA_256 = 'a'.repeat(64);
export const CREATED_AT = '2026-09-01T02:00:00.000Z';
export const UPDATED_AT = '2026-09-01T02:01:00.000Z';

export function analysisRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return {
    schema_version: 1,
    analysis_run_id: RUN_ID,
    paper_id: PAPER_ID,
    state: 'running',
    retry_of_run_id: null,
    derived_from_run_id: null,
    draft_revision: 0,
    provider: 'codex',
    model: 'unknown',
    provider_session_id: null,
    prompt_version: 'paper-analysis-v1',
    analysis_schema_version: '1.0.0',
    source_sha256: SHA_256,
    content_hash: SHA_256,
    raw_model_output: null,
    paper_analysis: null,
    evidence_gate: {
      status: 'pending',
      content_hash: SHA_256,
      checked_at: null,
      finding_results: [],
    },
    attempts: [],
    finalization_context: null,
    failure_stage: null,
    failure_message: null,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    finalized_at: null,
    ...overrides,
  };
}

export function draftRun(overrides: Partial<AnalysisRun> = {}): AnalysisRun {
  return analysisRun({
    state: 'draft',
    draft_revision: 1,
    provider_session_id: 'session-1',
    paper_analysis: {
      metadata_candidate: { title: null, authors: [], year: null, journal: null, doi: null },
      background: [],
      research_questions: [],
      sample: null,
      methods: [],
      study_design: [],
      findings: [],
      user_notes: [],
      deep_reading: {
        bibliographic_metadata: { title: null, authors: [], year: null, venue: null, volume: null, issue: null, pages: null, doi: null },
        author_profiles: [],
        core_question: { summary: 'Fixture 未提供论文正文。', technical_terms: [] },
        hypotheses: [],
        research_design: { type: null, overview: 'Fixture 未提供研究设计。', rationale: null, strengths: [], limitations: [] },
        sample: { size: null, population: null, demographics: null, recruitment: null, inclusion_criteria: [], exclusion_criteria: [], implications: null },
        methods: [], analysis_pipeline: [], analysis_methods: [], primary_results: [],
      },
    },
    ...overrides,
  });
}
