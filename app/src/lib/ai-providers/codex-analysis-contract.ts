import { z } from 'zod';

import { DeepReadingSchema } from '@/domain/analysis-run';

export const CODEX_ANALYSIS_PROMPT_VERSION = 'codex-paper-analysis-v1';
export const CODEX_ANALYSIS_SCHEMA_VERSION = '1.0.0';
export const CODEX_OVERVIEW_PROMPT_VERSION = 'codex-paper-overview-v3';
export const CODEX_OVERVIEW_SCHEMA_VERSION = 'unstructured-text-v1';

const NonEmptyTextSchema = z.string().trim().min(1);
const NullableTextSchema = NonEmptyTextSchema.nullable();
const TextArraySchema = z.array(NonEmptyTextSchema);

export const CodexPaperAnalysisOutputSchema = z.strictObject({
  metadata_candidate: z.strictObject({
    title: NullableTextSchema,
    authors: TextArraySchema,
    year: z.number().int().nullable(),
    journal: NullableTextSchema,
    doi: NullableTextSchema,
  }),
  background: TextArraySchema,
  research_questions: TextArraySchema,
  sample: NullableTextSchema,
  methods: TextArraySchema,
  study_design: TextArraySchema,
  findings: z.array(z.strictObject({
    claim: NonEmptyTextSchema,
    evidence: z.array(z.strictObject({
      quote: NonEmptyTextSchema,
      page: z.number().int().min(1).nullable(),
    })),
  })),
  deep_reading: DeepReadingSchema,
});

export type CodexPaperAnalysisOutput = z.infer<typeof CodexPaperAnalysisOutputSchema>;

export const codexPaperAnalysisOutputJsonSchema = z.toJSONSchema(
  CodexPaperAnalysisOutputSchema,
  { target: 'draft-7' },
);
