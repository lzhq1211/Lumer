export interface PageNavigation {
  readonly pdf_page_index: number;
  readonly display_page_number: number;
}

export class PageNavigationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageNavigationError';
  }
}

function assertPageCount(pageCount: number): void {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new PageNavigationError('PDF 页数必须是正整数。');
  }
}

export function pageNavigationFromPdfPageIndex(pdfPageIndex: number, pageCount: number): PageNavigation {
  assertPageCount(pageCount);
  if (!Number.isInteger(pdfPageIndex) || pdfPageIndex < 0 || pdfPageIndex >= pageCount) {
    throw new PageNavigationError('PDF 物理页索引超出范围。');
  }
  return {
    pdf_page_index: pdfPageIndex,
    display_page_number: pdfPageIndex + 1,
  };
}

export function pageNavigationFromDisplayPageNumber(displayPageNumber: number, pageCount: number): PageNavigation {
  assertPageCount(pageCount);
  if (!Number.isInteger(displayPageNumber) || displayPageNumber < 1 || displayPageNumber > pageCount) {
    throw new PageNavigationError('Reader 显示页码超出范围。');
  }
  return pageNavigationFromPdfPageIndex(displayPageNumber - 1, pageCount);
}

export function parseDisplayPageNumber(rawPage: string | null): number | null {
  if (rawPage === null || !/^\d+$/.test(rawPage)) return null;
  const pageNumber = Number(rawPage);
  return Number.isSafeInteger(pageNumber) && pageNumber >= 1 ? pageNumber : null;
}
