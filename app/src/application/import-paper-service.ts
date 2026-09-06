import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  ExtractedPaper,
  ImportOperation,
  PaperRecord,
} from '@/domain/paper';
import { STORAGE_SCHEMA_VERSION } from '@/domain/storage-types';
import { ImportCoordinator, importCoordinator } from '@/application/import-coordinator';
import { ImportRecoveryService } from '@/application/import-recovery-service';
import { checkPdfContainer, PdfSupportError } from '@/lib/pdf/pdf-support-check';
import { extractPdfText } from '@/lib/pdf/pdf-text-extractor';
import { PDF_EXTRACTION_VERSION } from '@/lib/pdf/pdf-limits';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { sha256File } from '@/lib/storage/file-hash';
import { ImportOperationRepository } from '@/lib/storage/import-operation-repository';
import { ManagedPdfStore } from '@/lib/storage/managed-pdf-store';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { managedPdfRelativePath, safeFileStem } from '@/lib/storage/safe-file-name';
import { commitStagedFile, removeVaultFile } from '@/lib/storage/staged-file';
import { VaultContext } from '@/lib/storage/vault-path';

export interface ImportPaperResult {
  readonly paper: PaperRecord;
  readonly duplicate: boolean;
}

export type ImportFaultPoint =
  | 'journal_created'
  | 'temp_pdf_written'
  | 'temp_extraction_written'
  | 'journal_staged'
  | 'pdf_committed'
  | 'extraction_committed'
  | 'journal_files_committed'
  | 'before_paper_commit'
  | 'paper_committed'
  | 'journal_cleaned';

export interface ImportPaperOptions {
  readonly injectFault?: (point: ImportFaultPoint) => void | Promise<void>;
}

export class ImportSimulatedCrashError extends Error {
  constructor(readonly point: ImportFaultPoint) {
    super(`Simulated import crash at ${point}`);
    this.name = 'ImportSimulatedCrashError';
  }
}

function nowUtc(): string {
  return new Date().toISOString();
}

function normalizeOriginalFileName(value: string): string {
  return path.posix.basename(path.win32.basename(value.trim())).trim();
}

function initialTitle(originalFileName: string): string {
  return safeFileStem(path.parse(originalFileName).name);
}

function tempPdfPath(pdfPath: string, operationId: string): string {
  const directory = path.posix.dirname(pdfPath);
  const baseName = path.posix.basename(pdfPath, '.pdf');
  return `${directory}/.${baseName}.${operationId}.tmp`;
}

function tempExtractionPath(paperId: string, operationId: string): string {
  return `.lumer/extractions/.${paperId}.${operationId}.tmp`;
}

export class ImportPaperService {
  constructor(
    private readonly coordinator: ImportCoordinator = importCoordinator,
    private readonly recovery = new ImportRecoveryService(),
  ) {}

