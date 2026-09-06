import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET } from '@/app/api/papers/[paperId]/pdf/route';
import { releaseVaultOperationCoordinator } from '@/application/vault-operation-coordinator';
import { PaperRecord } from '@/domain/paper';
import { LUMER_CONFIG_SCHEMA_VERSION } from '@/lib/config/lumer-config';
import { LumerConfigRepository } from '@/lib/config/lumer-config-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { createVaultContext, initializeVaultLayout } from '@/lib/storage/vault-path';

const PAPER_ID = '123e4567-e89b-42d3-a456-426614174000';
const MISSING_ID = '223e4567-e89b-42d3-a456-426614174001';
const PDF_PATH = 'Papers/api-reader--123e4567.pdf';
const PDF_BYTES = Buffer.from('%PDF-1.7\napi reader fixture\n%%EOF\n');
const PDF_SHA = createHash('sha256').update(PDF_BYTES).digest('hex');
const originalConfigDirectory = process.env.LUMER_CONFIG_DIR;

let testRoot = '';
let configDirectory = '';
let vaultPath = '';

function paperRecord(): PaperRecord {
  return {
    schema_version: 1,
    paper_id: PAPER_ID,
    source_sha256: PDF_SHA,
    managed_pdf_sha256: PDF_SHA,
    pdf_revision: 1,
    pdf_path: PDF_PATH,
    original_file_name: 'api reader.pdf',
    title: 'API Reader paper',
    authors: [],
    year: null,
    journal: null,
    doi: null,
    tags: [],
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

function request(paperId = PAPER_ID, query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/papers/${paperId}/pdf${query}`);
}

function routeContext(paperId = PAPER_ID) {
  return { params: Promise.resolve({ paperId }) };
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-reader-api-'));
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
  await fs.writeFile(path.join(vaultPath, PDF_PATH), PDF_BYTES);
  await new PaperRepository(context).create(paperRecord());
});

afterEach(async () => {
  await releaseVaultOperationCoordinator(configDirectory);
  if (originalConfigDirectory === undefined) delete process.env.LUMER_CONFIG_DIR;
  else process.env.LUMER_CONFIG_DIR = originalConfigDirectory;
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('Managed PDF API contract', () => {
  it('returns verified PDF bytes with no-store and inline headers', async () => {
    const response = await GET(request(), routeContext());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''api%20reader.pdf");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('rejects path queries, invalid IDs, and unknown PaperRecords', async () => {
    const withPath = await GET(request(PAPER_ID, '?path=Papers/other.pdf'), routeContext());
    expect(withPath.status).toBe(400);
    expect((await withPath.json()).error.code).toBe('REQUEST_INVALID');

    const invalid = await GET(request('not-a-paper-id'), routeContext('not-a-paper-id'));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe('REQUEST_INVALID');

    const missing = await GET(request(MISSING_ID), routeContext(MISSING_ID));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('PAPER_NOT_FOUND');
  });

  it('fails closed for missing, replaced, or schema-invalid managed paths', async () => {
    await fs.rm(path.join(vaultPath, PDF_PATH));
    const missing = await GET(request(), routeContext());
    expect(missing.status).toBe(409);
    expect((await missing.json()).error.code).toBe('PDF_MISSING');

    await fs.writeFile(path.join(vaultPath, PDF_PATH), Buffer.from('%PDF-1.7\nreplaced\n%%EOF\n'));
    const replaced = await GET(request(), routeContext());
    expect(replaced.status).toBe(409);
    expect((await replaced.json()).error.code).toBe('PDF_REPLACED');

    await fs.writeFile(
      path.join(vaultPath, `.lumer/papers/${PAPER_ID}.json`),
      `${JSON.stringify({ ...paperRecord(), pdf_path: '../outside.pdf' }, null, 2)}\n`,
    );
    const invalidPath = await GET(request(), routeContext());
    expect(invalidPath.status).toBe(500);
    await expect(invalidPath.json()).resolves.toMatchObject({
      error: { code: 'DATA_INTEGRITY_ERROR', details: { object_kind: 'paper_record' } },
    });
  });
});
