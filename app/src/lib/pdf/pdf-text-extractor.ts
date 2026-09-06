import { PDF_EXTRACTION_VERSION, PDF_LIMITS, PdfLimits } from '@/lib/pdf/pdf-limits';
import { checkPdfContainer, PdfSupportError } from '@/lib/pdf/pdf-support-check';
import { PdfWorkerError, runPdfWorker } from '@/lib/pdf/pdf-worker-client';
import { computeExtractedContentHash } from '@/lib/pdf/content-hash';

export interface PdfExtractionResult {
  readonly extractionVersion: string;
  readonly pymupdfVersion: string;
  readonly fileSize: number;
  readonly pageCount: number;
  readonly extractedCharCount: number;
  readonly estimatedTokens: number;
  readonly elapsedMs: number;
  readonly contentHash: string;
  readonly pages: Array<{
    readonly pdf_page_index: number;
    readonly display_page_number: number;
    readonly text: string;
  }>;
}

function mapWorkerError(error: PdfWorkerError): PdfSupportError {
  if (error.code === 'WORKER_UNAVAILABLE' || error.code === 'WORKER_PROTOCOL_ERROR') {
    return new PdfSupportError('PDF_WORKER_UNAVAILABLE', error.message, 503, null, error);
  }
  return new PdfSupportError(
    error.code,
    error.message,
    error.code === 'PDF_LIMIT_EXCEEDED' ? 413 : 422,
    error.details,
    error,
  );
}

export async function extractPdfText(
  pdfPath: string,
  limits: PdfLimits = PDF_LIMITS,
): Promise<PdfExtractionResult> {
  const { fileSize } = await checkPdfContainer(pdfPath, limits);
  try {
    const extracted = await runPdfWorker(pdfPath, limits);
    return {
      extractionVersion: PDF_EXTRACTION_VERSION,
      pymupdfVersion: extracted.pymupdf_version,
      fileSize,
      pageCount: extracted.page_count,
      extractedCharCount: extracted.extracted_char_count,
      estimatedTokens: extracted.estimated_tokens,
      elapsedMs: extracted.elapsed_ms,
      contentHash: computeExtractedContentHash(extracted.pages),
      pages: extracted.pages,
    };
  } catch (error) {
    if (error instanceof PdfWorkerError) throw mapWorkerError(error);
    throw error;
  }
}
