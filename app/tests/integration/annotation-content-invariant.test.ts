import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AnnotationFaultPoint,
  AnnotationService,
  AnnotationSimulatedCrashError,
} from '@/application/annotation-service';
import { AnnotationRecoveryService } from '@/application/annotation-recovery-service';
import { ExtractedPaper } from '@/domain/paper';
import { extractPdfText } from '@/lib/pdf/pdf-text-extractor';
import { AnnotationOperationRepository } from '@/lib/storage/annotation-operation-repository';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { ManagedPdfStore } from '@/lib/storage/managed-pdf-store';
import { PaperRepository } from '@/lib/storage/paper-repository';
import {
  createVaultContext,
  initializeVaultLayout,
  VaultContext,
} from '@/lib/storage/vault-path';
import { ImportPaperService } from '@/application/import-paper-service';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

const FIXTURES = ['single-column.pdf', 'two-column.pdf'] as const;
const CREATE_TEXT = 'ANNOTATION_CREATE_TEXT_MUST_NOT_ENTER_EXTRACTION';
const UPDATED_TEXT = 'ANNOTATION_UPDATED_TEXT_MUST_NOT_ENTER_EXTRACTION';
const MEMO = 'ANNOTATION_MEMO_MUST_NOT_ENTER_EXTRACTION';

type FixtureName = (typeof FIXTURES)[number];
type CrashScenario = {
  operation: 'create' | 'delete';
  point: Extract<AnnotationFaultPoint, 'journal_ready_to_commit' | 'pdf_replaced'>;
};

const CRASH_SCENARIOS: CrashScenario[] = [
  { operation: 'create', point: 'journal_ready_to_commit' },
  { operation: 'create', point: 'pdf_replaced' },
  { operation: 'delete', point: 'journal_ready_to_commit' },
  { operation: 'delete', point: 'pdf_replaced' },
];

interface ImportedFixture {
  readonly paperId: string;
  readonly baseline: ExtractedPaper;
}

let testRoot = '';
let vaultPath = '';
let context: VaultContext;

async function importFixture(fileName: FixtureName): Promise<ImportedFixture> {
  const imported = await new ImportPaperService().import(
    context,
    path.join(testRoot, fileName),
    fileName,
  );
  return {
    paperId: imported.paper.paper_id,
    baseline: await new ExtractionRepository(context).read(imported.paper.paper_id),
  };
}

function createRequest(expectedRecordRevision: number) {
  return {
    expected_record_revision: expectedRecordRevision,
    pdf_page_index: 0,
    type: 'important' as const,
    text: CREATE_TEXT,
    note: '',
    rects: [{ x: 0.1, y: 0.1, width: 0.25, height: 0.04 }],
  };
}

async function expectFrozenExtraction(fixture: ImportedFixture): Promise<void> {
  const paper = await new PaperRepository(context).read(fixture.paperId);
  const absolutePdfPath = await new ManagedPdfStore(context).absolutePath(paper.pdf_path);
  const observed = await extractPdfText(absolutePdfPath);
  const persisted = await new ExtractionRepository(context).read(fixture.paperId);

  expect(persisted).toEqual(fixture.baseline);
  expect(observed.contentHash).toBe(fixture.baseline.content_hash);
  expect(observed.pages).toEqual(fixture.baseline.pages);
  expect(observed.pages.map((page) => page.text).join('\n')).not.toContain(CREATE_TEXT);
  expect(observed.pages.map((page) => page.text).join('\n')).not.toContain(UPDATED_TEXT);
  expect(observed.pages.map((page) => page.text).join('\n')).not.toContain(MEMO);
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-annotation-invariant-'));
  await generatePdfFixtures(testRoot);
  vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('3C Annotation content_hash invariant', () => {
  it.each(FIXTURES)(
    'keeps every extracted page and content_hash frozen across create, update and delete for %s',
    async (fileName) => {
      const fixture = await importFixture(fileName);
      const service = new AnnotationService();
      await expectFrozenExtraction(fixture);

      const created = await service.create(context, fixture.paperId, createRequest(1));
      await expectFrozenExtraction(fixture);

      const updated = await service.update(context, fixture.paperId, created.annotation!.annotation_id, {
        expected_record_revision: created.paper.record_revision,
        type: 'unknown',
        text: UPDATED_TEXT,
        note: MEMO,
      });
      await expectFrozenExtraction(fixture);

      await service.delete(context, fixture.paperId, created.annotation!.annotation_id, {
        expected_record_revision: updated.paper.record_revision,
      });
      await expectFrozenExtraction(fixture);
    },
    15_000,
  );

  it.each(FIXTURES.flatMap((fileName) => CRASH_SCENARIOS.map((scenario) => ({ fileName, ...scenario }))))(
    'keeps frozen extraction through %s %s recovery for $fileName',
    async ({ fileName, operation, point }) => {
      const fixture = await importFixture(fileName);
      const service = new AnnotationService();
      let annotationId: string | null = null;
      let expectedRevision = 1;

      if (operation === 'delete') {
        const created = await service.create(context, fixture.paperId, createRequest(1));
        annotationId = created.annotation!.annotation_id;
        expectedRevision = created.paper.record_revision;
        await expectFrozenExtraction(fixture);
      }

      const crash = (current: AnnotationFaultPoint) => {
        if (current === point) throw new AnnotationSimulatedCrashError(point);
      };
      if (operation === 'create') {
        await expect(service.create(context, fixture.paperId, createRequest(expectedRevision), { injectFault: crash }))
          .rejects.toMatchObject({ point });
      } else {
        await expect(service.delete(context, fixture.paperId, annotationId!, {
          expected_record_revision: expectedRevision,
        }, { injectFault: crash })).rejects.toMatchObject({ point });
      }

      await expectFrozenExtraction(fixture);
      await new AnnotationRecoveryService().recover(context);
      await expect(new AnnotationOperationRepository(context).list()).resolves.toEqual([]);
      await expectFrozenExtraction(fixture);

      const annotations = await service.list(context, fixture.paperId);
      const expectedCount = (
        (operation === 'create' && point === 'pdf_replaced')
        || (operation === 'delete' && point === 'journal_ready_to_commit')
      ) ? 1 : 0;
      expect(annotations).toHaveLength(expectedCount);
    },
    15_000,
  );
});
