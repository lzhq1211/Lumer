import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { z } from 'zod';

import {
  AnnotationMutationResult,
  CreateAnnotationRequest,
  CreateAnnotationRequestSchema,
  DeleteAnnotationRequestSchema,
  PdfAnnotation,
  UpdateAnnotationRequest,
  UpdateAnnotationRequestSchema,
} from '@/domain/annotation';
import { AnnotationOperation, PaperRecord } from '@/domain/paper';
import { STORAGE_SCHEMA_VERSION, UuidSchema } from '@/domain/storage-types';
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
import { extractPdfText } from '@/lib/pdf/pdf-text-extractor';
import {
  CreatePdfAnnotationPayload,
  PdfAnnotationWorker,
  UpdatePdfAnnotationPayload,
} from '@/lib/pdf/pdf-annotation-worker';
import { AnnotationOperationRepository } from '@/lib/storage/annotation-operation-repository';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { sha256File } from '@/lib/storage/file-hash';
import { ManagedPdfStore } from '@/lib/storage/managed-pdf-store';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { removeVaultFile } from '@/lib/storage/staged-file';
import { VaultContext, VaultPathError } from '@/lib/storage/vault-path';

export type AnnotationServiceErrorCode =
  | 'REQUEST_INVALID'
  | 'PAPER_NOT_FOUND'
  | 'PDF_MISSING'
  | 'PDF_REPLACED'
  | 'PAPER_RECORD_REVISION_CONFLICT'
  | 'ANNOTATION_NOT_FOUND'
  | 'ANNOTATION_WRITE_FAILED'
  | 'DATA_INTEGRITY_ERROR';

export class AnnotationServiceError extends Error {
  constructor(
    readonly code: AnnotationServiceErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly details: Record<string, unknown> | null,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AnnotationServiceError';
  }
}

export type AnnotationFaultPoint =
  | 'journal_created'
  | 'temp_pdf_written'
  | 'worker_completed'
  | 'journal_ready_to_commit'
  | 'pdf_replaced'
  | 'before_record_commit';

export interface AnnotationServiceOptions {
  readonly injectFault?: (point: AnnotationFaultPoint) => void | Promise<void>;
}

export class AnnotationSimulatedCrashError extends Error {
  constructor(readonly point: AnnotationFaultPoint) {
    super(`Simulated annotation crash at ${point}`);
    this.name = 'AnnotationSimulatedCrashError';
  }
}

type MutationKind = 'create' | 'update' | 'delete';

interface MutationPlan {
  readonly kind: MutationKind;
  readonly expectedRecordRevision: number;
  readonly run: (absoluteTempPdfPath: string) => Promise<{
    annotation: PdfAnnotation | null;
    changed: boolean;
  }>;
  readonly deleted: boolean;
}

function nowUtc(): string {
  return new Date().toISOString();
}

function tempPdfPath(pdfPath: string, operationId: string): string {
  const directory = path.posix.dirname(pdfPath);
  const baseName = path.posix.basename(pdfPath, '.pdf');
  return `${directory}/.${baseName}.${operationId}.tmp.pdf`;
}

function parsePaperId(rawPaperId: string): string {
  const parsed = UuidSchema.safeParse(rawPaperId);
  if (!parsed.success) {
    throw new AnnotationServiceError(
      'REQUEST_INVALID',
      '论文 ID 不符合合同。',
      400,
      false,
      { fields: ['paper_id'] },
    );
  }
  return parsed.data;
}

function invalidRequest(error: z.ZodError): AnnotationServiceError {
  return new AnnotationServiceError(
    'REQUEST_INVALID',
    'Annotation 请求字段不符合合同。',
    400,
    false,
    { fields: [...new Set(error.issues.map((issue) => String(issue.path[0] ?? 'request')))] },
  );
}

function mapPdfError(error: unknown, paperId: string): never {
  if (
    (error instanceof VaultPathError && error.code === 'VAULT_PATH_NOT_FOUND')
    || (error as NodeJS.ErrnoException).code === 'ENOENT'
  ) {
    throw new AnnotationServiceError(
      'PDF_MISSING',
      '托管 PDF 不存在。',
      409,
      false,
      { paper_id: paperId },
      error,
    );
  }
  if (error instanceof VaultPathError) {
    throw new AnnotationServiceError(
      'DATA_INTEGRITY_ERROR',
      '托管 PDF 路径不符合安全合同。',
      500,
      false,
      { object_kind: 'managed_pdf', paper_id: paperId },
      error,
    );
  }
  throw error;
}

