import { describe, expect, it } from 'vitest';

import {
  AnalysisRunSchema,
  AnalysisRunStateError,
  AnalysisRunRevisionError,
  assertAnalysisRunUpdate,
  isLegalAnalysisRunTransition,
} from '@/domain/analysis-run';
import { analysisRun, draftRun } from '../../tests/helpers/analysis-run-fixture';

describe('AnalysisRun Schema', () => {
  it('accepts the minimal persisted running Run and rejects invalid state field combinations', () => {
    expect(AnalysisRunSchema.parse(analysisRun())).toEqual(analysisRun());
    expect(AnalysisRunSchema.safeParse({ ...analysisRun(), unknown: true }).success).toBe(false);
    expect(AnalysisRunSchema.safeParse({ ...analysisRun(), draft_revision: 1 }).success).toBe(false);
    expect(AnalysisRunSchema.safeParse(draftRun({ provider_session_id: null })).success).toBe(false);
    expect(AnalysisRunSchema.safeParse(analysisRun({ evidence_gate: {
      status: 'pending', content_hash: 'b'.repeat(64), checked_at: null, finding_results: [],
    } })).success).toBe(false);
  });

  it('为缺少深度精读字段的旧 Draft 提供兼容默认值', () => {
    const { deep_reading, ...legacyAnalysis } = draftRun().paper_analysis!;
    expect(deep_reading).toBeDefined();
    const parsed = AnalysisRunSchema.parse({ ...draftRun(), paper_analysis: legacyAnalysis });

    expect(parsed.paper_analysis?.deep_reading).toMatchObject({
      author_profiles: [],
      core_question: { summary: '未提供足以概括核心科学问题的论文正文信息。' },
      primary_results: [],
    });
  });

  it('只允许 OpenAI-compatible Run 停留在纯文本 Preview，不能进入 Draft/Final', () => {
    expect(AnalysisRunSchema.safeParse(draftRun({ provider: 'openai_compatible' })).success).toBe(false);
  });

  it('拒绝已移除的顶层作者解释和局限性字段', () => {
    const paperAnalysis = draftRun().paper_analysis!;
    expect(AnalysisRunSchema.safeParse({
      ...draftRun(),
      paper_analysis: { ...paperAnalysis, author_interpretation: [], limitations: [] },
    }).success).toBe(false);
  });

  it('accepts only the frozen C03 state graph', () => {
    const legal = [
      ['running', 'preview'], ['running', 'draft'], ['running', 'failed'], ['running', 'cancelled'], ['running', 'interrupted'],
      ['draft', 'finalizing'], ['finalizing', 'finalized'], ['finalizing', 'draft'],
    ] as const;
    for (const [from, to] of legal) expect(isLegalAnalysisRunTransition(from, to)).toBe(true);
    expect(isLegalAnalysisRunTransition('draft', 'running')).toBe(false);
    expect(isLegalAnalysisRunTransition('finalized', 'draft')).toBe(false);
    expect(isLegalAnalysisRunTransition('cancelled', 'running')).toBe(false);
    expect(isLegalAnalysisRunTransition('preview', 'draft')).toBe(false);
  });

  it('requires atomic Draft revision increments and preserves terminal/immutable fields', () => {
    const running = analysisRun();
    const firstDraft = draftRun();
    expect(() => assertAnalysisRunUpdate(running, firstDraft)).not.toThrow();

    const savedDraft = draftRun({ draft_revision: 2, updated_at: '2026-09-01T02:02:00.000Z' });
    expect(() => assertAnalysisRunUpdate(firstDraft, savedDraft)).not.toThrow();
    expect(() => assertAnalysisRunUpdate(firstDraft, draftRun())).toThrow(AnalysisRunRevisionError);
    expect(() => assertAnalysisRunUpdate(firstDraft, draftRun({ source_sha256: 'b'.repeat(64) }))).toThrow(AnalysisRunStateError);

    const finalized = draftRun({
      state: 'finalized',
      finalization_context: {
        expected_draft_revision: 1,
        expected_paper_record_revision: 1,
        markdown_action: 'create',
        target_card_path: 'Paper Cards/Card--123e4567.md',
        expected_markdown_hash: null,
      },
      finalized_at: '2026-09-01T02:02:00.000Z',
      updated_at: '2026-09-01T02:02:00.000Z',
    });
    expect(() => assertAnalysisRunUpdate(finalized, finalized)).toThrow(AnalysisRunStateError);
  });
});
