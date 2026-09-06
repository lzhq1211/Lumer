import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PaperPdfAccessCoordinator } from '@/application/paper-pdf-access-coordinator';
import { ReaderService } from '@/application/reader-service';
import { PaperRecord } from '@/domain/paper';
import { PaperRepository } from '@/lib/storage/paper-repository';
import {
  createVaultContext,
  initializeVaultLayout,
  VaultContext,
} from '@/lib/storage/vault-path';

const PAPER_ID = '123e4567-e89b-42d3-a456-426614174000';
const PDF_PATH = 'Papers/reader--123e4567.pdf';
const PDF_BYTES = Buffer.from('%PDF-1.7\nreader fixture\n%%EOF\n');
const PDF_SHA = createHash('sha256').update(PDF_BYTES).digest('hex');

let testRoot = '';
let context: VaultContext;

function paperRecord(): PaperRecord {
  return {
    schema_version: 1,
    paper_id: PAPER_ID,
    source_sha256: PDF_SHA,
    managed_pdf_sha256: PDF_SHA,
    pdf_revision: 1,
    pdf_path: PDF_PATH,
    original_file_name: 'reader.pdf',
    title: 'Reader paper',
    authors: ['Ada Lovelace'],
    year: 2026,
    journal: null,
    doi: null,
    tags: [],
    status: 'reading',
    current_final_run_id: null,
    card_path: null,
    markdown_hash: null,
    markdown_sync_status: 'not_generated',
    pending_card_path: null,
    markdown_sync_context: null,
    markdown_sync_error: null,
    record_revision: 1,
    created_at: '2026-09-01T01:00:00.000Z',
    updated_at: '2026-09-01T01:00:00.000Z',
  };
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-reader-service-'));
  context = await createVaultContext(testRoot);
  await initializeVaultLayout(context);
  await fs.writeFile(path.join(testRoot, PDF_PATH), PDF_BYTES);
  await new PaperRepository(context).create(paperRecord());
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('ReaderService', () => {
  it('loads only the PaperRecord-managed PDF and verifies its current byte hash', async () => {
    const result = await new ReaderService().readManagedPdf(context, PAPER_ID);
    expect(result.paper).toMatchObject({ paper_id: PAPER_ID, pdf_path: PDF_PATH });
    expect(result.bytes).toEqual(PDF_BYTES);
  });

  it('rejects invalid IDs, missing records, missing bytes, and externally replaced bytes', async () => {
    await expect(new ReaderService().readManagedPdf(context, 'not-a-paper-id'))
      .rejects.toMatchObject({ code: 'REQUEST_INVALID', status: 400 });
    await expect(new ReaderService().readManagedPdf(context, '223e4567-e89b-42d3-a456-426614174001'))
      .rejects.toMatchObject({ code: 'PAPER_NOT_FOUND', status: 404 });

    await fs.rm(path.join(testRoot, PDF_PATH));
    await expect(new ReaderService().readManagedPdf(context, PAPER_ID))
      .rejects.toMatchObject({ code: 'PDF_MISSING', status: 409 });

    await fs.writeFile(path.join(testRoot, PDF_PATH), Buffer.from('%PDF-1.7\nreplaced\n%%EOF\n'));
    await expect(new ReaderService().readManagedPdf(context, PAPER_ID))
      .rejects.toMatchObject({ code: 'PDF_REPLACED', status: 409 });
  });
});

describe('PaperPdfAccessCoordinator', () => {
  it('allows concurrent readers and queues later readers behind a waiting writer', async () => {
    const coordinator = new PaperPdfAccessCoordinator();
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    let markSecondStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const firstReader = coordinator.runRead(PAPER_ID, async () => {
      events.push('reader-1:start');
      markFirstStarted();
      await firstGate;
      events.push('reader-1:end');
    });
    await firstStarted;

    const secondReader = coordinator.runRead(PAPER_ID, async () => {
      events.push('reader-2:start');
      markSecondStarted();
      events.push('reader-2:end');
    });
    await secondStarted;
    expect(events).toContain('reader-2:start');

    const writer = coordinator.runWrite(PAPER_ID, async () => {
      events.push('writer:start');
      await Promise.resolve();
      events.push('writer:end');
    });
    const queuedReader = coordinator.runRead(PAPER_ID, async () => {
      events.push('reader-3:start');
      events.push('reader-3:end');
    });

    releaseFirst();
    await Promise.all([firstReader, secondReader, writer, queuedReader]);
    expect(events.indexOf('writer:start')).toBeGreaterThan(events.indexOf('reader-1:end'));
    expect(events.indexOf('reader-3:start')).toBeGreaterThan(events.indexOf('writer:end'));
  });
});