function expectedRecordConflict(current: PaperRecord, expectedRevision: number): AnnotationServiceError {
  return new AnnotationServiceError(
    'PAPER_RECORD_REVISION_CONFLICT',
    '论文记录已被其他操作更新，请重新载入。',
    409,
    true,
    { expected_revision: expectedRevision, actual_revision: current.record_revision },
  );
}

function asIntegrityError(error: unknown, paperId: string): AnnotationServiceError {
  if (error instanceof AnnotationServiceError) return error;
  if (error instanceof AnnotationRecoveryError) {
    return new AnnotationServiceError(
      'DATA_INTEGRITY_ERROR',
      error.message,
      500,
      false,
      { object_kind: 'annotation_operation', paper_id: paperId },
      error,
    );
  }
  return new AnnotationServiceError(
    'DATA_INTEGRITY_ERROR',
    'Annotation 写入后的数据状态无法安全确认。',
    500,
    false,
    { object_kind: 'annotation_operation', paper_id: paperId },
    error,
  );
}

export class AnnotationService {
  private readonly recovery: AnnotationRecoveryService;

  constructor(
    private readonly paperOperations: PaperOperationCoordinator = paperOperationCoordinator,
    private readonly pdfAccess: PaperPdfAccessCoordinator = paperPdfAccessCoordinator,
    private readonly worker: PdfAnnotationWorker = new PdfAnnotationWorker(),
    recovery?: AnnotationRecoveryService,
  ) {
    this.recovery = recovery ?? new AnnotationRecoveryService(paperOperations, pdfAccess);
  }

  async list(context: VaultContext, rawPaperId: string): Promise<PdfAnnotation[]> {
    const paperId = parsePaperId(rawPaperId);
    await this.recovery.recoverPaper(context, paperId);
    return this.paperOperations.runLifecycleRead(paperId, () => (
      this.pdfAccess.runRead(paperId, async () => {
        const paper = await this.readVerifiedPaper(context, paperId);
        return this.worker.list(paper.absolutePdfPath);
      })
    ));
  }

  async create(
    context: VaultContext,
    rawPaperId: string,
    rawRequest: unknown,
    options: AnnotationServiceOptions = {},
  ): Promise<AnnotationMutationResult> {
    const paperId = parsePaperId(rawPaperId);
    const parsed = CreateAnnotationRequestSchema.safeParse(rawRequest);
    if (!parsed.success) throw invalidRequest(parsed.error);
    const request = parsed.data;
    return this.mutate(context, paperId, {
      kind: 'create',
      expectedRecordRevision: request.expected_record_revision,
      deleted: false,
      run: async (absoluteTempPdfPath) => ({
        annotation: await this.worker.create(absoluteTempPdfPath, this.createWorkerPayload(request)),
        changed: true,
      }),
    }, options);
  }

  async update(
    context: VaultContext,
    rawPaperId: string,
    annotationId: string,
    rawRequest: unknown,
    options: AnnotationServiceOptions = {},
  ): Promise<AnnotationMutationResult> {
    const paperId = parsePaperId(rawPaperId);
    const parsed = UpdateAnnotationRequestSchema.safeParse(rawRequest);
    if (!parsed.success) throw invalidRequest(parsed.error);
    const request = parsed.data;
    if (annotationId.trim().length === 0) {
      throw new AnnotationServiceError('REQUEST_INVALID', 'Annotation ID 不符合合同。', 400, false, { fields: ['annotation_id'] });
    }
    return this.mutate(context, paperId, {
      kind: 'update',
      expectedRecordRevision: request.expected_record_revision,
      deleted: false,
      run: async (absoluteTempPdfPath) => {
        const annotation = await this.worker.update(
          absoluteTempPdfPath,
          this.updateWorkerPayload(annotationId, request),
        );
        return { annotation, changed: annotation !== null };
      },
    }, options);
  }

