import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PaperLibraryService,
  PaperLibraryServiceError,
} from '@/application/paper-library-service';
import { AnalysisRun } from '@/domain/analysis-run';
import { PaperRecord } from '@/domain/paper';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { VersionedJsonRepository } from '@/lib/storage/versioned-json-repository';
import {
  createVaultContext,
  initializeVaultLayout,
  VaultContext,
} from '@/lib/storage/vault-path';
import { analysisRun, draftRun } from '../helpers/analysis-run-fixture';

const FIRST_ID = '123e4567-e89b-42d3-a456-426614174000';
const SECOND_ID = '223e4567-e89b-42d3-a456-426614174001';
const FIRST_SHA = 'a'.repeat(64);
const SECOND_SHA = 'b'.repeat(64);
const RUN_PREVIEW_ID = '323e4567-e89b-42d3-a456-426614174010';
const RUN_DRAFT_ID = '323e4567-e89b-42d3-a456-426614174011';
const RUN_FINAL_ID = '323e4567-e89b-42d3-a456-426614174012';
const RUN_TIE_LOW_ID = '323e4567-e89b-42d3-a456-426614174013';
const RUN_TIE_HIGH_ID = '323e4567-e89b-42d3-a456-426614174014';
const RUN_FINALIZING_ID = '323e4567-e89b-42d3-a456-426614174015';
const RUN_RUNNING_ID = '323e4567-e89b-42d3-a456-426614174016';
const RUN_FAILED_ID = '323e4567-e89b-42d3-a456-426614174017';
const RUN_CANCELLED_ID = '323e4567-e89b-42d3-a456-426614174018';
const RUN_INTERRUPTED_ID = '323e4567-e89b-42d3-a456-426614174019';

let testRoot = '';
let context: VaultContext;

function finalizationContext() {
  return {
    expected_draft_revision: 1,
    expected_paper_record_revision: 1,
    markdown_action: 'create' as const,
    target_card_path: 'Paper Cards/alpha--123e4567.md',
    expected_markdown_hash: null,
  };
}

async function createPreviewRun(repository: AnalysisRunRepository, runId: string, updatedAt: string): Promise<AnalysisRun> {
  const running = analysisRun({
    paper_id: FIRST_ID,
    analysis_run_id: runId,
    provider_session_id: `session-${runId}`,
    updated_at: '2026-09-01T02:01:00.000Z',
  });
  await repository.create(running);
  const preview = { ...running, state: 'preview' as const, updated_at: updatedAt };
  await repository.replace(preview);
  return preview;
}

async function createDraftRun(repository: AnalysisRunRepository, runId: string, updatedAt: string): Promise<AnalysisRun> {
  const draft = draftRun({
    paper_id: FIRST_ID,
    analysis_run_id: runId,
    derived_from_run_id: SECOND_ID,
    provider_session_id: `session-${runId}`,
    updated_at: updatedAt,
  });
  await repository.create(draft);
  return draft;
}

async function createFinalizedRun(repository: AnalysisRunRepository, runId: string, updatedAt: string): Promise<AnalysisRun> {
  const draft = await createDraftRun(repository, runId, '2026-09-01T03:00:00.000Z');
  const finalizing = {
    ...draft,
    state: 'finalizing' as const,
    finalization_context: finalizationContext(),
    updated_at: '2026-09-01T03:01:00.000Z',
  };
  await repository.replace(finalizing);
  const finalized = {
    ...finalizing,
    state: 'finalized' as const,
    finalized_at: updatedAt,
    updated_at: updatedAt,
  };
  await repository.replace(finalized);
  return finalized;
}

async function createIgnoredRun(
  repository: AnalysisRunRepository,
  runId: string,
  state: 'failed' | 'cancelled' | 'interrupted',
): Promise<void> {
  const running = analysisRun({
    paper_id: FIRST_ID,
    analysis_run_id: runId,
    provider_session_id: `session-${runId}`,
    updated_at: '2026-09-01T02:01:00.000Z',
  });
  await repository.create(running);
  await repository.replace({
    ...running,
    state,
    updated_at: '2026-09-01T09:00:00.000Z',
    ...(state === 'failed' || state === 'interrupted'
      ? { failure_stage: state, failure_message: `${state} fixture` }
      : {}),
  });
}

