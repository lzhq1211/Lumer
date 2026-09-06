import { describe, expect, it } from 'vitest';

import { computeExtractedContentHash } from '@/lib/pdf/content-hash';
import { estimatePdfTokens } from '@/lib/pdf/pdf-limits';

describe('Extracted content identity', () => {
  it('uses UTF-8 byte lengths and physical page indexes', () => {
    expect(computeExtractedContentHash([
      { pdf_page_index: 0, text: 'A' },
      { pdf_page_index: 1, text: '中' },
    ])).toBe('baef5569c0f2914911caaf8514403e14dd2cc28bce61f1d3fd9a21a60eedfc52');
  });

  it('estimates tokens conservatively from UTF-8 bytes', () => {
    expect(estimatePdfTokens('abcdef')).toBe(2);
    expect(estimatePdfTokens('中文')).toBe(2);
  });
});
