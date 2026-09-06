import { randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

import {
  LUMER_CONFIG_SCHEMA_VERSION,
  LEGACY_LUMER_CONFIG_SCHEMA_VERSION,
  LumerConfig,
  LumerConfigInput,
  LumerConfigParseError,
  parseLumerConfigInput,
  SettingsView,
  VaultStatus,
} from '@/lib/config/lumer-config';
import {
  LumerConfigRepository,
  LumerConfigRepositoryError,
} from '@/lib/config/lumer-config-repository';
import {
  getVaultOperationCoordinator,
  VaultOperationCoordinator,
  VaultOperationCoordinatorError,
} from '@/application/vault-operation-coordinator';

export type SettingsErrorCode =
  | 'REQUEST_INVALID'
  | 'ORIGIN_FORBIDDEN'
  | 'VAULT_PATH_INVALID'
  | 'VAULT_UNAVAILABLE'
  | 'VAULT_PERMISSION_DENIED'
  | 'VAULT_BUSY'
  | 'VAULT_ALREADY_OPEN'
  | 'CONFIG_WRITE_FAILED'
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'DATA_INTEGRITY_ERROR';

export class SettingsServiceError extends Error {
  constructor(
    readonly code: SettingsErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'SettingsServiceError';
  }
}

interface VaultInspection {
  canonicalPath: string;
  vaultStatus: Exclude<VaultStatus, 'unconfigured'>;
  obsidianInitialized: boolean;
  invalidReason: 'not_found' | 'not_directory' | null;
}

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
}

