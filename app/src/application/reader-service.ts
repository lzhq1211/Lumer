import {
  paperPdfAccessCoordinator,
  PaperPdfAccessCoordinator,
} from '@/application/paper-pdf-access-coordinator';
import { PaperRecord } from '@/domain/paper';
import { UuidSchema } from '@/domain/storage-types';
import { ManagedPdfStore } from '@/lib/storage/managed-pdf-store';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { VaultContext, VaultPathError } from '@/lib/storage/vault-path';

export type ReaderServiceErrorCode =
  | 'REQUEST_INVALID'
  | 'PAPER_NOT_FOUND'
  | 'PDF_MISSING'
  | 'PDF_REPLACED'
  | 'DATA_INTEGRITY_ERROR';

export class ReaderServiceError extends Error {
  constructor(
    readonly code: ReaderServiceErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly details: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = 'ReaderServiceError';
  }
}

export interface ManagedPdfRead {
  readonly paper: PaperRecord;
  readonly bytes: Buffer;
}

function parsePaperId(paperId: string): string {
  const result = UuidSchema.safeParse(paperId);
  if (!result.success) {
    throw new ReaderServiceError(
      'REQUEST_INVALID',
      '论文 ID 不符合合同。',
      400,
      false,
      { fields: ['paper_id'] },
    );
  }
  return result.data;
}

function mapPdfReadError(error: unknown, paperId: string): never {
  if (
    (error instanceof VaultPathError && error.code === 'VAULT_PATH_NOT_FOUND')
    || (error as NodeJS.ErrnoException).code === 'ENOENT'
  ) {
    throw new ReaderServiceError(
      'PDF_MISSING',
      '托管 PDF 不存在。',
      409,
      false,
      { paper_id: paperId },
    );
  }
  if (error instanceof VaultPathError) {
    throw new ReaderServiceError(
      'DATA_INTEGRITY_ERROR',
      '托管 PDF 路径不符合安全合同。',
      500,
      false,
      { object_kind: 'managed_pdf', paper_id: paperId },
    );
  }
  throw error;
}

export class ReaderService {
  constructor(
    private readonly pdfAccess: PaperPdfAccessCoordinator = paperPdfAccessCoordinator,
  ) {}

  async readManagedPdf(context: VaultContext, rawPaperId: string): Promise<ManagedPdfRead> {
    const paperId = parsePaperId(rawPaperId);
    return this.pdfAccess.runRead(paperId, async () => {
      const papers = new PaperRepository(context);
      if (!await papers.exists(paperId)) {
        throw new ReaderServiceError(
          'PAPER_NOT_FOUND',
          '未找到该论文。',
          404,
          false,
          { paper_id: paperId },
        );
      }

      const paper = await papers.read(paperId);
      let managedPdf: Awaited<ReturnType<ManagedPdfStore['read']>>;
      try {
        managedPdf = await new ManagedPdfStore(context).read(paper.pdf_path);
      } catch (error) {
        mapPdfReadError(error, paperId);
      }

      if (managedPdf.sha256 !== paper.managed_pdf_sha256) {
        throw new ReaderServiceError(
          'PDF_REPLACED',
          '托管 PDF 已被 Lumer 之外的操作替换。',
          409,
          false,
          { paper_id: paperId },
        );
      }

      return { paper, bytes: managedPdf.bytes };
    });
  }
}
