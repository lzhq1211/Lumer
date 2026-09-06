import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsService, SettingsServiceError } from '@/application/settings-service';
import { releaseVaultOperationCoordinator } from '@/application/vault-operation-coordinator';
import { LumerConfigRepository } from '@/lib/config/lumer-config-repository';
import { LUMER_CONFIG_SCHEMA_VERSION } from '@/lib/config/lumer-config';

let testRoot = '';
let configDirectory = '';
let vaultPath = '';

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-settings-'));
  configDirectory = path.join(testRoot, 'config');
  vaultPath = path.join(testRoot, 'Research Vault');
  await fs.mkdir(path.join(vaultPath, '.obsidian'), { recursive: true });
});

afterEach(async () => {
  await releaseVaultOperationCoordinator(configDirectory);
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('SettingsService', () => {
  it('returns an explicit unconfigured state before first save', async () => {
    const service = new SettingsService(new LumerConfigRepository(configDirectory));

    await expect(service.getSettings()).resolves.toEqual({
      config: null,
      vault_status: 'unconfigured',
      obsidian_initialized: null,
    });
  });

  it('atomically saves canonical config and a new service instance reads it', async () => {
    const repository = new LumerConfigRepository(configDirectory);
    const service = new SettingsService(repository);

    const saved = await service.saveSettings({
      vault_path: vaultPath,
      default_chat_provider: 'codex',
      default_analyze_provider: 'codex',
    });

    expect(saved).toEqual({
      config: {
        schema_version: 1,
        vault_path: await fs.realpath(vaultPath),
        default_chat_provider: 'codex',
        default_analyze_provider: 'codex',
      },
      vault_status: 'valid',
      obsidian_initialized: true,
    });

    const restartedService = new SettingsService(new LumerConfigRepository(configDirectory));
    await expect(restartedService.getSettings()).resolves.toEqual(saved);

    const configStats = await fs.stat(repository.configPath);
    expect(configStats.mode & 0o777).toBe(0o600);
    expect((await fs.readdir(configDirectory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects a missing Vault without replacing the saved config', async () => {
    const repository = new LumerConfigRepository(configDirectory);
    const service = new SettingsService(repository);
    await service.saveSettings({
      vault_path: vaultPath,
      default_chat_provider: null,
      default_analyze_provider: null,
    });
    const before = await fs.readFile(repository.configPath, 'utf8');

    await expect(service.saveSettings({
      vault_path: path.join(testRoot, 'missing'),
      default_chat_provider: 'codex',
      default_analyze_provider: null,
    })).rejects.toMatchObject({
      code: 'VAULT_PATH_INVALID',
      status: 422,
      details: { reason: 'not_found' },
    } satisfies Partial<SettingsServiceError>);

    expect(await fs.readFile(repository.configPath, 'utf8')).toBe(before);
  });

  it('allows replacing a saved Vault that no longer exists', async () => {
    const repository = new LumerConfigRepository(configDirectory);
    await repository.write({
      schema_version: 1,
      vault_path: path.join(testRoot, 'deleted-vault'),
      default_chat_provider: null,
      default_analyze_provider: null,
    });
    const saved = await new SettingsService(repository).saveSettings({
      vault_path: vaultPath,
      default_chat_provider: null,
      default_analyze_provider: 'codex',
    });
    expect(saved.config?.vault_path).toBe(await fs.realpath(vaultPath));
  });

  it('cleans the temp file when the atomic rename cannot commit', async () => {
    const repository = new LumerConfigRepository(configDirectory);
    await fs.mkdir(repository.configPath, { recursive: true });
    const service = new SettingsService(repository);

    await expect(service.saveSettings({
      vault_path: vaultPath,
      default_chat_provider: null,
      default_analyze_provider: null,
    })).rejects.toMatchObject({
      code: 'CONFIG_WRITE_FAILED',
      status: 500,
      retryable: true,
    } satisfies Partial<SettingsServiceError>);

    expect((await fs.readdir(configDirectory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect((await fs.stat(repository.configPath)).isDirectory()).toBe(true);
  });

  it('atomically persists and reloads the schema 2 Provider object without exposing a second file', async () => {
    const repository = new LumerConfigRepository(configDirectory);
    await repository.write({
      schema_version: LUMER_CONFIG_SCHEMA_VERSION,
      vault_path: vaultPath,
      default_chat_provider: 'openai_compatible',
      default_analyze_provider: 'openai_compatible',
      openai_compatible: {
        app: 'Fixture API',
        base_url: 'http://127.0.0.1:8045/v1',
        model: 'fixture-model',
        api_key: 'local-secret',
      },
    });

    await expect(repository.read()).resolves.toMatchObject({
      schema_version: 2,
      openai_compatible: { app: 'Fixture API', model: 'fixture-model', api_key: 'local-secret' },
    });
    expect((await fs.stat(repository.configPath)).mode & 0o777).toBe(0o600);
    expect((await fs.readdir(configDirectory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
