import { promises as fs } from 'node:fs';
import path from 'node:path';

import { PDF_LIMITS, PdfLimits } from '@/lib/pdf/pdf-limits';

export type PdfSupportErrorCode =
  | 'PDF_INVALID_EXTENSION'
  | 'PDF_INVALID_HEADER'
  | 'PDF_ENCRYPTED'
  | 'PDF_SCANNED'
  | 'PDF_CORRUPT'
  | 'PDF_LIMIT_EXCEEDED'
  | 'PDF_WORKER_UNAVAILABLE';

export class PdfSupportError extends Error {
  constructor(
    readonly code: PdfSupportErrorCode,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> | null = null,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PdfSupportError';
  }
}

export async function checkPdfContainer(
  pdfPath: string,
  limits: PdfLimits = PDF_LIMITS,
): Promise<{ fileSize: number }> {
  if (path.extname(pdfPath).toLowerCase() !== '.pdf') {
    throw new PdfSupportError('PDF_INVALID_EXTENSION', '只支持 .pdf 文件。', 422);
  }

  let stats;
  try {
    stats = await fs.stat(pdfPath);
  } catch (error) {
    throw new PdfSupportError('PDF_CORRUPT', 'PDF 文件无法读取。', 422, null, error);
  }
  if (!stats.isFile()) {
    throw new PdfSupportError('PDF_CORRUPT', 'PDF 输入不是普通文件。', 422);
  }
  if (stats.size > limits.max_file_bytes) {
    throw new PdfSupportError(
      'PDF_LIMIT_EXCEEDED',
      'PDF 文件大小超过限制。',
      413,
      { limit_kind: 'max_file_bytes', limit: limits.max_file_bytes, actual: stats.size },
    );
  }

  const handle = await fs.open(pdfPath, 'r');
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 5 || header.toString('ascii') !== '%PDF-') {
      throw new PdfSupportError('PDF_INVALID_HEADER', '文件头不是 PDF。', 422);
    }
  } finally {
    await handle.close();
  }
  return { fileSize: stats.size };
}