  async import(
    context: VaultContext,
    sourcePath: string,
    originalFileName: string,
    options: ImportPaperOptions = {},
  ): Promise<ImportPaperResult> {
    if (!originalFileName.trim().toLowerCase().endsWith('.pdf')) {
      throw new PdfSupportError('PDF_INVALID_EXTENSION', '只支持 .pdf 文件。', 422);
    }
    const normalizedFileName = normalizeOriginalFileName(originalFileName);
    await checkPdfContainer(sourcePath);
    const sourceSha256 = await sha256File(sourcePath);

    return this.coordinator.runExclusive(sourceSha256, async () => {
      await this.recovery.recover(context);
      const papers = new PaperRepository(context);
      const duplicate = await papers.findBySourceSha256(sourceSha256);
      if (duplicate) return { paper: duplicate, duplicate: true };

      const extractionResult = await extractPdfText(sourcePath);
      const pdfs = new ManagedPdfStore(context);
      const extractions = new ExtractionRepository(context);
      const operations = new ImportOperationRepository(context);
      const paperId = randomUUID();
      const operationId = randomUUID();
      let pdfPath = managedPdfRelativePath(normalizedFileName, paperId);
      if (await pdfs.exists(pdfPath)) {
        pdfPath = `Papers/${safeFileStem(path.parse(normalizedFileName).name)}--${paperId}.pdf`;
      }
      if (await pdfs.exists(pdfPath)) {
        throw new Error('managed PDF target collision');
      }

      const extractionPath = extractions.relativePath(paperId);
      const createdAt = nowUtc();
      let operation: ImportOperation = {
        schema_version: STORAGE_SCHEMA_VERSION,
        operation_id: operationId,
        paper_id: paperId,
        pdf_path: pdfPath,
        extraction_path: extractionPath,
        temp_pdf_path: tempPdfPath(pdfPath, operationId),
        temp_extraction_path: tempExtractionPath(paperId, operationId),
        phase: 'preparing',
        created_at: createdAt,
        updated_at: createdAt,
      };
      const extraction: ExtractedPaper = {
        schema_version: STORAGE_SCHEMA_VERSION,
        extraction_version: PDF_EXTRACTION_VERSION,
        paper_id: paperId,
        source_sha256: sourceSha256,
        content_hash: extractionResult.contentHash,
        page_count: extractionResult.pageCount,
        extracted_char_count: extractionResult.extractedCharCount,
        pages: extractionResult.pages,
        created_at: createdAt,
      };
      const paper: PaperRecord = {
        schema_version: STORAGE_SCHEMA_VERSION,
        paper_id: paperId,
        source_sha256: sourceSha256,
        managed_pdf_sha256: sourceSha256,
        pdf_revision: 1,
        pdf_path: pdfPath,
        original_file_name: normalizedFileName,
        title: initialTitle(normalizedFileName),
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
        created_at: createdAt,
        updated_at: createdAt,
      };

      let journalCreated = false;
      let tempPdfWritten = false;
      let tempExtractionWritten = false;
      let pdfCommitted = false;
      let extractionCommitted = false;
      let paperCommitted = false;
      try {
        await operations.create(operation);
        journalCreated = true;
        await options.injectFault?.('journal_created');

        await pdfs.writeStaged(sourcePath, operation.temp_pdf_path);
        tempPdfWritten = true;
        await options.injectFault?.('temp_pdf_written');

        await extractions.writeStaged(operation.temp_extraction_path, extraction);
        tempExtractionWritten = true;
        await options.injectFault?.('temp_extraction_written');

        operation = { ...operation, phase: 'staged', updated_at: nowUtc() };
        await operations.update(operation);
        await options.injectFault?.('journal_staged');

        await pdfs.commit(operation.temp_pdf_path, operation.pdf_path);
        tempPdfWritten = false;
        pdfCommitted = true;
        await options.injectFault?.('pdf_committed');

        await commitStagedFile(context, operation.temp_extraction_path, operation.extraction_path);
        tempExtractionWritten = false;
        extractionCommitted = true;
        await options.injectFault?.('extraction_committed');

        operation = { ...operation, phase: 'files_committed', updated_at: nowUtc() };
        await operations.update(operation);
        await options.injectFault?.('journal_files_committed');
        await options.injectFault?.('before_paper_commit');

        await papers.create(paper);
        paperCommitted = true;
        await options.injectFault?.('paper_committed');
        await operations.remove(paperId);
        journalCreated = false;
        await options.injectFault?.('journal_cleaned');
        return { paper, duplicate: false };
      } catch (error) {
        if (error instanceof ImportSimulatedCrashError) throw error;
        if (paperCommitted) {
          return { paper, duplicate: false };
        }
        if (tempPdfWritten) await removeVaultFile(context, operation.temp_pdf_path).catch(() => undefined);
        if (tempExtractionWritten) await removeVaultFile(context, operation.temp_extraction_path).catch(() => undefined);
        if (pdfCommitted) await pdfs.remove(operation.pdf_path).catch(() => undefined);
        if (extractionCommitted) await extractions.remove(operation.extraction_path).catch(() => undefined);
        if (journalCreated) await operations.remove(paperId).catch(() => undefined);
        throw error;
      }
    });
  }
}
