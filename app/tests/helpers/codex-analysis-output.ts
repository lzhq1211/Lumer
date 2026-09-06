export function validCodexProviderOutput(): Record<string, unknown> {
  return {
    metadata_candidate: { title: '测试论文', authors: [], year: null, journal: null, doi: null },
    background: ['论文讨论一个测试主题。'],
    research_questions: ['研究问题是什么？'],
    sample: null,
    methods: ['方法来自正文。'],
    study_design: [],
    findings: [{
      claim: '正文包含可定位的测试描述。',
      evidence: [{ quote: 'Physical page 1', page: 1 }],
    }],
    deep_reading: {
      bibliographic_metadata: {
        title: '测试论文', authors: [], year: null, venue: null,
        volume: null, issue: null, pages: null, doi: null,
      },
      author_profiles: [],
      core_question: { summary: '测试论文要验证结构化精读结果能否持久化。', technical_terms: [] },
      hypotheses: [],
      research_design: {
        type: null,
        overview: '这是用于服务集成测试的固定 Provider 输出。',
        rationale: null,
        strengths: [],
        limitations: [],
      },
      sample: {
        size: null, population: null, demographics: null, recruitment: null,
        inclusion_criteria: [], exclusion_criteria: [], implications: null,
      },
      methods: [],
      analysis_pipeline: [],
      analysis_methods: [],
      primary_results: [],
    },
  };
}
