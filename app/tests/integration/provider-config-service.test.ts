import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProviderConfigService } from '@/application/provider-config-service';
import { LumerConfigRepository, LumerConfigRepositoryError } from '@/lib/config/lumer-config-repository';

let testRoot = '';
let configDirectory = '';
let vaultPath = '';

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-provider-config-service-'));
  configDirectory = path.join(testRoot, 'config');
  vaultPath = path.join(testRoot, 'Vault');
  await fs.mkdir(vaultPath, { recursive: true });
  await new LumerConfigRepository(configDirectory).write({
    schema_version: 1,
    vault_path: vaultPath,
    default_chat_provider: 'codex',
    default_analyze_provider: null,
  });
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('ProviderConfigService', () => {
  it('keeps the original file when the atomic provider write fails', async () => {
    const repository = new LumerConfigRepository(configDirectory);
    const before = await fs.readFile(repository.configPath, 'utf8');
    const failingRepository = {
      read: () => repository.read(),
      write: async () => {
        throw new LumerConfigRepositoryError('write failed', 'write');
      },
    };

    await expect(new ProviderConfigService(failingRepository).saveConfig({
      app: 'API',
      base_url: 'https://provider.example/v1',
      model: 'model',
      api_key: 'secret',
    })).rejects.toMatchObject({ code: 'CONFIG_WRITE_FAILED', status: 500 });
    expect(await fs.readFile(repository.configPath, 'utf8')).toBe(before);
  });
});
