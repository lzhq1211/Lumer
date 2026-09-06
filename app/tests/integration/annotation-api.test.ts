import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DELETE, PATCH } from '@/app/api/papers/[paperId]/annotations/[annotationId]/route';
import { GET, POST } from '@/app/api/papers/[paperId]/annotations/route';
import { releaseVaultOperationCoordinator } from '@/application/vault-operation-coordinator';
import { ImportPaperService } from '@/application/import-paper-service';
import { LUMER_CONFIG_SCHEMA_VERSION } from '@/lib/config/lumer-config';
import { LumerConfigRepository } from '@/lib/config/lumer-config-repository';
import { createVaultContext, initializeVaultLayout } from '@/lib/storage/vault-path';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

const originalConfigDirectory = process.env.LUMER_CONFIG_DIR;
let testRoot = '';
let configDirectory = '';
let paperId = '';

function request(url: string, method = 'GET', body?: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: method === 'GET' ? {} : {
      origin: 'http://localhost',
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-annotation-api-'));
  await generatePdfFixtures(testRoot);
  configDirectory = path.join(testRoot, 'config');
  process.env.LUMER_CONFIG_DIR = configDirectory;
  const vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  await new LumerConfigRepository(configDirectory).write({
    schema_version: LUMER_CONFIG_SCHEMA_VERSION,
    vault_path: vaultPath,
    default_chat_provider: null,
    default_analyze_provider: null,
  });
  const context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
  const imported = await new ImportPaperService().import(
    context,
    path.join(testRoot, 'single-column.pdf'),
    'annotation-api.pdf',
  );
  paperId = imported.paper.paper_id;
});

afterEach(async () => {
  await releaseVaultOperationCoordinator(configDirectory);
  if (originalConfigDirectory === undefined) delete process.env.LUMER_CONFIG_DIR;
  else process.env.LUMER_CONFIG_DIR = originalConfigDirectory;
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('Paper Annotation API contract', () => {
  it('uses only paper_id routes for list, create, update and delete', async () => {
    const context = { params: Promise.resolve({ paperId }) };
    const initial = await GET(request(`/api/papers/${paperId}/annotations`), context);
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toMatchObject({ data: [] });

    const created = await POST(request(`/api/papers/${paperId}/annotations`, 'POST', {
      expected_record_revision: 1,
      pdf_page_index: 0,
      type: 'important',
      text: 'Annotation API fixture',
      note: '',
      rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.04 }],
    }), context);
    expect(created.status).toBe(200);
    const createdPayload = await created.json();
    const annotationId = createdPayload.data.annotation.annotation_id as string;
    expect(createdPayload.data.paper.record_revision).toBe(2);

    const itemContext = { params: Promise.resolve({ paperId, annotationId }) };
    const updated = await PATCH(request(`/api/papers/${paperId}/annotations/${annotationId}`, 'PATCH', {
      expected_record_revision: 2,
      note: 'API memo',
      type: 'unknown',
    }), itemContext);
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      data: { annotation: { note: 'API memo', type: 'unknown' }, paper: { record_revision: 3 } },
    });

    const deleted = await DELETE(request(`/api/papers/${paperId}/annotations/${annotationId}`, 'DELETE', {
      expected_record_revision: 3,
    }), itemContext);
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({
      data: { annotation: null, deleted: true, paper: { record_revision: 4 } },
    });
  });

  it('rejects path-style reads and cross-origin Annotation writes', async () => {
    const context = { params: Promise.resolve({ paperId }) };
    const query = await GET(request(`/api/papers/${paperId}/annotations?path=Papers/other.pdf`), context);
    expect(query.status).toBe(400);
    await expect(query.json()).resolves.toMatchObject({ error: { code: 'REQUEST_INVALID' } });

    const crossOrigin = new NextRequest(`http://localhost/api/papers/${paperId}/annotations`, {
      method: 'POST',
      headers: { origin: 'https://example.test', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const rejected = await POST(crossOrigin, context);
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toMatchObject({ error: { code: 'ORIGIN_FORBIDDEN' } });
  });
});
