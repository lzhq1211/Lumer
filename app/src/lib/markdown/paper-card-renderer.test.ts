import { describe, expect, it } from 'vitest';

import { draftRun } from '../../../tests/helpers/analysis-run-fixture';
import { markdownHash, renderPaperCard } from '@/lib/markdown/paper-card-renderer';

describe('renderPaperCard', () => {
  it('is deterministic and preserves verified original-language Evidence', () => {
    const run = draftRun({ paper_analysis: { ...draftRun().paper_analysis!, findings: [{ finding_id: '323e4567-e89b-42d3-a456-426614174000', claim: '中文发现', evidence: [{ evidence_id: '423e4567-e89b-42d3-a456-426614174000', finding_id: '323e4567-e89b-42d3-a456-426614174000', model_quote: 'Alpha beta', source_quote: 'Alpha beta', model_reported_page: 1, pdf_page_index: 0, display_page_number: 1, source_span_start: 0, source_span_end: 10, normalization_steps: [], locator_status: 'exact', verification_status: 'verified', content_hash: 'a'.repeat(64), failure_reason: null }] }] } });
    const first = renderPaperCard(run); const second = renderPaperCard(run);
    expect(first).toContain('> Alpha beta'); expect(first).toContain('> 第 1 页'); expect(markdownHash(first)).toBe(markdownHash(second));
  });

  it('renders the complete deep reading as readable Markdown', () => {
    const run = draftRun({
      paper_analysis: {
        ...draftRun().paper_analysis!,
        deep_reading: {
          ...draftRun().paper_analysis!.deep_reading,
          bibliographic_metadata: {
            ...draftRun().paper_analysis!.deep_reading.bibliographic_metadata,
            title: '完整论文标题', authors: ['作者甲'], venue: '测试期刊',
          },
          author_profiles: [{ name: '作者甲', affiliation: '测试大学', research_areas: ['脑电'], source: 'paper_text' }],
          core_question: {
            summary: '这是核心问题。',
            technical_terms: [{ term: 'EEG', explanation: '脑电信号。', analogy: '像脑部活动的电压记录。' }],
          },
          analysis_pipeline: [{ step: '预处理', purpose: '清理信号。', rationale: null, output: '清洁数据。' }],
          primary_results: [{
            claim: '主要结果成立。', quantitative_results: '准确率 90%', statistical_test: 't 检验',
            effect_size: null, confidence_interval: null, p_value: 'p < .01', interpretation: '结果具有统计意义。',
            evidence: [{ quote: 'The result was significant.', page: 2 }],
          }],
        },
      },
    });
    const markdown = renderPaperCard(run);
    expect(markdown).toContain('## 论文精读');
    expect(markdown).toContain('### 作者背景');
    expect(markdown).toContain('### 核心科学问题');
    expect(markdown).toContain('### 分析流程');
    expect(markdown).toContain('### 主要结果');
    expect(markdown).toContain('准确率 90%');
    expect(markdown).toContain('The result was significant.');
  });
});
