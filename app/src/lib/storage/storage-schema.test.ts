import { describe, expect, it } from 'vitest';

import {
  AnnotationOperationSchema,
  ExtractedPaperSchema,
  ImportOperationSchema,
  PaperRecordSchema,
} from '@/domain/paper';
import { ChatSessionStoreSchema } from '@/domain/chat-session';
import { isVaultRelativePath } from '@/domain/storage-types';
import {
  managedPdfRelativePath,
  paperCardRelativePath,
  safeFileStem,
} from '@/lib/storage/safe-file-name';
import {
  migrateStorageObject,
  StorageSchemaError,
} from '@/lib/storage/schema-registry';

const PAPER_ID = '123e4567-e89b-42d3-a456-426614174000';
const OPERATION_ID = '223e4567-e89b-42d3-a456-426614174000';
const SHA_256 = 'a'.repeat(64);
const CREATED_AT = '2026-09-01T02:00:00.000Z';
const UPDATED_AT = '2026-09-01T02:01:00.000Z';

function paperRecord() {
  return {
    schema_version: 1,
    paper_id: PAPER_ID,
    source_sha256: SHA_256,
    managed_pdf_sha256: SHA_256,
    pdf_revision: 1,
    pdf_path: 'Papers/source--123e4567.pdf',
    original_file_name: 'source.pdf',
    title: 'Source title',
    authors: [],
    year: null,
    journal: null,
    doi: null,
    tags: [],
    status: 'inbox',
    current_final_run_id: null,
    card_path: null,
    markdown_hash: null,
    markdown_sync_status: 'not_generated',
    pending_card_path: null,
    markdown_sync_context: null,
    markdown_sync_error: null,
    record_revision: 1,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
  };
}

