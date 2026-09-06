import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AtomicWriteError, atomicWriteFile } from '@/lib/storage/atomic-file';
import { StorageSchemaError } from '@/lib/storage/schema-registry';
import { VersionedJsonRepository } from '@/lib/storage/versioned-json-repository';
import {
  createVaultContext,
  initializeVaultLayout,
  resolveVaultPathForWrite,
  VaultContext,
  VaultPathError,
} from '@/lib/storage/vault-path';

const PAPER_ID = '123e4567-e89b-42d3-a456-426614174000';
const SHA_256 = 'a'.repeat(64);

let testRoot = '';
let vaultPath = '';
let context: VaultContext;

function paperRecord() {
  return {
    schema_version: 1,
    paper_id: PAPER_ID,
    source_sha256: SHA_256,
    managed_pdf_sha256: SHA_256,
    pdf_revision: 1,
    pdf_path: 'Papers/source--123e4567.pdf',
    original_file_name: 'source.pdf',
    title: 'Source title',
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
    created_at: '2026-09-01T02:00:00.000Z',
    updated_at: '2026-09-01T02:01:00.000Z',
  };
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-storage-'));
  vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath);
  context = await createVaultContext(vaultPath);
  await initializeVaultLayout(context);
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('trusted Vault paths', () => {
  it('creates only the frozen Vault layout', async () => {
    await expect(fs.stat(path.join(vaultPath, '.lumer/papers'))).resolves.toMatchObject({});
    await expect(fs.stat(path.join(vaultPath, 'Papers'))).resolves.toMatchObject({});
    await expect(fs.stat(path.join(vaultPath, 'Paper Cards'))).resolves.toMatchObject({});
  });

  it('rejects lexical traversal and symlink parents', async () => {
    await expect(resolveVaultPathForWrite(context, '../escape.json')).rejects.toMatchObject({
      code: 'VAULT_PATH_INVALID',
    } satisfies Partial<VaultPathError>);

    const outside = path.join(testRoot, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(vaultPath, '.lumer/escape'));
    await expect(resolveVaultPathForWrite(context, '.lumer/escape/file.json')).rejects.toMatchObject({
      code: 'VAULT_SYMLINK_ESCAPE',
    } satisfies Partial<VaultPathError>);
  });

  it('rejects a symlink injected into a frozen layout directory', async () => {
    await fs.rm(path.join(vaultPath, '.lumer/papers'), { recursive: true });
    await fs.symlink(path.join(testRoot, 'outside'), path.join(vaultPath, '.lumer/papers'));

    await expect(initializeVaultLayout(context)).rejects.toMatchObject({
      code: 'VAULT_SYMLINK_ESCAPE',
    } satisfies Partial<VaultPathError>);
  });
});

describe('atomic file and versioned JSON repository', () => {
  it('keeps the old bytes and removes temp files when failure happens before rename', async () => {
    const relativePath = '.lumer/papers/atomic.json';
    const target = await resolveVaultPathForWrite(context, relativePath);
    await fs.writeFile(target.absolutePath, 'old');

    await expect(atomicWriteFile(target, 'new', {
      injectFault(point) {
        if (point === 'before_rename') throw new Error('injected');
      },
    })).rejects.toMatchObject({ committed: false } satisfies Partial<AtomicWriteError>);

    expect(await fs.readFile(target.absolutePath, 'utf8')).toBe('old');
    expect((await fs.readdir(path.dirname(target.absolutePath))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('reports a committed write when failure happens after rename', async () => {
    const target = await resolveVaultPathForWrite(context, '.lumer/papers/committed.json');
    await fs.writeFile(target.absolutePath, 'old');

    await expect(atomicWriteFile(target, 'new', {
      injectFault(point) {
        if (point === 'after_rename') throw new Error('injected');
      },
    })).rejects.toMatchObject({ committed: true } satisfies Partial<AtomicWriteError>);

    expect(await fs.readFile(target.absolutePath, 'utf8')).toBe('new');
  });

  it('validates before write and again on read', async () => {
    const relativePath = `.lumer/papers/${PAPER_ID}.json`;
    const repository = new VersionedJsonRepository(context, 'paper_record');
    await expect(repository.write(relativePath, paperRecord())).resolves.toEqual(paperRecord());
    await expect(repository.read(relativePath)).resolves.toEqual(paperRecord());

    const target = await resolveVaultPathForWrite(context, relativePath);
    await fs.writeFile(target.absolutePath, JSON.stringify({ ...paperRecord(), schema_version: 2 }));
    await expect(repository.read(relativePath)).rejects.toMatchObject({
      code: 'SCHEMA_VERSION_UNSUPPORTED',
    } satisfies Partial<StorageSchemaError>);
  });
});
