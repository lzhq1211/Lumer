import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import {
  CODEX_ANALYSIS_PROMPT_VERSION,
  CODEX_ANALYSIS_SCHEMA_VERSION,
  CODEX_OVERVIEW_PROMPT_VERSION,
  CODEX_OVERVIEW_SCHEMA_VERSION,
  CodexPaperAnalysisOutputSchema,
  codexPaperAnalysisOutputJsonSchema,
} from '@/lib/ai-providers/codex-analysis-contract';
import { outputSchemaForTask } from '@/lib/ai-providers/codex-analyze-adapter';
import { validCodexProviderOutput } from '../helpers/codex-analysis-output';

type JsonObject = Record<string, unknown>;

const validateJsonSchema = new Ajv({ allErrors: true }).compile(codexPaperAnalysisOutputJsonSchema);

function cloneFixture(): JsonObject {
  return structuredClone(validCodexProviderOutput());
}

function expectRejectedByBoth(value: unknown): void {
  expect(CodexPaperAnalysisOutputSchema.safeParse(value).success).toBe(false);
  expect(validateJsonSchema(value)).toBe(false);
}

function objectSchemas(value: unknown): JsonObject[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const object = value as JsonObject;
  return [
    ...(object.type === 'object' ? [object] : []),
    ...Object.values(object).flatMap(objectSchemas),
  ];
}

function property(schema: JsonObject, key: string): JsonObject {
  return (schema.properties as JsonObject)[key] as JsonObject;
}

describe('Codex analysis output contract', () => {
  it('accepts the same valid Provider fixture through Zod and generated JSON Schema', () => {
    const fixture = validCodexProviderOutput();
    expect(CodexPaperAnalysisOutputSchema.safeParse(fixture).success).toBe(true);
    expect(validateJsonSchema(fixture)).toBe(true);
  });

  it('keeps every generated object strict with all properties required', () => {
    const schemas = objectSchemas(codexPaperAnalysisOutputJsonSchema);
    expect(schemas.length).toBeGreaterThan(1);
    for (const schema of schemas) {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(Object.keys(schema.properties as JsonObject));
    }
  });

  it('preserves non-empty array items and nullable integer page constraints', () => {
    const root = codexPaperAnalysisOutputJsonSchema as JsonObject;
    const metadata = property(root, 'metadata_candidate');
    expect(property(metadata, 'authors')).toMatchObject({
      type: 'array',
      items: { type: 'string', minLength: 1 },
    });

    const findings = property(root, 'findings');
    const evidence = property(findings.items as JsonObject, 'evidence');
    const page = property(evidence.items as JsonObject, 'page');
    expect(page.anyOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'integer', minimum: 1 }),
      { type: 'null' },
    ]));

    const nullablePage = cloneFixture();
    const [finding] = nullablePage.findings as JsonObject[];
    const [item] = finding.evidence as JsonObject[];
    item.page = null;
    expect(CodexPaperAnalysisOutputSchema.safeParse(nullablePage).success).toBe(true);
    expect(validateJsonSchema(nullablePage)).toBe(true);
  });

  it('rejects empty authors, missing fields, extra fields and invalid pages on both sides', () => {
    const emptyAuthor = cloneFixture();
    (emptyAuthor.metadata_candidate as JsonObject).authors = [''];

    const missingField = cloneFixture();
    delete missingField.deep_reading;

    const extraField = { ...cloneFixture(), unsupported: true };

    const invalidPage = cloneFixture();
    const [finding] = invalidPage.findings as JsonObject[];
    const [evidence] = finding.evidence as JsonObject[];
    evidence.page = 0;

    const fractionalPage = cloneFixture();
    const [fractionalFinding] = fractionalPage.findings as JsonObject[];
    const [fractionalEvidence] = fractionalFinding.evidence as JsonObject[];
    fractionalEvidence.page = 1.5;

    for (const invalid of [emptyAuthor, missingField, extraField, invalidPage, fractionalPage]) {
      expectRejectedByBoth(invalid);
    }
  });

  it('keeps version constants and output-schema routing explicit', () => {
    expect({
      analysisPrompt: CODEX_ANALYSIS_PROMPT_VERSION,
      analysisSchema: CODEX_ANALYSIS_SCHEMA_VERSION,
      overviewPrompt: CODEX_OVERVIEW_PROMPT_VERSION,
      overviewSchema: CODEX_OVERVIEW_SCHEMA_VERSION,
    }).toEqual({
      analysisPrompt: 'codex-paper-analysis-v1',
      analysisSchema: '1.0.0',
      overviewPrompt: 'codex-paper-overview-v3',
      overviewSchema: 'unstructured-text-v1',
    });
    expect(outputSchemaForTask('analyze')).toBe(codexPaperAnalysisOutputJsonSchema);
    expect(outputSchemaForTask('schema_repair')).toBe(codexPaperAnalysisOutputJsonSchema);
    expect(outputSchemaForTask('overview')).toBeNull();
    expect(outputSchemaForTask('chat')).toBeNull();
  });
});
