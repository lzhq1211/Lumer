import { createHash } from 'node:crypto';

export interface HashableExtractedPage {
  readonly pdf_page_index: number;
  readonly text: string;
}

export function computeExtractedContentHash(pages: readonly HashableExtractedPage[]): string {
  const hash = createHash('sha256');
  hash.update('LUMER-EXTRACTED-TEXT-v1\n', 'utf8');

  for (const page of pages) {
    const textBytes = Buffer.from(page.text, 'utf8');
    hash.update(`${page.pdf_page_index}\n${textBytes.byteLength}\n`, 'utf8');
    hash.update(textBytes);
    hash.update('\n', 'utf8');
  }

  return hash.digest('hex');
}
