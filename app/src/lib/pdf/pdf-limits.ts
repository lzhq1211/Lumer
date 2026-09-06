import frozenLimits from '@/lib/pdf/pdf-limits.v1.json';

export interface PdfLimits {
  readonly max_file_bytes: number;
  readonly max_pages: number;
  readonly max_extracted_chars: number;
  readonly max_estimated_tokens: number;
}

export const PDF_LIMITS: PdfLimits = Object.freeze({
  max_file_bytes: frozenLimits.max_file_bytes,
  max_pages: frozenLimits.max_pages,
  max_extracted_chars: frozenLimits.max_extracted_chars,
  max_estimated_tokens: frozenLimits.max_estimated_tokens,
});

export const PDF_EXTRACTION_VERSION = 'pymupdf-1.28.2-text-sort-v1';

export function estimatePdfTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
}