async function isDirectory(candidatePath: string): Promise<boolean> {
  try {
    return (await fs.stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

async function inspectVault(vaultPath: string, verifyWrite: boolean): Promise<VaultInspection> {
  let stats;
  try {
    stats = await fs.stat(vaultPath);
  } catch (error) {
    if (isPermissionError(error)) {
      return {
        canonicalPath: vaultPath,
        vaultStatus: 'permission_denied',
        obsidianInitialized: false,
        invalidReason: null,
      };
    }
    return {
      canonicalPath: vaultPath,
      vaultStatus: 'unavailable',
      obsidianInitialized: false,
      invalidReason: 'not_found',
    };
  }

  if (!stats.isDirectory()) {
    return {
      canonicalPath: vaultPath,
      vaultStatus: 'unavailable',
      obsidianInitialized: false,
      invalidReason: 'not_directory',
    };
  }

  let canonicalPath = vaultPath;
  try {
    canonicalPath = await fs.realpath(vaultPath);
    await fs.access(canonicalPath, fsConstants.R_OK | fsConstants.W_OK);

    if (verifyWrite) {
      const probePath = path.join(canonicalPath, `.lumer-write-probe-${process.pid}-${randomUUID()}`);
      const handle = await fs.open(probePath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      try {
        await handle.writeFile('');
        await handle.sync();
      } finally {
        await handle.close();
        await fs.rm(probePath, { force: true });
      }
    }
  } catch (error) {
    return {
      canonicalPath,
      vaultStatus: isPermissionError(error) ? 'permission_denied' : 'unavailable',
      obsidianInitialized: false,
      invalidReason: null,
    };
  }

  return {
    canonicalPath,
    vaultStatus: 'valid',
    obsidianInitialized: await isDirectory(path.join(canonicalPath, '.obsidian')),
    invalidReason: null,
  };
}

function mapConfigError(error: unknown): SettingsServiceError {
  if (error instanceof SettingsServiceError) {
    return error;
  }
  if (error instanceof LumerConfigParseError) {
    if (error.kind === 'unsupported_schema') {
      return new SettingsServiceError(
        'SCHEMA_VERSION_UNSUPPORTED',
        error.message,
        409,
        false,
        {
          schema_version: error.schemaVersion,
          supported_versions: [LUMER_CONFIG_SCHEMA_VERSION],
        },
      );
    }
    return new SettingsServiceError(
      'DATA_INTEGRITY_ERROR',
      '本地配置文件无法安全读取。',
      500,
      false,
      { object_kind: 'lumer_config' },
    );
  }
  if (error instanceof LumerConfigRepositoryError) {
    return new SettingsServiceError(
      error.operation === 'write' ? 'CONFIG_WRITE_FAILED' : 'DATA_INTEGRITY_ERROR',
      error.message,
      500,
      error.operation === 'write',
      error.operation === 'read' ? { object_kind: 'lumer_config' } : null,
    );
  }
  if (error instanceof VaultOperationCoordinatorError) {
    if (error.code === 'VAULT_BUSY') {
      return new SettingsServiceError(
        'VAULT_BUSY',
        error.message,
        409,
        true,
        { active_operation_kinds: error.activeOperationKinds },
      );
    }
    if (error.code === 'VAULT_ALREADY_OPEN') {
      return new SettingsServiceError('VAULT_ALREADY_OPEN', error.message, 409, true);
    }
    return new SettingsServiceError('VAULT_UNAVAILABLE', error.message, 503, true);
  }
  return new SettingsServiceError('DATA_INTEGRITY_ERROR', '本地配置状态无法确认。', 500, false);
}

export class SettingsService {
  private readonly coordinator: VaultOperationCoordinator;

  constructor(
    private readonly repository = new LumerConfigRepository(),
    coordinator?: VaultOperationCoordinator,
  ) {
    this.coordinator = coordinator ?? getVaultOperationCoordinator(repository);
  }

  async getSettings(): Promise<SettingsView> {
    try {
      const config = await this.repository.read();
      if (!config) {
        return {
          config: null,
          vault_status: 'unconfigured',
          obsidian_initialized: null,
        };
      }

      const inspection = await inspectVault(config.vault_path, false);
      if (inspection.vaultStatus === 'valid') {
        await this.coordinator.bootstrap(inspection.canonicalPath);
      }
      return {
        config,
        vault_status: inspection.vaultStatus,
        obsidian_initialized: inspection.vaultStatus === 'valid'
          ? inspection.obsidianInitialized
          : null,
      };
    } catch (error) {
      throw mapConfigError(error);
    }
  }

  async saveSettings(value: unknown): Promise<SettingsView> {
    let input: LumerConfigInput;
    try {
      input = parseLumerConfigInput(value);
    } catch (error) {
      if (error instanceof LumerConfigParseError) {
        const reason = error.message.includes('绝对路径') ? 'not_absolute' : null;
        throw new SettingsServiceError(
          reason ? 'VAULT_PATH_INVALID' : 'REQUEST_INVALID',
          error.message,
          reason ? 422 : 400,
          false,
          reason ? { reason } : { fields: ['vault_path', 'default_chat_provider', 'default_analyze_provider'] },
        );
      }
      throw error;
    }

    const inspection = await inspectVault(input.vault_path, true);
    if (inspection.invalidReason) {
      throw new SettingsServiceError(
        'VAULT_PATH_INVALID',
        inspection.invalidReason === 'not_found'
          ? 'Vault 路径不存在。'
          : 'Vault 路径不是目录。',
        422,
        false,
        { reason: inspection.invalidReason },
      );
    }
    if (inspection.vaultStatus === 'permission_denied') {
      throw new SettingsServiceError(
        'VAULT_PERMISSION_DENIED',
        'Vault 目录不可读写。',
        403,
        false,
      );
    }
    if (inspection.vaultStatus !== 'valid') {
      throw new SettingsServiceError(
        'VAULT_UNAVAILABLE',
        'Vault 目录当前不可用。',
        503,
        true,
      );
    }

    let currentConfig: LumerConfig | null = null;
    let config: LumerConfig;
    try {
      try {
        currentConfig = await this.repository.read();
      } catch {
        // Settings 保存是损坏/不支持配置的修复入口；无法安全读取旧配置时不发布旧 VaultContext。
      }
      if (currentConfig) {
        const currentInspection = await inspectVault(currentConfig.vault_path, false);
        if (currentInspection.vaultStatus === 'valid') {
          await this.coordinator.bootstrap(currentInspection.canonicalPath);
        }
      }
      config = {
        schema_version: currentConfig?.schema_version ?? LEGACY_LUMER_CONFIG_SCHEMA_VERSION,
        vault_path: inspection.canonicalPath,
        default_chat_provider: input.default_chat_provider,
        default_analyze_provider: input.default_analyze_provider,
        ...(currentConfig?.schema_version === LUMER_CONFIG_SCHEMA_VERSION
          ? { openai_compatible: currentConfig.openai_compatible ?? null }
          : {}),
      };
      await this.coordinator.switchVault(
        inspection.canonicalPath,
        () => this.repository.write(config),
      );
    } catch (error) {
      throw mapConfigError(error);
    }

    return {
      config,
      vault_status: 'valid',
      obsidian_initialized: inspection.obsidianInitialized,
    };
  }
}