  async delete(
    context: VaultContext,
    rawPaperId: string,
    annotationId: string,
    rawRequest: unknown,
    options: AnnotationServiceOptions = {},
  ): Promise<AnnotationMutationResult> {
    const paperId = parsePaperId(rawPaperId);
    const parsed = DeleteAnnotationRequestSchema.safeParse(rawRequest);
    if (!parsed.success) throw invalidRequest(parsed.error);
    if (annotationId.trim().length === 0) {
      throw new AnnotationServiceError('REQUEST_INVALID', 'Annotation ID 不符合合同。', 400, false, { fields: ['annotation_id'] });
    }
    return this.mutate(context, paperId, {
      kind: 'delete',
      expectedRecordRevision: parsed.data.expected_record_revision,
      deleted: true,
      run: async (absoluteTempPdfPath) => ({
        annotation: null,
        changed: await this.worker.delete(absoluteTempPdfPath, annotationId),
      }),
    }, options);
  }

  private createWorkerPayload(request: CreateAnnotationRequest): CreatePdfAnnotationPayload {
    return {
      pdf_page_index: request.pdf_page_index,
      type: request.type,
      text: request.text,
      note: request.note,
      rects: request.rects,
    };
  }

  private updateWorkerPayload(
    annotationId: string,
    request: UpdateAnnotationRequest,
  ): UpdatePdfAnnotationPayload {
    const { expected_record_revision: _expectedRecordRevision, ...fields } = request;
    void _expectedRecordRevision;
    return { annotation_id: annotationId, ...fields };
  }

  private async mutate(
    context: VaultContext,
    paperId: string,
    plan: MutationPlan,
    options: AnnotationServiceOptions,
  ): Promise<AnnotationMutationResult> {
    await this.recovery.recoverPaper(context, paperId);
    return this.paperOperations.runMutation(paperId, () => (
      this.pdfAccess.runWrite(paperId, () => this.mutateLocked(
        context,
        paperId,
        plan,
        options,
      ))
    ));
  }

