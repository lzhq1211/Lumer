import type { PaperAnalysis } from '@/domain/analysis-run';

type DeepReading = PaperAnalysis['deep_reading'];

export interface PaperAnalysisMarkdownOptions {
  readonly requireVerifiedEvidence?: boolean;
  readonly includeLegacySections?: boolean;
}

function appendOptionalField(lines: string[], label: string, value: string | null): void {
  lines.push(`- ${label}：${value ?? '文中未明确'}`);
}

function appendList(lines: string[], values: readonly string[], emptyLabel = '文中未明确'): void {
  if (values.length === 0) {
    lines.push(`- ${emptyLabel}`);
    return;
  }
  values.forEach((value) => lines.push(`- ${value}`));
}

function appendQuote(lines: string[], quote: string): void {
  quote.split(/\r?\n/).forEach((line) => lines.push(`> ${line}`));
}

function appendDeepReading(lines: string[], deepReading: DeepReading): void {
  const bibliography = deepReading.bibliographic_metadata;
  lines.push('', '## 论文精读');

  lines.push('', '### 基本信息');
  appendOptionalField(lines, '标题', bibliography.title);
  appendList(lines, bibliography.authors.map((author) => `作者：${author}`));
  appendOptionalField(lines, '年份', bibliography.year === null ? null : String(bibliography.year));
  appendOptionalField(lines, '期刊/会议', bibliography.venue);
  appendOptionalField(lines, '卷号', bibliography.volume);
  appendOptionalField(lines, '期号', bibliography.issue);
  appendOptionalField(lines, '页码', bibliography.pages);
  appendOptionalField(lines, 'DOI', bibliography.doi);

  if (deepReading.author_profiles.length > 0) {
    lines.push('', '### 作者背景');
    deepReading.author_profiles.forEach((author) => {
      lines.push('', `**${author.name}**`);
      appendOptionalField(lines, '单位', author.affiliation);
      appendList(lines, author.research_areas.map((area) => `研究方向：${area}`));
      lines.push(`- 信息来源：${author.source === 'paper_text' ? '论文正文' : '文中未明确'}`);
    });
  }

  lines.push('', '### 核心科学问题', deepReading.core_question.summary);
  if (deepReading.core_question.technical_terms.length > 0) {
    lines.push('', '#### 关键术语');
    deepReading.core_question.technical_terms.forEach((term) => {
      lines.push('', `**${term.term}**`, term.explanation);
      appendOptionalField(lines, '类比', term.analogy);
    });
  }

  if (deepReading.hypotheses.length > 0) {
    lines.push('', '### 研究假设与理论构想');
    deepReading.hypotheses.forEach((hypothesis, index) => {
      lines.push('', `#### 假设 ${index + 1}`, hypothesis.statement);
      appendOptionalField(lines, '提出依据', hypothesis.rationale);
      appendOptionalField(lines, '理论基础', hypothesis.theoretical_basis);
    });
  }

  lines.push('', '### 研究设计');
  appendOptionalField(lines, '类型', deepReading.research_design.type);
  lines.push(deepReading.research_design.overview);
  appendOptionalField(lines, '设计依据', deepReading.research_design.rationale);
  lines.push('', '**优势**');
  appendList(lines, deepReading.research_design.strengths);
  lines.push('', '**局限**');
  appendList(lines, deepReading.research_design.limitations);

  lines.push('', '### 样本与数据');
  appendOptionalField(lines, '样本量', deepReading.sample.size);
  appendOptionalField(lines, '总体/对象', deepReading.sample.population);
  appendOptionalField(lines, '人口学特征', deepReading.sample.demographics);
  appendOptionalField(lines, '招募方式', deepReading.sample.recruitment);
  lines.push('', '**纳入标准**');
  appendList(lines, deepReading.sample.inclusion_criteria);
  lines.push('', '**排除标准**');
  appendList(lines, deepReading.sample.exclusion_criteria);
  appendOptionalField(lines, '对结果的影响', deepReading.sample.implications);

  if (deepReading.methods.length > 0) {
    lines.push('', '### 方法与技术');
    deepReading.methods.forEach((method, index) => {
      lines.push('', `#### ${index + 1}. ${method.name}`, method.plain_language_explanation);
      appendOptionalField(lines, '具体流程', method.procedure);
      appendOptionalField(lines, '用途', method.purpose);
      appendOptionalField(lines, '选择依据', method.rationale);
      lines.push('', '**优势**');
      appendList(lines, method.strengths);
      lines.push('', '**局限**');
      appendList(lines, method.limitations);
    });
  }

  if (deepReading.analysis_pipeline.length > 0) {
    lines.push('', '### 分析流程');
    deepReading.analysis_pipeline.forEach((step, index) => {
      lines.push('', `#### 步骤 ${index + 1}：${step.step}`, step.purpose);
      appendOptionalField(lines, '执行依据', step.rationale);
      appendOptionalField(lines, '产出', step.output);
    });
  }

  if (deepReading.analysis_methods.length > 0) {
    lines.push('', '### 数据分析方法');
    deepReading.analysis_methods.forEach((method) => {
      lines.push('', `#### ${method.method}`, method.interpretation);
      appendOptionalField(lines, '指标', method.metric);
      appendOptionalField(lines, '选择原因', method.why_used);
      appendOptionalField(lines, '公式/统计注解', method.formula_note);
    });
  }

  if (deepReading.primary_results.length > 0) {
    lines.push('', '### 主要结果');
    deepReading.primary_results.forEach((result, index) => {
      lines.push('', `#### 结果 ${index + 1}`, result.claim);
      appendOptionalField(lines, '定量结果', result.quantitative_results);
      appendOptionalField(lines, '统计检验', result.statistical_test);
      appendOptionalField(lines, '效应量', result.effect_size);
      appendOptionalField(lines, '置信区间', result.confidence_interval);
      appendOptionalField(lines, 'P 值', result.p_value);
      lines.push('', result.interpretation);
      if (result.evidence.length > 0) {
        lines.push('', '**精读引用（模型输出，需以 Evidence Gate 结果为准）**');
        result.evidence.forEach((evidence) => {
          appendQuote(lines, evidence.quote);
          lines.push(`> 模型报告第 ${evidence.page ?? '未标注'} 页`);
        });
      }
    });
  }
}

