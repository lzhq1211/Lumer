import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AnnotationService,
  AnnotationSimulatedCrashError,
} from '@/application/annotation-service';
import { AnnotationRecoveryService } from '@/application/annotation-recovery-service';
import { PaperLibraryService } from '@/application/paper-library-service';
import { AnnotationOperationRepository } from '@/lib/storage/annotation-operation-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import {
  createVaultContext,
  initializeVaultLayout,
  VaultContext,
} from '@/lib/storage/vault-path';
import { ImportPaperService } from '@/application/import-paper-service';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

let testRoot = '';
let vaultPath = '';
let context: VaultContext;
let paperId = '';

async function importPaper(): Promise<void> {
  const result = await new ImportPaperService().import(
    context,
    path.join(testRoot, 'single-column.pdf'),
    'annotation-fixture.pdf',
  );
  paperId = result.paper.paper_id;
}

function createRequest(expectedRecordRevision: number) {
  return {
    expected_record_revision: expectedRecordRevision,
    pdf_page_index: 0,
    type: 'important' as const,
    text: 'Lumer annotation fixture',
    note: '',
    rects: [{ x: 0.1, y: 0.1, width: 0.25, height: 0.04 }],
  };
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-annotation-service-'));
  await generatePdfFixtures(testRoot);
  vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
  await importPaper();
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('AnnotationService', () => {
  it('creates, restores, updates and deletes native PDF annotations through paper_id', async () => {
    const service = new AnnotationService();
    const created = await service.create(context, paperId, createRequest(1));
    expect(created.deleted).toBe(false);
    expect(created.annotation).toMatchObject({
      pdf_page_index: 0,
      display_page_number: 1,
      type: 'important',
      text: 'Lumer annotation fixture',
      note: '',
    });
    expect(created.paper.record_revision).toBe(2);
    expect(created.paper.pdf_revision).toBe(2);

    const restored = await service.list(context, paperId);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.annotation_id).toBe(created.annotation?.annotation_id);

    const updated = await service.update(context, paperId, created.annotation!.annotation_id, {
      expected_record_revision: 2,
      type: 'unknown',
      note: '需要核对实验条件。',
    });
    expect(updated.annotation).toMatchObject({ type: 'unknown', note: '需要核对实验条件。' });
    expect(updated.paper.record_revision).toBe(3);

    const deleted = await service.delete(context, paperId, created.annotation!.annotation_id, {
      expected_record_revision: 3,
    });
    expect(deleted).toMatchObject({ annotation: null, deleted: true });
    expect(deleted.paper.record_revision).toBe(4);
    await expect(service.list(context, paperId)).resolves.toEqual([]);
  });

  it.each([
    'journal_created',
    'temp_pdf_written',
    'worker_completed',
    'journal_ready_to_commit',
  ] as const)('cleans a pre-rename crash at %s during recovery', async (point) => {
    const service = new AnnotationService();
    await expect(service.create(context, paperId, createRequest(1), {
      injectFault: (current) => {
        if (current === point) throw new AnnotationSimulatedCrashError(point);
      },
    })).rejects.toMatchObject({ point });

    await expect(new AnnotationOperationRepository(context).list()).resolves.toHaveLength(1);
    await new AnnotationRecoveryService().recover(context);
    await expect(new AnnotationOperationRepository(context).list()).resolves.toEqual([]);
    await expect(new PaperRepository(context).read(paperId)).resolves.toMatchObject({
      record_revision: 1,
      pdf_revision: 1,
    });
  });

  it.each(['pdf_replaced', 'before_record_commit'] as const)(
    'completes the PaperRecord commit after a post-rename crash at %s',
    async (point) => {
      const service = new AnnotationService();
      await expect(service.create(context, paperId, createRequest(1), {
        injectFault: (current) => {
          if (current === point) throw new AnnotationSimulatedCrashError(point);
        },
      })).rejects.toMatchObject({ point });

      await new AnnotationRecoveryService().recover(context);
      await expect(new AnnotationOperationRepository(context).list()).resolves.toEqual([]);
      await expect(new PaperRepository(context).read(paperId)).resolves.toMatchObject({
        record_revision: 2,
        pdf_revision: 2,
      });
      await expect(service.list(context, paperId)).resolves.toHaveLength(1);
    },
  );

  it('refuses an externally replaced PDF before it creates an Annotation journal', async () => {
    const paper = await new PaperRepository(context).read(paperId);
    await fs.appendFile(path.join(vaultPath, paper.pdf_path), '\n% external replacement\n');

    await expect(new AnnotationService().create(context, paperId, createRequest(1))).rejects.toMatchObject({
      code: 'PDF_REPLACED',
    });
    await expect(new AnnotationOperationRepository(context).list()).resolves.toEqual([]);
  });

  it('serializes Annotation and Metadata writes with the shared PaperRecord mutex', async () => {
    let releaseAnnotation!: () => void;
    let markAnnotationReady!: () => void;
    const annotationReady = new Promise<void>((resolve) => { markAnnotationReady = resolve; });
    const annotationRelease = new Promise<void>((resolve) => { releaseAnnotation = resolve; });
    const events: string[] = [];
    const annotationService = new AnnotationService();

    const annotation = annotationService.create(context, paperId, createRequest(1), {
      async injectFault(point) {
        if (point !== 'temp_pdf_written') return;
        events.push('annotation:holding-record-mutex');
        markAnnotationReady();
        await annotationRelease;
      },
    });
    await annotationReady;

    const metadata = new PaperLibraryService().updateMetadata(context, paperId, {
      expected_record_revision: 1,
      title: 'Metadata attempt after annotation',
    }).then(() => events.push('metadata:committed'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(['annotation:holding-record-mutex']);

    releaseAnnotation();
    await annotation;
    await expect(metadata).rejects.toMatchObject({ code: 'PAPER_RECORD_REVISION_CONFLICT' });
  });
});