  private async mutateLocked(
    context: VaultContext,
    paperId: string,
    plan: MutationPlan,
    options: AnnotationServiceOptions,
  ): Promise<AnnotationMutationResult> {
    const papers = new PaperRepository(context);
    if (!await papers.exists(paperId)) {
      throw new AnnotationServiceError('PAPER_NOT_FOUND', '未找到该论文。', 404, false, { paper_id: paperId });
    }
    const paper = await papers.read(paperId);
    if (paper.record_revision !== plan.expectedRecordRevision) {
      throw expectedRecordConflict(paper, plan.expectedRecordRevision);
    }

    const pdfs = new ManagedPdfStore(context);
    let canonical;
    try {
      canonical = await pdfs.read(paper.pdf_path);
    } catch (error) {
      mapPdfError(error, paperId);
    }
    if (canonical.sha256 !== paper.managed_pdf_sha256) {
      throw new AnnotationServiceError(
        'PDF_REPLACED',
        '托管 PDF 已被 Lumer 之外的操作替换。',
        409,
        false,
        { paper_id: paperId },
      );
    }

    const operations = new AnnotationOperationRepository(context);
    if (await operations.exists(paperId)) {
      throw new AnnotationServiceError(
        'DATA_INTEGRITY_ERROR',
        '该论文存在未恢复的 Annotation journal。',
        500,
        false,
        { object_kind: 'annotation_operation', paper_id: paperId },
      );
    }

    const operationId = randomUUID();
    const createdAt = nowUtc();
    let operation: AnnotationOperation = {
      schema_version: STORAGE_SCHEMA_VERSION,
      operation_id: operationId,
      paper_id: paperId,
      pdf_path: paper.pdf_path,
      temp_pdf_path: tempPdfPath(paper.pdf_path, operationId),
      expected_record_revision: paper.record_revision,
      expected_pdf_revision: paper.pdf_revision,
      expected_managed_pdf_sha256: paper.managed_pdf_sha256,
      new_managed_pdf_sha256: null,
      phase: 'preparing',
      created_at: createdAt,
      updated_at: createdAt,
    };
    let journalCreated = false;
    let canonicalReplaced = false;
    let annotation: PdfAnnotation | null = null;

    try {
      await operations.create(operation);
      journalCreated = true;
      await options.injectFault?.('journal_created');

      await pdfs.writeStaged(canonical.absolutePath, operation.temp_pdf_path);
      await options.injectFault?.('temp_pdf_written');
      const absoluteTempPdfPath = await pdfs.absolutePath(operation.temp_pdf_path);
      const workerResult = await plan.run(absoluteTempPdfPath);
      annotation = workerResult.annotation;
      if (!workerResult.changed) {
        throw new AnnotationServiceError(
          'ANNOTATION_NOT_FOUND',
          plan.kind === 'delete' ? '未找到要删除的 Annotation。' : '未找到要更新的 Annotation。',
          404,
          false,
          { annotation_id: null },
        );
      }
      await options.injectFault?.('worker_completed');

      let baseline: Awaited<ReturnType<ExtractionRepository['read']>>;
      try {
        baseline = await new ExtractionRepository(context).read(paperId);
      } catch (error) {
        throw new AnnotationServiceError(
          'DATA_INTEGRITY_ERROR',
          'Annotation 缺少可验证的冻结正文基线。',
          500,
          false,
          { object_kind: 'extraction', paper_id: paperId },
          error,
        );
      }
      const extracted = await extractPdfText(absoluteTempPdfPath);
      if (extracted.contentHash !== baseline.content_hash) {
        throw new AnnotationServiceError(
          'DATA_INTEGRITY_ERROR',
          'Annotation 改变了阶段 2 冻结的正文文本，已拒绝提交。',
          500,
          false,
          { object_kind: 'extraction', paper_id: paperId },
        );
      }

      const newHash = await sha256File(absoluteTempPdfPath);
      operation = {
        ...operation,
        new_managed_pdf_sha256: newHash,
        phase: 'ready_to_commit',
        updated_at: nowUtc(),
      };
      await operations.update(operation);
      await options.injectFault?.('journal_ready_to_commit');

      await pdfs.replace(operation.temp_pdf_path, operation.pdf_path);
      canonicalReplaced = true;
      await options.injectFault?.('pdf_replaced');
      await options.injectFault?.('before_record_commit');

      const committedPaper = await papers.replace({
        ...paper,
        managed_pdf_sha256: newHash,
        pdf_revision: paper.pdf_revision + 1,
        record_revision: paper.record_revision + 1,
        updated_at: nowUtc(),
      });
      await operations.remove(paperId);
      return { annotation, deleted: plan.deleted, paper: committedPaper };
    } catch (error) {
      if (error instanceof AnnotationSimulatedCrashError) throw error;
      if (canonicalReplaced) {
        try {
          await this.recovery.recoverPaperLocked(context, paperId);
          const recoveredPaper = await papers.read(paperId);
          return { annotation, deleted: plan.deleted, paper: recoveredPaper };
        } catch (recoveryError) {
          throw asIntegrityError(recoveryError, paperId);
        }
      }

      if (journalCreated) {
        await removeVaultFile(context, operation.temp_pdf_path).catch(() => undefined);
        await operations.remove(paperId).catch(() => undefined);
      }
      if (error instanceof AnnotationServiceError) throw error;
      throw new AnnotationServiceError(
        'ANNOTATION_WRITE_FAILED',
        'Annotation 写入失败，未替换 canonical PDF。',
        500,
        true,
        { paper_id: paperId },
        error,
      );
    }
  }

  private async readVerifiedPaper(
    context: VaultContext,
    paperId: string,
  ): Promise<{ paper: PaperRecord; absolutePdfPath: string }> {
    const papers = new PaperRepository(context);
    if (!await papers.exists(paperId)) {
      throw new AnnotationServiceError('PAPER_NOT_FOUND', '未找到该论文。', 404, false, { paper_id: paperId });
    }
    const paper = await papers.read(paperId);
    let managed;
    try {
      managed = await new ManagedPdfStore(context).read(paper.pdf_path);
    } catch (error) {
      mapPdfError(error, paperId);
    }
    if (managed.sha256 !== paper.managed_pdf_sha256) {
      throw new AnnotationServiceError(
        'PDF_REPLACED',
        '托管 PDF 已被 Lumer 之外的操作替换。',
        409,
        false,
        { paper_id: paperId },
      );
    }
    return { paper, absolutePdfPath: managed.absolutePath };
  }
}
