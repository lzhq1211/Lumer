import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PaperLibraryService } from '@/application/paper-library-service';
import { PaperRecord } from '@/domain/paper';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { createVaultContext, initializeVaultLayout, VaultContext } from '@/lib/storage/vault-path';
import { PAPER_ID, SHA_256, draftRun } from '../helpers/analysis-run-fixture';

let testRoot = '';
let context: VaultContext;

function paperRecord(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    schema_version: 1,
    paper_id: PAPER_ID,
    source_sha256: SHA_256,
    managed_pdf_sha256: SHA_256,
    pdf_revision: 1,
    pdf_path: 'Papers/alpha--123e4567.pdf',
    original_file_name: 'alpha.pdf',
    title: 'Imported filename title',
    authors: [],
    year: null,
    journal: null,
    doi: null,
    tags: ['Manual tag'],
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
    ...overrides,
  };
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-metadata-candidate-'));
  const vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
  await new PaperRepository(context).create(paperRecord());
});

afterEach(async () => { await fs.rm(testRoot, { recursive: true, force: true }); });

async function persistDraft(run: ReturnType<typeof draftRun>) {
  const repository = new AnalysisRunRepository(context);
  await repository.create({
    ...run,
    state: 'running',
    draft_revision: 0,
    provider_session_id: null,
    paper_analysis: null,
  });
  return repository.replace(run);
}

describe('Metadata Candidate', () => {
  it('keeps Analyze metadata in the Run until the user explicitly accepts it', async () => {
    const run = draftRun({
      paper_analysis: {
        ...draftRun().paper_analysis!,
        metadata_candidate: {
          title: '  Candidate title  ',
          authors: [' Ada Lovelace ', 'Grace Hopper'],
          year: 2026,
          journal: '  Nature Communications ',
          doi: ' 10.1000/candidate ',
        },
      },
    });
    await persistDraft(run);

    await expect(new PaperRepository(context).read(PAPER_ID)).resolves.toMatchObject({
      title: 'Imported filename title', authors: [], record_revision: 1,
    });

    const accepted = await new PaperLibraryService().acceptMetadataCandidate(context, run.analysis_run_id, {
      expected_draft_revision: 1,
      expected_paper_record_revision: 1,
    });

    expect(accepted).toMatchObject({
      title: 'Candidate title',
      authors: ['Ada Lovelace', 'Grace Hopper'],
      year: 2026,
      journal: 'Nature Communications',
      doi: '10.1000/candidate',
      tags: ['Manual tag'],
      status: 'reading',
      record_revision: 2,
    });
    await expect(new AnalysisRunRepository(context).read(PAPER_ID, run.analysis_run_id)).resolves.toMatchObject({
      paper_analysis: { metadata_candidate: { title: '  Candidate title  ' } },
    });
  });

  it('preserves candidate-missing manual fields and rejects stale or empty candidates without writing', async () => {
    const run = draftRun({
      paper_analysis: {
        ...draftRun().paper_analysis!,
        metadata_candidate: { title: null, authors: ['New Author'], year: null, journal: null, doi: null },
      },
    });
    await persistDraft(run);
    const service = new PaperLibraryService();

    await expect(service.acceptMetadataCandidate(context, run.analysis_run_id, {
      expected_draft_revision: 2,
      expected_paper_record_revision: 1,
    })).rejects.toMatchObject({ code: 'DRAFT_REVISION_CONFLICT' });
    await expect(service.acceptMetadataCandidate(context, run.analysis_run_id, {
      expected_draft_revision: 1,
      expected_paper_record_revision: 2,
    })).rejects.toMatchObject({ code: 'PAPER_RECORD_REVISION_CONFLICT' });

    const accepted = await service.acceptMetadataCandidate(context, run.analysis_run_id, {
      expected_draft_revision: 1,
      expected_paper_record_revision: 1,
    });
    expect(accepted).toMatchObject({ title: 'Imported filename title', authors: ['New Author'], record_revision: 2 });

    const emptyRun = draftRun({
      analysis_run_id: '323e4567-e89b-42d3-a456-426614174000',
      paper_analysis: {
        ...draftRun().paper_analysis!,
        metadata_candidate: { title: '  ', authors: [' '], year: null, journal: null, doi: null },
      },
    });
    await persistDraft(emptyRun);
    await expect(service.acceptMetadataCandidate(context, emptyRun.analysis_run_id, {
      expected_draft_revision: 1,
      expected_paper_record_revision: 2,
    })).rejects.toMatchObject({ code: 'METADATA_CANDIDATE_EMPTY' });
    await expect(new PaperRepository(context).read(PAPER_ID)).resolves.toMatchObject({ authors: ['New Author'], record_revision: 2 });
  });
});
