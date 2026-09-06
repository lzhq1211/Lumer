import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ImportFaultPoint,
  ImportPaperService,
  ImportSimulatedCrashError,
} from '@/application/import-paper-service';
import { ImportRecoveryService } from '@/application/import-recovery-service';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { sha256File } from '@/lib/storage/file-hash';
import { ImportOperationRepository } from '@/lib/storage/import-operation-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import {
  createVaultContext,
  initializeVaultLayout,
  VaultContext,
} from '@/lib/storage/vault-path';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

let testRoot = '';
let vaultPath = '';
let sourcePath = '';
let context: VaultContext;

async function managedEntries(): Promise<Record<string, string[]>> {
  return {
    papers: await fs.readdir(path.join(vaultPath, '.lumer/papers')),
    extractions: await fs.readdir(path.join(vaultPath, '.lumer/extractions')),
    operations: await fs.readdir(path.join(vaultPath, '.lumer/operations/imports')),
    pdfs: await fs.readdir(path.join(vaultPath, 'Papers')),
  };
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-import-service-'));
  await generatePdfFixtures(testRoot);
  sourcePath = path.join(testRoot, 'single-column.pdf');
  vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('ImportPaperService', () => {
  it('commits the PDF, extraction and PaperRecord, then deduplicates without writes', async () => {
    const service = new ImportPaperService();
    const sourceHash = await sha256File(sourcePath);
    const first = await service.import(context, sourcePath, 'Research / source.pdf');

    expect(first.duplicate).toBe(false);
    expect(first.paper.source_sha256).toBe(sourceHash);
    expect(first.paper.managed_pdf_sha256).toBe(sourceHash);
    expect(first.paper.pdf_path).toMatch(/^Papers\/source--[a-f0-9]{8}\.pdf$/);
    expect(first.paper.original_file_name).toBe('source.pdf');
    expect(await sha256File(path.join(vaultPath, first.paper.pdf_path))).toBe(sourceHash);

    const extraction = await new ExtractionRepository(context).read(first.paper.paper_id);
    expect(extraction.paper_id).toBe(first.paper.paper_id);
    expect(extraction.source_sha256).toBe(sourceHash);
    expect(extraction.page_count).toBe(2);
    expect(await new PaperRepository(context).read(first.paper.paper_id)).toEqual(first.paper);
    expect((await managedEntries()).operations).toEqual([]);

    const snapshot = await managedEntries();
    const duplicate = await service.import(context, sourcePath, 'renamed.pdf');
    expect(duplicate).toEqual({ paper: first.paper, duplicate: true });
    expect(await managedEntries()).toEqual(snapshot);
  });

  it('serializes same-hash imports and commits at most one PaperRecord', async () => {
    const service = new ImportPaperService();
    const [left, right] = await Promise.all([
      service.import(context, sourcePath, 'left.pdf'),
      service.import(context, sourcePath, 'right.pdf'),
    ]);

    expect([left.duplicate, right.duplicate].sort()).toEqual([false, true]);
    expect(left.paper.paper_id).toBe(right.paper.paper_id);
    expect(await new PaperRepository(context).list()).toHaveLength(1);
  });

  it('does not run recovery across another active import journal', async () => {
    let releaseFirst!: () => void;
    let markFirstReady!: () => void;
    const firstReady = new Promise<void>((resolve) => { markFirstReady = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let secondReachedJournal = false;
    const service = new ImportPaperService();

    const first = service.import(context, sourcePath, 'first.pdf', {
      async injectFault(point) {
        if (point !== 'journal_created') return;
        markFirstReady();
        await firstRelease;
      },
    });
    await firstReady;

    const second = service.import(
      context,
      path.join(testRoot, 'two-column.pdf'),
      'second.pdf',
      {
        injectFault(point) {
          if (point === 'journal_created') secondReachedJournal = true;
        },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(secondReachedJournal).toBe(false);
    releaseFirst();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.duplicate).toBe(false);
    expect(secondResult.duplicate).toBe(false);
    expect(await new PaperRepository(context).list()).toHaveLength(2);
  });

  it('creates the journal before any operation-owned temp or canonical file', async () => {
    const service = new ImportPaperService();
    await service.import(context, sourcePath, 'ordered.pdf', {
      async injectFault(point) {
        if (point !== 'journal_created') return;
        const entries = await managedEntries();
        expect(entries.operations).toHaveLength(1);
        expect(entries.papers).toEqual([]);
        expect(entries.extractions).toEqual([]);
        expect(entries.pdfs).toEqual([]);
      },
    });
  });

  it('cleans all operation-owned files when an ordinary pre-commit failure occurs', async () => {
    await expect(new ImportPaperService().import(context, sourcePath, 'failed.pdf', {
      injectFault(point) {
        if (point === 'extraction_committed') throw new Error('injected failure');
      },
    })).rejects.toThrow('injected failure');

    await expect(managedEntries()).resolves.toEqual({
      papers: [],
      extractions: [],
      operations: [],
      pdfs: [],
    });
  });

  it.each([
    'journal_created',
    'temp_pdf_written',
    'temp_extraction_written',
    'journal_staged',
    'pdf_committed',
    'extraction_committed',
    'journal_files_committed',
    'before_paper_commit',
  ] satisfies ImportFaultPoint[])('recovers a simulated crash at %s without exposing a PaperRecord', async (faultPoint) => {
    await expect(new ImportPaperService().import(context, sourcePath, `${faultPoint}.pdf`, {
      injectFault(point) {
        if (point === faultPoint) throw new ImportSimulatedCrashError(point);
      },
    })).rejects.toMatchObject({ point: faultPoint });

    await new ImportRecoveryService().recover(context);
    await expect(managedEntries()).resolves.toEqual({
      papers: [],
      extractions: [],
      operations: [],
      pdfs: [],
    });
  });

  it('keeps a committed Paper and only clears its journal after a post-commit crash', async () => {
    await expect(new ImportPaperService().import(context, sourcePath, 'committed.pdf', {
      injectFault(point) {
        if (point === 'paper_committed') throw new ImportSimulatedCrashError(point);
      },
    })).rejects.toMatchObject({ point: 'paper_committed' });

    expect(await new PaperRepository(context).list()).toHaveLength(1);
    expect((await managedEntries()).operations).toHaveLength(1);
    await new ImportRecoveryService().recover(context);
    expect(await new PaperRepository(context).list()).toHaveLength(1);
    expect((await managedEntries()).operations).toEqual([]);
  });

  it('preserves an inconsistent preparing journal and reports data integrity', async () => {
    await expect(new ImportPaperService().import(context, sourcePath, 'integrity.pdf', {
      injectFault(point) {
        if (point === 'journal_created') throw new ImportSimulatedCrashError(point);
      },
    })).rejects.toMatchObject({ point: 'journal_created' });

    const [operation] = await new ImportOperationRepository(context).list();
    await fs.copyFile(sourcePath, path.join(vaultPath, operation.pdf_path));
    await expect(new ImportRecoveryService().recover(context)).rejects.toMatchObject({
      code: 'DATA_INTEGRITY_ERROR',
      paperId: operation.paper_id,
    });
    expect((await managedEntries()).operations).toHaveLength(1);
  });
});
