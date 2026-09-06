import { ImportOperation } from '@/domain/paper';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { ImportOperationRepository } from '@/lib/storage/import-operation-repository';
import { ManagedPdfStore } from '@/lib/storage/managed-pdf-store';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { removeVaultFile, vaultPathExists } from '@/lib/storage/staged-file';
import { VaultContext } from '@/lib/storage/vault-path';

export class ImportRecoveryError extends Error {
  constructor(
    readonly code: 'DATA_INTEGRITY_ERROR',
    message: string,
    readonly paperId: string,
  ) {
    super(message);
    this.name = 'ImportRecoveryError';
  }
}

async function removeOperationFiles(
  context: VaultContext,
  operation: ImportOperation,
  includeCanonical: boolean,
): Promise<void> {
  await removeVaultFile(context, operation.temp_pdf_path);
  await removeVaultFile(context, operation.temp_extraction_path);
  if (includeCanonical) {
    await removeVaultFile(context, operation.pdf_path);
    await removeVaultFile(context, operation.extraction_path);
  }
}

export class ImportRecoveryService {
  async recover(context: VaultContext, paperId?: string): Promise<void> {
    const operations = new ImportOperationRepository(context);
    const papers = new PaperRepository(context);
    const extractions = new ExtractionRepository(context);
    const pdfs = new ManagedPdfStore(context);

    for (const operation of (await operations.list()).filter((value) => paperId === undefined || value.paper_id === paperId)) {
      const recordExists = await papers.exists(operation.paper_id);
      const pdfExists = await pdfs.exists(operation.pdf_path);
      const extractionExists = await vaultPathExists(context, operation.extraction_path);

      if (recordExists) {
        if (!pdfExists || !extractionExists) {
          throw new ImportRecoveryError(
            'DATA_INTEGRITY_ERROR',
            'PaperRecord 已存在但导入目标缺失。',
            operation.paper_id,
          );
        }
        const record = await papers.read(operation.paper_id);
        const extraction = await extractions.read(operation.paper_id);
        if (
          record.pdf_path !== operation.pdf_path
          || extraction.paper_id !== record.paper_id
          || extraction.source_sha256 !== record.source_sha256
        ) {
          throw new ImportRecoveryError(
            'DATA_INTEGRITY_ERROR',
            '导入 journal 与已提交 Paper 数据不一致。',
            operation.paper_id,
          );
        }
        await removeOperationFiles(context, operation, false);
        await operations.remove(operation.paper_id);
        continue;
      }

      if (operation.phase === 'preparing') {
        if (pdfExists || extractionExists) {
          throw new ImportRecoveryError(
            'DATA_INTEGRITY_ERROR',
            'preparing journal 出现 canonical 目标。',
            operation.paper_id,
          );
        }
        await removeOperationFiles(context, operation, false);
        await operations.remove(operation.paper_id);
        continue;
      }

      await removeOperationFiles(context, operation, true);
      await operations.remove(operation.paper_id);
    }
  }
}
