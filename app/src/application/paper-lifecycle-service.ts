import {
  AnnotationRecoveryError,
  AnnotationRecoveryService,
} from '@/application/annotation-recovery-service';
import {
  paperOperationCoordinator,
  PaperOperationCoordinator,
} from '@/application/paper-operation-coordinator';
import {
  paperPdfAccessCoordinator,
  PaperPdfAccessCoordinator,
} from '@/application/paper-pdf-access-coordinator';
import {
  ImportRecoveryError,
  ImportRecoveryService,
} from '@/application/import-recovery-service';
import {
  DeletePaperRequest,
  DeletePaperRequestSchema,
  DeletePaperResult,
  DeletePaperResultSchema,
} from '@/domain/paper-library';
import { UuidSchema } from '@/domain/storage-types';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { ChatSessionRepository } from '@/lib/storage/chat-session-repository';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { ManagedPdfStore } from '@/lib/storage/managed-pdf-store';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { VaultContext } from '@/lib/storage/vault-path';
import { z } from 'zod';

export type PaperLifecycleErrorCode =
  | 'REQUEST_INVALID'
  | 'PAPER_NOT_FOUND'
  | 'PAPER_RECORD_REVISION_CONFLICT'
  | 'DATA_INTEGRITY_ERROR'
  | 'DELETE_FAILED';

export class PaperLifecycleServiceError extends Error {
  constructor(
    readonly code: PaperLifecycleErrorCode,
    message: string,
    readonly status: 400 | 404 | 409 | 500,
    readonly retryable: boolean,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PaperLifecycleServiceError';
  }
}

function invalidRequest(error: z.ZodError): PaperLifecycleServiceError {
  return new PaperLifecycleServiceError('REQUEST_INVALID', '删除请求字段不符合合同。', 400, false, {
    fields: [...new Set(error.issues.map((issue) => String(issue.path[0] ?? 'request')))],
  });
}

export class PaperLifecycleService {
  constructor(
    private readonly paperOperations: PaperOperationCoordinator = paperOperationCoordinator,
    private readonly pdfAccess: PaperPdfAccessCoordinator = paperPdfAccessCoordinator,
    private readonly importRecovery = new ImportRecoveryService(),
    private readonly annotationRecovery = new AnnotationRecoveryService(),
  ) {}

  async delete(context: VaultContext, rawPaperId: string, value: unknown): Promise<DeletePaperResult> {
    const paperId = UuidSchema.safeParse(rawPaperId);
    if (!paperId.success) throw invalidRequest(paperId.error);
    const request = DeletePaperRequestSchema.safeParse(value);
    if (!request.success) throw invalidRequest(request.error);
    if (request.data.confirmed_paper_id !== paperId.data) {
      throw new PaperLifecycleServiceError('REQUEST_INVALID', '确认的论文与删除目标不一致。', 400, false, { paper_id: paperId.data });
    }

    return this.paperOperations.runDelete(paperId.data, () => (
      this.pdfAccess.runWrite(paperId.data, () => this.deleteLocked(context, paperId.data, request.data))
    ));
  }

  private async deleteLocked(
    context: VaultContext,
    paperId: string,
    request: DeletePaperRequest,
  ): Promise<DeletePaperResult> {
    const papers = new PaperRepository(context);
    if (!await papers.exists(paperId)) {
      throw new PaperLifecycleServiceError('PAPER_NOT_FOUND', '未找到该论文。', 404, false, { paper_id: paperId });
    }

    try {
      await this.importRecovery.recover(context, paperId);
      await this.annotationRecovery.recoverPaperLocked(context, paperId);
    } catch (error) {
      if (error instanceof ImportRecoveryError || error instanceof AnnotationRecoveryError) {
        throw new PaperLifecycleServiceError('DATA_INTEGRITY_ERROR', error.message, 500, false, {
          paper_id: paperId,
          object_kind: error instanceof ImportRecoveryError ? 'import_operation' : 'annotation_operation',
        });
      }
      throw error;
    }

    const paper = await papers.read(paperId);
    if (paper.record_revision !== request.expected_record_revision) {
      throw new PaperLifecycleServiceError(
        'PAPER_RECORD_REVISION_CONFLICT',
        '论文记录已被其他操作更新，请重新确认删除。',
        409,
        true,
        { expected_revision: request.expected_record_revision, actual_revision: paper.record_revision },
      );
    }

    const sessions = new ChatSessionRepository(context);
    const runs = new AnalysisRunRepository(context);
    const extractions = new ExtractionRepository(context);
    const pdfs = new ManagedPdfStore(context);
    const deletedManagedPaths: string[] = [];
    const remove = async (relativePath: string, operation: () => Promise<boolean>) => {
      try {
        if (await operation()) deletedManagedPaths.push(relativePath);
      } catch {
        throw new PaperLifecycleServiceError('DELETE_FAILED', '删除受管论文对象失败；论文记录仍保留，可重试。', 500, true, {
          paper_id: paperId,
          failed_path: relativePath,
        });
      }
    };

    await remove(sessions.relativePath(paperId), () => sessions.remove(paperId));
    for (const run of await runs.listForPaper(paperId)) {
      await remove(runs.relativePath(paperId, run.analysis_run_id), () => runs.remove(paperId, run.analysis_run_id));
    }
    await remove(extractions.relativePath(paperId), () => extractions.remove(extractions.relativePath(paperId)));
    if (paper.card_path !== null) {
      await remove(paper.card_path, () => pdfs.remove(paper.card_path!));
    }
    await remove(paper.pdf_path, () => pdfs.remove(paper.pdf_path));
    await remove(papers.relativePath(paperId), () => papers.remove(paperId));

    return DeletePaperResultSchema.parse({ paper_id: paperId, deleted_managed_paths: deletedManagedPaths });
  }
}
