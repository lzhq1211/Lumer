import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PDF_LIMITS } from '@/lib/pdf/pdf-limits';
import { PdfSupportError } from '@/lib/pdf/pdf-support-check';
import { extractPdfText } from '@/lib/pdf/pdf-text-extractor';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

let testRoot = '';

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-pdf-support-'));
  await generatePdfFixtures(testRoot);
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('PDF support and extraction', () => {
  it('extracts single-column text by physical page deterministically', async () => {
    const pdfPath = path.join(testRoot, 'single-column.pdf');
    const first = await extractPdfText(pdfPath);
    const second = await extractPdfText(pdfPath);

    expect(first.pageCount).toBe(2);
    expect(first.pages.map((page) => page.pdf_page_index)).toEqual([0, 1]);
    expect(first.pages.map((page) => page.display_page_number)).toEqual([1, 2]);
    expect(first.pages[0].text).toContain('Physical page 1');
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.pymupdfVersion).toBe('1.28.2');
  });

  it('extracts both columns without losing their text', async () => {
    const result = await extractPdfText(path.join(testRoot, 'two-column.pdf'));
    expect(result.pages[0].text).toContain('Left column page 1');
    expect(result.pages[0].text).toContain('Right column page 1');
  });

  it.each([
    ['scanned.pdf', 'PDF_SCANNED'],
    ['encrypted.pdf', 'PDF_ENCRYPTED'],
    ['corrupt.pdf', 'PDF_CORRUPT'],
  ] as const)('rejects unsupported input %s with %s', async (fileName, code) => {
    if (fileName === 'corrupt.pdf') {
      await fs.writeFile(path.join(testRoot, fileName), '%PDF-1.7\ncorrupt');
    }
    await expect(extractPdfText(path.join(testRoot, fileName))).rejects.toMatchObject({
      code,
      status: 422,
      details: null,
    } satisfies Partial<PdfSupportError>);
  });

  it('rejects invalid extensions and headers before spawning the worker', async () => {
    await fs.writeFile(path.join(testRoot, 'not-pdf.txt'), '%PDF-1.7');
    await fs.writeFile(path.join(testRoot, 'bad-header.pdf'), 'not a pdf');
    await expect(extractPdfText(path.join(testRoot, 'not-pdf.txt'))).rejects.toMatchObject({
      code: 'PDF_INVALID_EXTENSION',
    } satisfies Partial<PdfSupportError>);
    await expect(extractPdfText(path.join(testRoot, 'bad-header.pdf'))).rejects.toMatchObject({
      code: 'PDF_INVALID_HEADER',
    } satisfies Partial<PdfSupportError>);
  });

  it.each([
    ['max_file_bytes', 'single-column.pdf', { ...PDF_LIMITS, max_file_bytes: 10 }],
    ['max_pages', 'three-pages.pdf', { ...PDF_LIMITS, max_pages: 2 }],
    ['max_extracted_chars', 'single-column.pdf', { ...PDF_LIMITS, max_extracted_chars: 20 }],
    ['max_estimated_tokens', 'single-column.pdf', { ...PDF_LIMITS, max_estimated_tokens: 5 }],
  ] as const)('returns safe limit details for %s', async (limitKind, fileName, limits) => {
    await expect(extractPdfText(path.join(testRoot, fileName), limits)).rejects.toMatchObject({
      code: 'PDF_LIMIT_EXCEEDED',
      status: 413,
      details: {
        limit_kind: limitKind,
        limit: limits[limitKind],
      },
    } satisfies Partial<PdfSupportError>);
  });
});