export function renderPaperAnalysisMarkdown(
  analysis: PaperAnalysis,
  options: PaperAnalysisMarkdownOptions = {},
): string {
  const requireVerifiedEvidence = options.requireVerifiedEvidence ?? false;
  const includeLegacySections = options.includeLegacySections ?? true;
  const lines = [`# ${analysis.metadata_candidate.title ?? '未命名论文卡片'}`];
  if (includeLegacySections) {
    const sections: Array<[string, Array<{ text: string }>]> = [
      ['背景', analysis.background],
      ['研究问题', analysis.research_questions],
      ['方法', analysis.methods],
      ['研究设计', analysis.study_design],
      ['用户笔记', analysis.user_notes],
    ];
    if (analysis.sample) sections.splice(2, 0, ['样本', [analysis.sample]]);
    for (const [heading, blocks] of sections) {
      if (blocks.length === 0) continue;
      lines.push('', `## ${heading}`, ...blocks.map((block) => block.text));
    }
  }
  lines.push('', '## 主要发现');
  for (const finding of analysis.findings) {
    lines.push('', `### ${finding.claim}`);
    for (const evidence of finding.evidence) {
      if (requireVerifiedEvidence && (!evidence.source_quote || evidence.display_page_number === null)) {
        throw new Error('Verified Evidence is required to render a Paper Card.');
      }
      appendQuote(lines, evidence.source_quote ?? evidence.model_quote);
      lines.push(`> ${evidence.source_quote ? '第' : '模型报告第'} ${evidence.display_page_number ?? evidence.model_reported_page ?? '未标注'} 页`);
    }
  }
  appendDeepReading(lines, analysis.deep_reading);
  return `${lines.join('\n')}\n`;
}