function paperRecord(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    schema_version: 1,
    paper_id: FIRST_ID,
    source_sha256: FIRST_SHA,
    managed_pdf_sha256: FIRST_SHA,
    pdf_revision: 1,
    pdf_path: 'Papers/alpha--123e4567.pdf',
    original_file_name: 'alpha.pdf',
    title: 'Alpha oscillations',
    authors: ['Ada Lovelace'],
    year: 2025,
    journal: 'Research Journal',
    doi: '10.1000/alpha',
    tags: ['EEG', 'Methods'],
    status: 'inbox',
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
    ...overrides,
  };
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-paper-library-'));
  const vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
  const papers = new PaperRepository(context);
  await papers.create(paperRecord());
  await papers.create(paperRecord({
    paper_id: SECOND_ID,
    source_sha256: SECOND_SHA,
    managed_pdf_sha256: SECOND_SHA,
    pdf_path: 'Papers/beta--223e4567.pdf',
    original_file_name: 'beta.pdf',
    title: 'Beta development',
    authors: ['Grace Hopper'],
    year: null,
    journal: null,
    doi: '10.1000/beta',
    tags: ['Development'],
    status: 'reading',
    updated_at: '2026-09-01T02:00:00.000Z',
  }));
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('PaperLibraryService', () => {
  it('lists deterministically and filters title, author, DOI, status and exact tag', async () => {
    const service = new PaperLibraryService();
    const all = await service.list(context, { search: null, status: null, tag: null });
    expect(all.map((summary) => summary.paper.paper_id)).toEqual([SECOND_ID, FIRST_ID]);
    expect(all.every((summary) => summary.has_current_final === false)).toBe(true);
    expect(all.every((summary) => summary.latest_analysis === null)).toBe(true);

    await expect(service.list(context, { search: 'ada', status: null, tag: null }))
      .resolves.toMatchObject([{ paper: { paper_id: FIRST_ID } }]);
    await expect(service.list(context, { search: '10.1000/beta', status: null, tag: null }))
      .resolves.toMatchObject([{ paper: { paper_id: SECOND_ID } }]);
    await expect(service.list(context, { search: null, status: 'reading', tag: null }))
      .resolves.toMatchObject([{ paper: { paper_id: SECOND_ID } }]);
    await expect(service.list(context, { search: null, status: null, tag: 'EEG' }))
      .resolves.toMatchObject([{ paper: { paper_id: FIRST_ID } }]);
    await expect(service.list(context, { search: null, status: null, tag: 'eeg' }))
      .resolves.toEqual([]);
  });

  it.each([
    ['preview', async (repository: AnalysisRunRepository) => createPreviewRun(repository, RUN_PREVIEW_ID, '2026-09-01T03:00:00.000Z')],
    ['draft', async (repository: AnalysisRunRepository) => createDraftRun(repository, RUN_DRAFT_ID, '2026-09-01T03:00:00.000Z')],
    ['finalized', async (repository: AnalysisRunRepository) => createFinalizedRun(repository, RUN_FINAL_ID, '2026-09-01T03:02:00.000Z')],
  ])('exposes a single %s Run as the latest analysis summary', async (_state, create) => {
    const repository = new AnalysisRunRepository(context);
    const run = await create(repository);

    await expect(new PaperLibraryService().list(context, { search: null, status: null, tag: null }))
      .resolves.toContainEqual(expect.objectContaining({
        paper: expect.objectContaining({ paper_id: FIRST_ID }),
        latest_analysis: {
          analysis_run_id: run.analysis_run_id,
          state: run.state,
          provider: run.provider,
          model: run.model,
          updated_at: run.updated_at,
        },
      }));
  });

  it('selects the newest generated Run, uses descending ID as the tie-break, and excludes non-results', async () => {
    const repository = new AnalysisRunRepository(context);
    await createFinalizedRun(repository, RUN_FINAL_ID, '2026-09-01T04:00:00.000Z');
    await createPreviewRun(repository, RUN_PREVIEW_ID, '2026-09-01T05:00:00.000Z');
    await createDraftRun(repository, RUN_DRAFT_ID, '2026-09-01T06:00:00.000Z');
    await createDraftRun(repository, RUN_TIE_LOW_ID, '2026-09-01T07:00:00.000Z');
    await createDraftRun(repository, RUN_TIE_HIGH_ID, '2026-09-01T07:00:00.000Z');
    await repository.create(analysisRun({
      paper_id: FIRST_ID,
      analysis_run_id: RUN_RUNNING_ID,
      provider_session_id: `session-${RUN_RUNNING_ID}`,
      updated_at: '2026-09-01T08:00:00.000Z',
    }));
    await createIgnoredRun(repository, RUN_FAILED_ID, 'failed');
    await createIgnoredRun(repository, RUN_CANCELLED_ID, 'cancelled');
    await createIgnoredRun(repository, RUN_INTERRUPTED_ID, 'interrupted');

    const [summary] = await new PaperLibraryService().list(context, { search: 'Alpha', status: null, tag: null });
    expect(summary.latest_analysis).toMatchObject({
      analysis_run_id: RUN_TIE_HIGH_ID,
      state: 'draft',
      updated_at: '2026-09-01T07:00:00.000Z',
    });
  });

  it('uses a current Finalizing Run only as a fallback when no generated result exists', async () => {
    const repository = new AnalysisRunRepository(context);
    const finalizing = await createDraftRun(repository, RUN_FINALIZING_ID, '2026-09-01T03:00:00.000Z');
    const runningFinalizing = {
      ...finalizing,
      state: 'finalizing' as const,
      finalization_context: finalizationContext(),
      updated_at: '2026-09-01T03:01:00.000Z',
    };
    await repository.replace(runningFinalizing);
    const paper = await new PaperRepository(context).read(FIRST_ID);
    await new PaperRepository(context).replace({ ...paper, current_final_run_id: RUN_FINALIZING_ID });

    const [summary] = await new PaperLibraryService().list(context, { search: 'Alpha', status: null, tag: null });
    expect(summary.latest_analysis).toMatchObject({
      analysis_run_id: RUN_FINALIZING_ID,
      state: 'finalizing',
    });

    await new PaperRepository(context).replace({ ...paper, current_final_run_id: null });
    const [withoutPointer] = await new PaperLibraryService().list(context, { search: 'Alpha', status: null, tag: null });
    expect(withoutPointer.latest_analysis).toBeNull();
  });

  it('returns detail with extraction availability', async () => {
    const json = new VersionedJsonRepository(context, 'extracted_paper');
    await json.write(`.lumer/extractions/${FIRST_ID}.json`, {
      schema_version: 1,
      extraction_version: 'pymupdf-text-v1',
      paper_id: FIRST_ID,
      source_sha256: FIRST_SHA,
      content_hash: 'c'.repeat(64),
      page_count: 1,
      extracted_char_count: 5,
      pages: [{ pdf_page_index: 0, display_page_number: 1, text: 'Alpha' }],
      created_at: '2026-09-01T01:00:00.000Z',
    });

    await expect(new PaperLibraryService().detail(context, FIRST_ID)).resolves.toMatchObject({
      paper: { paper_id: FIRST_ID },
      extraction_available: true,
      current_final: null,
    });
  });

  it('normalizes and atomically persists only mutable Metadata with one revision increment', async () => {
    const updated = await new PaperLibraryService().updateMetadata(context, FIRST_ID, {
      expected_record_revision: 1,
      title: '  Updated title  ',
      authors: ['  Ada Lovelace  ', 'Alan Turing'],
      year: null,
      journal: null,
      doi: '  10.1000/updated  ',
      tags: [' EEG ', 'Reviewed'],
      status: 'read',
    });

    expect(updated).toMatchObject({
      title: 'Updated title',
      authors: ['Ada Lovelace', 'Alan Turing'],
      year: null,
      journal: null,
      doi: '10.1000/updated',
      tags: ['EEG', 'Reviewed'],
      status: 'read',
      record_revision: 2,
      source_sha256: FIRST_SHA,
      pdf_path: 'Papers/alpha--123e4567.pdf',
    });
    await expect(new PaperRepository(context).read(FIRST_ID)).resolves.toEqual(updated);
  });

  it('serializes concurrent updates and rejects the stale revision without lost writes', async () => {
    const service = new PaperLibraryService();
    const results = await Promise.allSettled([
      service.updateMetadata(context, FIRST_ID, {
        expected_record_revision: 1,
        status: 'reading',
      }),
      service.updateMetadata(context, FIRST_ID, {
        expected_record_revision: 1,
        tags: ['Concurrent'],
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: {
        code: 'PAPER_RECORD_REVISION_CONFLICT',
        details: { expected_revision: 1, actual_revision: 2 },
      },
    });
    expect((await new PaperRepository(context).read(FIRST_ID)).record_revision).toBe(2);
  });

  it.each([
    { expected_record_revision: 1 },
    { expected_record_revision: 1, tags: ['EEG', ' EEG '] },
    { expected_record_revision: 1, source_sha256: SECOND_SHA },
  ])('rejects empty, duplicate-tag or immutable-field patches: %j', async (patch) => {
    await expect(new PaperLibraryService().updateMetadata(context, FIRST_ID, patch))
      .rejects.toMatchObject({ code: 'REQUEST_INVALID' } satisfies Partial<PaperLibraryServiceError>);
    expect((await new PaperRepository(context).read(FIRST_ID)).record_revision).toBe(1);
  });
});
