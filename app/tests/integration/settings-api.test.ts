import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET, PUT } from '@/app/api/settings/route';
import { releaseVaultOperationCoordinator } from '@/application/vault-operation-coordinator';

const originalConfigDirectory = process.env.LUMER_CONFIG_DIR;
let testRoot = '';
let vaultPath = '';

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-settings-api-'));
  process.env.LUMER_CONFIG_DIR = path.join(testRoot, 'config');
  vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath, { recursive: true });
});

afterEach(async () => {
  await releaseVaultOperationCoordinator(path.join(testRoot, 'config'));
  if (originalConfigDirectory === undefined) {
    delete process.env.LUMER_CONFIG_DIR;
  } else {
    process.env.LUMER_CONFIG_DIR = originalConfigDirectory;
  }
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('Settings API contract', () => {
  it('returns the frozen success envelope for unconfigured settings', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        config: null,
        vault_status: 'unconfigured',
        obsidian_initialized: null,
      },
    });
  });

  it('saves a strict request and returns the persisted SettingsView', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
      },
      body: JSON.stringify({
        vault_path: vaultPath,
        default_chat_provider: 'codex',
        default_analyze_provider: null,
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        config: {
          schema_version: 1,
          vault_path: await fs.realpath(vaultPath),
          default_chat_provider: 'codex',
          default_analyze_provider: null,
        },
        vault_status: 'valid',
      },
    });
  });

  it('rejects cross-origin mutation with a stable error envelope', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://example.invalid',
      },
      body: JSON.stringify({
        vault_path: vaultPath,
        default_chat_provider: null,
        default_analyze_provider: null,
      }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'ORIGIN_FORBIDDEN',
        message: '该设置请求不是来自当前 Lumer 页面。',
        retryable: false,
        stage: null,
        details: null,
      },
    });
  });

  it('rejects mutation when the Origin header is absent', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vault_path: vaultPath,
        default_chat_provider: null,
        default_analyze_provider: null,
      }),
    }));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('ORIGIN_FORBIDDEN');
  });
});
