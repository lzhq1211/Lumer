import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DELETE } from '@/app/api/provider-config/api-key/route';
import { GET, PUT } from '@/app/api/provider-config/route';
import { LumerConfigRepository } from '@/lib/config/lumer-config-repository';
import { readConfiguredOpenAICompatibleConfig } from '@/lib/ai-providers/openai-compatible-config';

const originalConfigDirectory = process.env.LUMER_CONFIG_DIR;
const originalBaseUrl = process.env.LUMER_OPENAI_COMPAT_BASE_URL;
const originalModel = process.env.LUMER_OPENAI_COMPAT_MODEL;
const originalApiKey = process.env.LUMER_OPENAI_COMPAT_API_KEY;
let testRoot = '';
let configDirectory = '';

function sameOriginRequest(url: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers(init.headers);
  headers.set('Origin', 'http://localhost');
  const { signal, ...rest } = init;
  return new NextRequest(url, { ...rest, headers, ...(signal ? { signal } : {}) });
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-provider-config-api-'));
  configDirectory = path.join(testRoot, 'config');
  process.env.LUMER_CONFIG_DIR = configDirectory;
  process.env.LUMER_OPENAI_COMPAT_BASE_URL = 'https://env.example/v1';
  process.env.LUMER_OPENAI_COMPAT_MODEL = 'env-model';
  process.env.LUMER_OPENAI_COMPAT_API_KEY = 'env-secret';
  await new LumerConfigRepository(configDirectory).write({
    schema_version: 1,
    vault_path: path.join(testRoot, 'Vault'),
    default_chat_provider: null,
    default_analyze_provider: null,
  });
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
  if (originalConfigDirectory === undefined) delete process.env.LUMER_CONFIG_DIR;
  else process.env.LUMER_CONFIG_DIR = originalConfigDirectory;
  if (originalBaseUrl === undefined) delete process.env.LUMER_OPENAI_COMPAT_BASE_URL;
  else process.env.LUMER_OPENAI_COMPAT_BASE_URL = originalBaseUrl;
  if (originalModel === undefined) delete process.env.LUMER_OPENAI_COMPAT_MODEL;
  else process.env.LUMER_OPENAI_COMPAT_MODEL = originalModel;
  if (originalApiKey === undefined) delete process.env.LUMER_OPENAI_COMPAT_API_KEY;
  else process.env.LUMER_OPENAI_COMPAT_API_KEY = originalApiKey;
});

describe('Provider config API contract', () => {
  it('returns only a redacted status view', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain('env-secret');
    expect(JSON.parse(body)).toEqual({
      data: {
        app: null,
        model: null,
        base_url_configured: false,
        has_api_key: false,
        config_file_present: true,
      },
    });
  });

  it('saves schema 2, preserves a missing key, and refreshes runtime reads', async () => {
    const response = await PUT(sameOriginRequest('http://localhost/api/provider-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'Local API',
        base_url: 'http://127.0.0.1:8045/v1/',
        model: 'local-model',
        api_key: 'local-secret',
      }),
    }));
    expect(response.status).toBe(200);
    const responseBody = await response.text();
    expect(responseBody).not.toContain('local-secret');
    expect(JSON.parse(responseBody)).toEqual({
      data: {
        app: 'Local API',
        model: 'local-model',
        base_url_configured: true,
        has_api_key: true,
        config_file_present: true,
      },
    });

    const persisted = JSON.parse(await fs.readFile(path.join(configDirectory, 'config.json'), 'utf8')) as Record<string, unknown>;
    expect(persisted.schema_version).toBe(2);
    expect(JSON.stringify(persisted)).toContain('local-secret');
    await expect(readConfiguredOpenAICompatibleConfig()).resolves.toEqual({
      base_url: 'http://127.0.0.1:8045/v1',
      model: 'local-model',
      api_key: 'local-secret',
    });

    const preserveResponse = await PUT(sameOriginRequest('http://localhost/api/provider-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'Local API 2',
        base_url: 'http://127.0.0.1:8045/v1',
        model: 'local-model-2',
      }),
    }));
    expect(preserveResponse.status).toBe(200);
    await expect(readConfiguredOpenAICompatibleConfig()).resolves.toMatchObject({ api_key: 'local-secret' });
  });

  it('clears the key only through the dedicated same-origin DELETE', async () => {
    await PUT(sameOriginRequest('http://localhost/api/provider-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'API', base_url: 'http://127.0.0.1/v1', model: 'm', api_key: 'secret-to-clear' }),
    }));
    const response = await DELETE(sameOriginRequest('http://localhost/api/provider-config/api-key', { method: 'DELETE' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { app: 'API', model: 'm', base_url_configured: true, has_api_key: false, config_file_present: true },
    });
    expect(await fs.readFile(path.join(configDirectory, 'config.json'), 'utf8')).not.toContain('secret-to-clear');
  });

  it('rejects cross-origin mutation and invalid input without changing the file', async () => {
    const before = await fs.readFile(path.join(configDirectory, 'config.json'), 'utf8');
    const forbidden = await PUT(new NextRequest('http://localhost/api/provider-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.invalid' },
      body: JSON.stringify({ app: 'API', base_url: 'https://provider.example/v1', model: 'm', api_key: 'secret' }),
    }));
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error).toMatchObject({ code: 'ORIGIN_FORBIDDEN', details: null });

    const invalid = await PUT(sameOriginRequest('http://localhost/api/provider-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'API', base_url: 'http://provider.example/v1', model: 'm', api_key: 'secret' }),
    }));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe('REQUEST_INVALID');
    expect(await fs.readFile(path.join(configDirectory, 'config.json'), 'utf8')).toBe(before);
  });
});
