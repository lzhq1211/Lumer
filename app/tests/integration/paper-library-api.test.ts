import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as papersRoute from '@/app/api/papers/route';
import { DELETE as deletePaper, GET as getPaper, PATCH as patchPaper } from '@/app/api/papers/[paperId]/route';
import { releaseVaultOperationCoordinator } from '@/application/vault-operation-coordinator';
import { PaperRecord } from '@/domain/paper';
import { LUMER_CONFIG_SCHEMA_VERSION } from '@/lib/config/lumer-config';
import { LumerConfigRepository } from '@/lib/config/lumer-config-repository';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { createVaultContext, initializeVaultLayout } from '@/lib/storage/vault-path';
import { draftRun } from '../helpers/analysis-run-fixture';

const PAPER_ID = '123e4567-e89b-42d3-a456-426614174000';
const SHA = 'a'.repeat(64);
const originalConfigDirectory = process.env.LUMER_CONFIG_DIR;

let testRoot = '';
let configDirectory = '';
let vaultPath = '';

function paperRecord(): PaperRecord {
  return {
    schema_version: 1,
    paper_id: PAPER_ID,
    source_sha256: SHA,
    managed_pdf_sha256: SHA,
    pdf_revision: 1,
    pdf_path: 'Papers/library--123e4567.pdf',
    original_file_name: 'library.pdf',
    title: 'Library paper',
    authors: ['Ada Lovelace'],
    year: 2026,
    journal: null,
    doi: '10.1000/library',
    tags: ['EEG'],
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
  };
}

function routeContext(paperId = PAPER_ID) {
  return { params: Promise.resolve({ paperId }) };
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-paper-api-'));
  configDirectory = path.join(testRoot, 'config');
  process.env.LUMER_CONFIG_DIR = configDirectory;
  vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  await new LumerConfigRepository(configDirectory).write({
    schema_version: LUMER_CONFIG_SCHEMA_VERSION,
    vault_path: vaultPath,
    default_chat_provider: null,
    default_analyze_provider: null,
  });
  const context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
  await new PaperRepository(context).create(paperRecord());
});

afterEach(async () => {
  await releaseVaultOperationCoordinator(configDirectory);
  if (originalConfigDirectory === undefined) delete process.env.LUMER_CONFIG_DIR;
  else process.env.LUMER_CONFIG_DIR = originalConfigDirectory;
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('Paper Library API contract', () => {
  it('lists with frozen envelope and strict filters', async () => {
    expect(papersRoute).not.toHaveProperty('POST');
    expect(papersRoute).not.toHaveProperty('PATCH');
    expect(papersRoute).not.toHaveProperty('DELETE');

    const response = await papersRoute.GET(new NextRequest(
      'http://localhost/api/papers?search=ada&status=inbox&tag=EEG',
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ paper: { paper_id: PAPER_ID }, has_current_final: false }],
    });

    const invalid = await papersRoute.GET(new NextRequest('http://localhost/api/papers?folder=x'));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe('REQUEST_INVALID');
  });

  it('returns only the minimal latest analysis summary for Library rows', async () => {
    const context = await createVaultContext(vaultPath);
    const run = draftRun({
      derived_from_run_id: '223e4567-e89b-42d3-a456-426614174001',
      raw_model_output: '不得从 Library API 泄露的原始模型输出',
      updated_at: '2026-09-01T03:00:00.000Z',
    });
    await new AnalysisRunRepository(context).create(run);

    const response = await papersRoute.GET(new NextRequest('http://localhost/api/papers'));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: Array<Record<string, unknown>> };
    expect(payload.data[0]?.latest_analysis).toEqual({
      analysis_run_id: run.analysis_run_id,
      state: 'draft',
      provider: 'codex',
      model: 'unknown',
      updated_at: run.updated_at,
    });
    expect(payload.data[0]?.latest_analysis).not.toHaveProperty('raw_model_output');
    expect(payload.data[0]?.latest_analysis).not.toHaveProperty('paper_analysis');
    expect(JSON.stringify(payload.data[0])).not.toContain('不得从 Library API 泄露');
  });

  it('fails closed when the PaperRecord directory contains an invalid JSON identity', async () => {
    await fs.writeFile(path.join(vaultPath, '.lumer/papers/not-a-paper-id.json'), '{}');
    const response = await papersRoute.GET(new NextRequest('http://localhost/api/papers'));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'DATA_INTEGRITY_ERROR',
        retryable: false,
        details: { object_kind: 'paper_record' },
      },
    });
  });

  it('returns detail and patches Metadata through the Vault mutation lease', async () => {
    const detail = await getPaper(
      new NextRequest(`http://localhost/api/papers/${PAPER_ID}`),
      routeContext(),
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      data: { paper: { paper_id: PAPER_ID }, extraction_available: false, current_final: null },
    });

    const updated = await patchPaper(new NextRequest(`http://localhost/api/papers/${PAPER_ID}`, {
      method: 'PATCH',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_record_revision: 1, status: 'read', tags: ['Reviewed'] }),
    }), routeContext());
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: { status: 'read', tags: ['Reviewed'], record_revision: 2 },
    });
  });

  it('rejects cross-origin, stale revision and unknown Paper IDs', async () => {
    const forbidden = await patchPaper(new NextRequest(`http://localhost/api/papers/${PAPER_ID}`, {
      method: 'PATCH',
      headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_record_revision: 1, status: 'read' }),
    }), routeContext());
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe('ORIGIN_FORBIDDEN');

    const stale = await patchPaper(new NextRequest(`http://localhost/api/papers/${PAPER_ID}`, {
      method: 'PATCH',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_record_revision: 2, status: 'read' }),
    }), routeContext());
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe('PAPER_RECORD_REVISION_CONFLICT');

    const missingId = '323e4567-e89b-42d3-a456-426614174002';
    const missing = await getPaper(
      new NextRequest(`http://localhost/api/papers/${missingId}`),
      routeContext(missingId),
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('PAPER_NOT_FOUND');
  });

  it('permanently deletes a PaperRecord only after an exact same-origin confirmation', async () => {
    const response = await deletePaper(new NextRequest(`http://localhost/api/papers/${PAPER_ID}`, {
      method: 'DELETE',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_record_revision: 1, confirmed_paper_id: PAPER_ID }),
    }), routeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { paper_id: PAPER_ID, deleted_managed_paths: [`.lumer/papers/${PAPER_ID}.json`] } });
    expect(await new PaperRepository(await createVaultContext(vaultPath)).exists(PAPER_ID)).toBe(false);
  });
});
