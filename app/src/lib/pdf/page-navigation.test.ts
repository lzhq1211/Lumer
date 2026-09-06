import { describe, expect, it } from 'vitest';

import {
  PageNavigationError,
  pageNavigationFromDisplayPageNumber,
  pageNavigationFromPdfPageIndex,
  parseDisplayPageNumber,
} from '@/lib/pdf/page-navigation';

describe('Page navigation bridge', () => {
  it('maps the first and last physical PDF pages to one-based Reader pages', () => {
    expect(pageNavigationFromPdfPageIndex(0, 2)).toEqual({
      pdf_page_index: 0,
      display_page_number: 1,
    });
    expect(pageNavigationFromPdfPageIndex(1, 2)).toEqual({
      pdf_page_index: 1,
      display_page_number: 2,
    });
    expect(pageNavigationFromDisplayPageNumber(2, 2)).toEqual({
      pdf_page_index: 1,
      display_page_number: 2,
    });
  });

  it('rejects invalid page counts and indexes without silently wrapping', () => {
    expect(() => pageNavigationFromPdfPageIndex(-1, 2)).toThrow(PageNavigationError);
    expect(() => pageNavigationFromPdfPageIndex(2, 2)).toThrow(PageNavigationError);
    expect(() => pageNavigationFromDisplayPageNumber(0, 2)).toThrow(PageNavigationError);
    expect(() => pageNavigationFromDisplayPageNumber(3, 2)).toThrow(PageNavigationError);
    expect(() => pageNavigationFromDisplayPageNumber(1, 0)).toThrow(PageNavigationError);
  });

  it('accepts only positive integer URL page values', () => {
    expect(parseDisplayPageNumber('2')).toBe(2);
    expect(parseDisplayPageNumber('02')).toBe(2);
    expect(parseDisplayPageNumber(null)).toBeNull();
    expect(parseDisplayPageNumber('0')).toBeNull();
    expect(parseDisplayPageNumber('-1')).toBeNull();
    expect(parseDisplayPageNumber('1.5')).toBeNull();
    expect(parseDisplayPageNumber('two')).toBeNull();
  });
});
