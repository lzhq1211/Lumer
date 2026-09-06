import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST } from '@/app/api/papers/import/route';
import { releaseVaultOperationCoordinator } from '@/application/vault-operation-coordinator';
import { LUMER_CONFIG_SCHEMA_VERSION } from '@/lib/config/lumer-config';
import { LumerConfigRepository } from '@/lib/config/lumer-config-repository';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

const originalConfigDirectory = process.env.LUMER_CONFIG_DIR;
let testRoot = '';
let configDirectory = '';
let vaultPath = '';
let pdfBytes: Buffer;

function importRequest(fileName = 'paper.pdf', origin = 'http://localhost'): NextRequest {
  const formData = new FormData();
  formData.set('file', new File([Uint8Array.from(pdfBytes)], fileName, { type: 'application/pdf' }));
  return new NextRequest('http://localhost/api/papers/import', {
    method: 'POST',
    headers: { Origin: origin },
    body: formData,
  });
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-import-api-'));
  await generatePdfFixtures(testRoot);
  pdfBytes = await fs.readFile(path.join(testRoot, 'single-column.pdf'));
  configDirectory = path.join(testRoot, 'config');
  process.env.LUMER_CONFIG_DIR = configDirectory;
  vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
});

afterEach(async () => {
  await releaseVaultOperationCoordinator(configDirectory);
  if (originalConfigDirectory === undefined) delete process.env.LUMER_CONFIG_DIR;
  else process.env.LUMER_CONFIG_DIR = originalConfigDirectory;
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('Import API contract', () => {
  it('rejects cross-origin and malformed requests with stable envelopes', async () => {
    const forbidden = await POST(importRequest('paper.pdf', 'https://example.invalid'));
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe('ORIGIN_FORBIDDEN');

    const malformed = await POST(new NextRequest('http://localhost/api/papers/import', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: '{}',
    }));
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe('REQUEST_INVALID');
  });

  it('returns VAULT_NOT_CONFIGURED without creating business files', async () => {
    const response = await POST(importRequest());
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('VAULT_NOT_CONFIGURED');
  });

  it('imports once and returns duplicate success without a second record', async () => {
    await new LumerConfigRepository(configDirectory).write({
      schema_version: LUMER_CONFIG_SCHEMA_VERSION,
      vault_path: vaultPath,
      default_chat_provider: null,
      default_analyze_provider: null,
    });

    const first = await POST(importRequest('first.pdf'));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.data).toMatchObject({ duplicate: false, paper: { original_file_name: 'first.pdf' } });

    const duplicate = await POST(importRequest('renamed.pdf'));
    expect(duplicate.status).toBe(200);
    const duplicateBody = await duplicate.json();
    expect(duplicateBody.data).toMatchObject({
      duplicate: true,
      paper: { paper_id: firstBody.data.paper.paper_id, original_file_name: 'first.pdf' },
    });
    expect(await fs.readdir(path.join(vaultPath, '.lumer/papers'))).toHaveLength(1);
  });
});
