import {
  paperOperationCoordinator,
  PaperOperationCoordinator,
} from '@/application/paper-operation-coordinator';
import {
  paperPdfAccessCoordinator,
  PaperPdfAccessCoordinator,
} from '@/application/paper-pdf-access-coordinator';
import { AnnotationOperation, PaperRecord } from '@/domain/paper';
import { AnnotationOperationRepository } from '@/lib/storage/annotation-operation-repository';
import { ManagedPdfStore } from '@/lib/storage/managed-pdf-store';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { removeVaultFile } from '@/lib/storage/staged-file';
import { VaultContext } from '@/lib/storage/vault-path';

export class AnnotationRecoveryError extends Error {
  constructor(
    readonly code: 'DATA_INTEGRITY_ERROR',
    message: string,
    readonly paperId: string,
  ) {
    super(message);
    this.name = 'AnnotationRecoveryError';
  }
}

function isExpectedOldRecord(record: PaperRecord, operation: AnnotationOperation): boolean {
  return record.pdf_path === operation.pdf_path
    && record.record_revision === operation.expected_record_revision
    && record.pdf_revision === operation.expected_pdf_revision
    && record.managed_pdf_sha256 === operation.expected_managed_pdf_sha256;
}

function isExpectedCommittedRecord(record: PaperRecord, operation: AnnotationOperation): boolean {
  return operation.new_managed_pdf_sha256 !== null
    && record.pdf_path === operation.pdf_path
    && record.record_revision === operation.expected_record_revision + 1
    && record.pdf_revision === operation.expected_pdf_revision + 1
    && record.managed_pdf_sha256 === operation.new_managed_pdf_sha256;
}

async function cleanOperation(
  context: VaultContext,
  operation: AnnotationOperation,
  operations: AnnotationOperationRepository,
): Promise<void> {
  await removeVaultFile(context, operation.temp_pdf_path);
  await operations.remove(operation.paper_id);
}

export class AnnotationRecoveryService {
  constructor(
    private readonly paperOperations: PaperOperationCoordinator = paperOperationCoordinator,
    private readonly pdfAccess: PaperPdfAccessCoordinator = paperPdfAccessCoordinator,
  ) {}

  async recover(context: VaultContext): Promise<void> {
    const operations = new AnnotationOperationRepository(context);
    for (const operation of await operations.list()) {
      await this.recoverPaper(context, operation.paper_id);
    }
  }

  async recoverPaper(context: VaultContext, paperId: string): Promise<void> {
    await this.paperOperations.runMutation(paperId, () => (
      this.pdfAccess.runWrite(paperId, () => this.recoverPaperLocked(context, paperId))
    ));
  }

  async recoverPaperLocked(context: VaultContext, paperId: string): Promise<void> {
    const operations = new AnnotationOperationRepository(context);
    if (!await operations.exists(paperId)) return;

    const operation = await operations.read(paperId);
    const papers = new PaperRepository(context);
    if (!await papers.exists(paperId)) {
      throw new AnnotationRecoveryError(
        'DATA_INTEGRITY_ERROR',
        'Annotation journal 对应的 PaperRecord 不存在。',
        paperId,
      );
    }

    const record = await papers.read(paperId);
    let diskHash: string;
    try {
      diskHash = (await new ManagedPdfStore(context).read(operation.pdf_path)).sha256;
    } catch {
      throw new AnnotationRecoveryError(
        'DATA_INTEGRITY_ERROR',
        'Annotation journal 对应的 canonical PDF 不可读取。',
        paperId,
      );
    }

    const recordIsOld = isExpectedOldRecord(record, operation);
    if (operation.phase === 'preparing') {
      if (!recordIsOld || diskHash !== operation.expected_managed_pdf_sha256) {
        throw new AnnotationRecoveryError(
          'DATA_INTEGRITY_ERROR',
          'preparing Annotation journal 与 PDF/PaperRecord 不一致。',
          paperId,
        );
      }
      await cleanOperation(context, operation, operations);
      return;
    }

    const newHash = operation.new_managed_pdf_sha256;
    if (newHash === null) {
      throw new AnnotationRecoveryError(
        'DATA_INTEGRITY_ERROR',
        'ready_to_commit Annotation journal 缺少新 PDF hash。',
        paperId,
      );
    }

    const pdfs = new ManagedPdfStore(context);
    if (await pdfs.exists(operation.temp_pdf_path)) {
      const stagedHash = (await pdfs.read(operation.temp_pdf_path)).sha256;
      if (stagedHash !== newHash) {
        throw new AnnotationRecoveryError(
          'DATA_INTEGRITY_ERROR',
          'ready_to_commit Annotation journal 的临时 PDF hash 不一致。',
          paperId,
        );
      }
    }

    if (recordIsOld && diskHash === operation.expected_managed_pdf_sha256) {
      await cleanOperation(context, operation, operations);
      return;
    }

    if (recordIsOld && diskHash === newHash) {
      await papers.replace({
        ...record,
        managed_pdf_sha256: newHash,
        pdf_revision: operation.expected_pdf_revision + 1,
        record_revision: operation.expected_record_revision + 1,
        updated_at: new Date().toISOString(),
      });
      await cleanOperation(context, operation, operations);
      return;
    }

    if (isExpectedCommittedRecord(record, operation) && diskHash === newHash) {
      await cleanOperation(context, operation, operations);
      return;
    }

    throw new AnnotationRecoveryError(
      'DATA_INTEGRITY_ERROR',
      'Annotation journal、PDF 与 PaperRecord 组合无法安全恢复。',
      paperId,
    );
  }
}
