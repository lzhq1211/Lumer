import path from 'node:path';

import { z } from 'zod';

import {
  addIssue,
  hasUniqueValues,
  isSameOrAfter,
  NonEmptyStringSchema,
  NullableNonEmptyStringSchema,
  RevisionSchema,
  SchemaVersionSchema,
  Sha256Schema,
  UtcDateTimeSchema,
  UuidSchema,
  VaultRelativePathSchema,
} from '@/domain/storage-types';

function isManagedPdfPath(value: string): boolean {
  return value.startsWith('Papers/') && value.endsWith('.pdf') && value.split('/').length === 2;
}

function isPaperCardPath(value: string): boolean {
  return value.startsWith('Paper Cards/') && value.endsWith('.md') && value.split('/').length === 2;
}

const ManagedPdfPathSchema = VaultRelativePathSchema.refine(isManagedPdfPath, '必须位于 Papers/ 且使用 .pdf 扩展名。');
const PaperCardPathSchema = VaultRelativePathSchema.refine(isPaperCardPath, '必须位于 Paper Cards/ 且使用 .md 扩展名。');

export const MarkdownSyncContextSchema = z.strictObject({
  operation_id: UuidSchema,
  analysis_run_id: UuidSchema,
  renderer_version: NonEmptyStringSchema,
  markdown_action: z.enum(['create', 'overwrite', 'save_as']),
  target_card_path: PaperCardPathSchema,
  expected_markdown_hash: Sha256Schema.nullable(),
  rendered_hash: Sha256Schema,
  created_at: UtcDateTimeSchema,
}).superRefine((value, context) => {
  const expectsHash = value.markdown_action === 'overwrite';
  if (expectsHash !== (value.expected_markdown_hash !== null)) {
    addIssue(
      context,
      ['expected_markdown_hash'],
      'overwrite 必须提供 expected hash，create/save_as 必须为 null。',
    );
  }
});

export const PaperRecordSchema = z.strictObject({
  schema_version: SchemaVersionSchema,
  paper_id: UuidSchema,
  source_sha256: Sha256Schema,
  managed_pdf_sha256: Sha256Schema,
  pdf_revision: RevisionSchema,
  pdf_path: ManagedPdfPathSchema,
  original_file_name: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  authors: z.array(NonEmptyStringSchema),
  year: z.number().int().nullable(),
  journal: NullableNonEmptyStringSchema,
  doi: NullableNonEmptyStringSchema,
  tags: z.array(NonEmptyStringSchema),
  status: z.enum(['inbox', 'reading', 'read']),
  current_final_run_id: UuidSchema.nullable(),
  card_path: PaperCardPathSchema.nullable(),
  markdown_hash: Sha256Schema.nullable(),
  markdown_sync_status: z.enum(['not_generated', 'pending', 'synced', 'error', 'conflict']),
  pending_card_path: PaperCardPathSchema.nullable(),
  markdown_sync_context: MarkdownSyncContextSchema.nullable(),
  markdown_sync_error: NullableNonEmptyStringSchema,
  record_revision: RevisionSchema,
  created_at: UtcDateTimeSchema,
  updated_at: UtcDateTimeSchema,
}).superRefine((value, context) => {
  if (!hasUniqueValues(value.tags)) {
    addIssue(context, ['tags'], '标签不得重复。');
  }
  if (!isSameOrAfter(value.updated_at, value.created_at)) {
    addIssue(context, ['updated_at'], 'updated_at 不得早于 created_at。');
  }

  if (value.markdown_sync_status === 'not_generated') {
    if (
      value.markdown_hash !== null
      || value.pending_card_path !== null
      || value.markdown_sync_context !== null
      || value.markdown_sync_error !== null
    ) {
      addIssue(context, ['markdown_sync_status'], 'not_generated 不得带 Markdown 同步上下文。');
    }
  }

  if (value.markdown_sync_status === 'synced') {
    if (
      value.card_path === null
      || value.markdown_hash === null
      || value.pending_card_path !== null
      || value.markdown_sync_context !== null
      || value.markdown_sync_error !== null
    ) {
      addIssue(context, ['markdown_sync_status'], 'synced 状态与 Markdown 持久化字段不一致。');
    }
  }

  if (value.markdown_sync_status === 'pending') {
    if (
      value.pending_card_path === null
      || value.markdown_sync_context === null
      || value.markdown_sync_error !== null
    ) {
      addIssue(context, ['markdown_sync_status'], 'pending 必须保存目标路径与同步上下文，且不得有 error。');
    }
  }

  if (value.markdown_sync_status === 'error' || value.markdown_sync_status === 'conflict') {
    if (
      value.pending_card_path === null
      || value.markdown_sync_context === null
      || value.markdown_sync_error === null
    ) {
      addIssue(context, ['markdown_sync_status'], 'error/conflict 必须保存目标、上下文和错误。');
    }
  }

  if (value.markdown_sync_context) {
    if (value.current_final_run_id !== value.markdown_sync_context.analysis_run_id) {
      addIssue(context, ['markdown_sync_context', 'analysis_run_id'], '必须等于 current_final_run_id。');
    }
    if (value.pending_card_path !== value.markdown_sync_context.target_card_path) {
      addIssue(context, ['markdown_sync_context', 'target_card_path'], '必须等于 pending_card_path。');
    }
  }
});

export const ExtractedPageSchema = z.strictObject({
  pdf_page_index: z.number().int().min(0),
  display_page_number: z.number().int().min(1),
  text: z.string(),
});