describe('Storage Schema', () => {
  it('accepts valid strict PaperRecord data', () => {
    expect(PaperRecordSchema.parse(paperRecord())).toEqual(paperRecord());
  });

  it('rejects unknown fields and invalid Markdown state', () => {
    expect(PaperRecordSchema.safeParse({ ...paperRecord(), unknown: true }).success).toBe(false);
    expect(PaperRecordSchema.safeParse({ ...paperRecord(), markdown_hash: SHA_256 }).success).toBe(false);
  });

  it('rejects duplicate tags and non-canonical primitives', () => {
    expect(PaperRecordSchema.safeParse({ ...paperRecord(), tags: ['EEG', 'EEG'] }).success).toBe(false);
    expect(PaperRecordSchema.safeParse({ ...paperRecord(), paper_id: PAPER_ID.toUpperCase() }).success).toBe(false);
    expect(PaperRecordSchema.safeParse({ ...paperRecord(), source_sha256: SHA_256.toUpperCase() }).success).toBe(false);
    expect(PaperRecordSchema.safeParse({ ...paperRecord(), updated_at: '2026-09-01T01:59:00Z' }).success).toBe(false);
  });

  it('enforces ExtractedPaper page and character invariants', () => {
    const extracted = {
      schema_version: 1,
      extraction_version: 'pymupdf-v1',
      paper_id: PAPER_ID,
      source_sha256: SHA_256,
      content_hash: SHA_256,
      page_count: 1,
      extracted_char_count: 4,
      pages: [{ pdf_page_index: 0, display_page_number: 1, text: 'test' }],
      created_at: CREATED_AT,
    };

    expect(ExtractedPaperSchema.safeParse(extracted).success).toBe(true);
    expect(ExtractedPaperSchema.safeParse({ ...extracted, page_count: 2 }).success).toBe(false);
    expect(ExtractedPaperSchema.safeParse({ ...extracted, extracted_char_count: 3 }).success).toBe(false);
  });

  it('enforces import and annotation journal path/phase invariants', () => {
    const importOperation = {
      schema_version: 1,
      operation_id: OPERATION_ID,
      paper_id: PAPER_ID,
      pdf_path: 'Papers/source--123e4567.pdf',
      extraction_path: `.lumer/extractions/${PAPER_ID}.json`,
      temp_pdf_path: `Papers/.source.${OPERATION_ID}.tmp`,
      temp_extraction_path: `.lumer/extractions/.${PAPER_ID}.${OPERATION_ID}.tmp`,
      phase: 'preparing',
      created_at: CREATED_AT,
      updated_at: UPDATED_AT,
    };
    expect(ImportOperationSchema.safeParse(importOperation).success).toBe(true);
    expect(ImportOperationSchema.safeParse({
      ...importOperation,
      temp_pdf_path: `.lumer/${OPERATION_ID}.tmp`,
    }).success).toBe(false);

    const annotationOperation = {
      schema_version: 1,
      operation_id: OPERATION_ID,
      paper_id: PAPER_ID,
      pdf_path: 'Papers/source--123e4567.pdf',
      temp_pdf_path: `Papers/.source.${OPERATION_ID}.tmp`,
      expected_record_revision: 1,
      expected_pdf_revision: 1,
      expected_managed_pdf_sha256: SHA_256,
      new_managed_pdf_sha256: null,
      phase: 'preparing',
      created_at: CREATED_AT,
      updated_at: UPDATED_AT,
    };
    expect(AnnotationOperationSchema.safeParse(annotationOperation).success).toBe(true);
    expect(AnnotationOperationSchema.safeParse({
      ...annotationOperation,
      phase: 'ready_to_commit',
    }).success).toBe(false);
  });

  it('fails clearly on unsupported versions and corrupt data', () => {
    expect(() => migrateStorageObject('paper_record', { ...paperRecord(), schema_version: 2 }))
      .toThrowError(expect.objectContaining<Partial<StorageSchemaError>>({ code: 'SCHEMA_VERSION_UNSUPPORTED' }));
    expect(() => migrateStorageObject('paper_record', { ...paperRecord(), title: '' }))
      .toThrowError(expect.objectContaining<Partial<StorageSchemaError>>({ code: 'DATA_INTEGRITY_ERROR' }));
  });

  it('按槽位强制隔离 Codex 与 OpenAI-compatible Session', () => {
    const session = {
      session_id: PAPER_ID,
      provider_session_id: 'provider-session',
      model: 'model',
      messages: [],
      created_at: CREATED_AT,
      updated_at: UPDATED_AT,
    };
    expect(ChatSessionStoreSchema.safeParse({
      schema_version: 1,
      paper_id: PAPER_ID,
      session_revision: 1,
      sessions: {
        codex: { ...session, provider: 'codex' },
        openai_compatible: { ...session, provider: 'openai_compatible' },
      },
    }).success).toBe(true);
    expect(ChatSessionStoreSchema.safeParse({
      schema_version: 1,
      paper_id: PAPER_ID,
      session_revision: 1,
      sessions: {
        codex: { ...session, provider: 'openai_compatible' },
        openai_compatible: null,
      },
    }).success).toBe(false);
  });
});

describe('Vault paths and managed names', () => {
  it.each([
    '',
    '/absolute/file.json',
    '../escape.json',
    'folder/../escape.json',
    'folder/./file.json',
    'folder//file.json',
    'folder\\file.json',
    'folder/file.json/',
    `folder/\0/file.json`,
  ])('rejects unsafe Vault-relative path %j', (candidate) => {
    expect(isVaultRelativePath(candidate)).toBe(false);
  });

  it('normalizes forbidden names deterministically', () => {
    expect(safeFileStem('  A::  B?.  ')).toBe('A- B-');
    expect(safeFileStem('CON')).toBe('untitled');
    expect(safeFileStem('...')).toBe('untitled');
    expect(managedPdfRelativePath('My / Paper.PDF', PAPER_ID)).toBe('Papers/Paper--123e4567.pdf');
    expect(paperCardRelativePath('My: Paper', PAPER_ID)).toBe('Paper Cards/My- Paper--123e4567.md');
  });
});