export const ExtractedPaperSchema = z.strictObject({
  schema_version: SchemaVersionSchema,
  extraction_version: NonEmptyStringSchema,
  paper_id: UuidSchema,
  source_sha256: Sha256Schema,
  content_hash: Sha256Schema,
  page_count: z.number().int().min(1),
  extracted_char_count: z.number().int().min(0),
  pages: z.array(ExtractedPageSchema).min(1),
  created_at: UtcDateTimeSchema,
}).superRefine((value, context) => {
  if (value.page_count !== value.pages.length) {
    addIssue(context, ['page_count'], '必须等于 pages.length。');
  }
  const extractedCharCount = value.pages.reduce((total, page) => total + page.text.length, 0);
  if (value.extracted_char_count !== extractedCharCount) {
    addIssue(context, ['extracted_char_count'], '必须等于全部页文本长度之和。');
  }
  value.pages.forEach((page, index) => {
    if (page.pdf_page_index !== index) {
      addIssue(context, ['pages', index, 'pdf_page_index'], '必须从 0 连续递增。');
    }
    if (page.display_page_number !== index + 1) {
      addIssue(context, ['pages', index, 'display_page_number'], '必须等于 pdf_page_index + 1。');
    }
  });
});

function isOperationTempPath(tempPath: string, targetPath: string, operationId: string): boolean {
  return path.posix.dirname(tempPath) === path.posix.dirname(targetPath)
    && path.posix.basename(tempPath).includes(operationId);
}

function isCanonicalPdfPathForPaper(pdfPath: string, paperId: string): boolean {
  if (!isManagedPdfPath(pdfPath)) return false;
  const suffix = paperId.replaceAll('-', '').slice(0, 8);
  const baseName = path.posix.basename(pdfPath, '.pdf');
  return baseName.endsWith(`--${suffix}`) || baseName.endsWith(`--${paperId}`);
}

export const ImportOperationSchema = z.strictObject({
  schema_version: SchemaVersionSchema,
  operation_id: UuidSchema,
  paper_id: UuidSchema,
  pdf_path: ManagedPdfPathSchema,
  extraction_path: VaultRelativePathSchema,
  temp_pdf_path: VaultRelativePathSchema,
  temp_extraction_path: VaultRelativePathSchema,
  phase: z.enum(['preparing', 'staged', 'files_committed']),
  created_at: UtcDateTimeSchema,
  updated_at: UtcDateTimeSchema,
}).superRefine((value, context) => {
  if (value.extraction_path !== `.lumer/extractions/${value.paper_id}.json`) {
    addIssue(context, ['extraction_path'], '必须是该 Paper 的 canonical Extraction 路径。');
  }
  if (!isCanonicalPdfPathForPaper(value.pdf_path, value.paper_id)) {
    addIssue(context, ['pdf_path'], '必须使用该 paper_id 的 canonical PDF 后缀。');
  }
  if (!isOperationTempPath(value.temp_pdf_path, value.pdf_path, value.operation_id)) {
    addIssue(context, ['temp_pdf_path'], '必须与 PDF 同目录且由 operation_id 确定。');
  }
  if (!isOperationTempPath(value.temp_extraction_path, value.extraction_path, value.operation_id)) {
    addIssue(context, ['temp_extraction_path'], '必须与 Extraction 同目录且由 operation_id 确定。');
  }
  if (!isSameOrAfter(value.updated_at, value.created_at)) {
    addIssue(context, ['updated_at'], 'updated_at 不得早于 created_at。');
  }
  if (!hasUniqueValues([value.pdf_path, value.extraction_path, value.temp_pdf_path, value.temp_extraction_path])) {
    addIssue(context, [], '导入 journal 的 canonical/temp 路径不得重复。');
  }
});

export const AnnotationOperationSchema = z.strictObject({
  schema_version: SchemaVersionSchema,
  operation_id: UuidSchema,
  paper_id: UuidSchema,
  pdf_path: ManagedPdfPathSchema,
  temp_pdf_path: VaultRelativePathSchema,
  expected_record_revision: RevisionSchema,
  expected_pdf_revision: RevisionSchema,
  expected_managed_pdf_sha256: Sha256Schema,
  new_managed_pdf_sha256: Sha256Schema.nullable(),
  phase: z.enum(['preparing', 'ready_to_commit']),
  created_at: UtcDateTimeSchema,
  updated_at: UtcDateTimeSchema,
}).superRefine((value, context) => {
  if (!isCanonicalPdfPathForPaper(value.pdf_path, value.paper_id)) {
    addIssue(context, ['pdf_path'], '必须使用该 paper_id 的 canonical PDF 后缀。');
  }
  if (!isOperationTempPath(value.temp_pdf_path, value.pdf_path, value.operation_id)) {
    addIssue(context, ['temp_pdf_path'], '必须与 PDF 同目录且由 operation_id 确定。');
  }
  if ((value.phase === 'preparing') !== (value.new_managed_pdf_sha256 === null)) {
    addIssue(context, ['new_managed_pdf_sha256'], 'preparing 必须为 null，ready_to_commit 必须为 SHA-256。');
  }
  if (!isSameOrAfter(value.updated_at, value.created_at)) {
    addIssue(context, ['updated_at'], 'updated_at 不得早于 created_at。');
  }
});

export type MarkdownSyncContext = z.infer<typeof MarkdownSyncContextSchema>;
export type PaperRecord = z.infer<typeof PaperRecordSchema>;
export type ExtractedPaper = z.infer<typeof ExtractedPaperSchema>;
export type ImportOperation = z.infer<typeof ImportOperationSchema>;
export type AnnotationOperation = z.infer<typeof AnnotationOperationSchema>;
