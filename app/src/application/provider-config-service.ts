import {
  LEGACY_LUMER_CONFIG_SCHEMA_VERSION,
  LUMER_CONFIG_SCHEMA_VERSION,
  LumerConfig,
  LumerConfigParseError,
  OpenAICompatibleSettings,
  parseOpenAICompatibleSettings,
} from '@/lib/config/lumer-config';
import {
  LumerConfigRepository,
  LumerConfigRepositoryError,
} from '@/lib/config/lumer-config-repository';

export interface ProviderConfigView {
  app: string | null;
  model: string | null;
  base_url_configured: boolean;
  has_api_key: boolean;
  config_file_present: boolean;
}

export interface ProviderConfigInput {
  app: string;
  base_url: string;
  model: string;
  api_key?: string | null;
}

export type ProviderConfigErrorCode =
  | 'REQUEST_INVALID'
  | 'ORIGIN_FORBIDDEN'
  | 'CONFIG_NOT_INITIALIZED'
  | 'CONFIG_WRITE_FAILED'
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'DATA_INTEGRITY_ERROR';

export class ProviderConfigServiceError extends Error {
  constructor(
    readonly code: ProviderConfigErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ProviderConfigServiceError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInput(value: unknown): ProviderConfigInput {
  if (!isRecord(value)) {
    throw new ProviderConfigServiceError('REQUEST_INVALID', 'Provider 配置字段不符合合同。', 400, false, {
      fields: ['app', 'base_url', 'model', 'api_key'],
    });
  }
  const keys = Object.keys(value);
  if (!keys.every((key) => ['app', 'base_url', 'model', 'api_key'].includes(key))
    || !['app', 'base_url', 'model'].every((key) => keys.includes(key))) {
    throw new ProviderConfigServiceError('REQUEST_INVALID', 'Provider 配置字段不符合合同。', 400, false, {
      fields: ['app', 'base_url', 'model', 'api_key'],
    });
  }
  if (
    typeof value.app !== 'string'
    || typeof value.base_url !== 'string'
    || typeof value.model !== 'string'
    || (value.api_key !== undefined && value.api_key !== null && typeof value.api_key !== 'string')
  ) {
    throw new ProviderConfigServiceError('REQUEST_INVALID', 'Provider 配置字段类型不符合合同。', 400, false, {
      fields: ['app', 'base_url', 'model', 'api_key'],
    });
  }
  return {
    app: value.app,
    base_url: value.base_url,
    model: value.model,
    api_key: value.api_key,
  };
}

function toView(config: LumerConfig | null): ProviderConfigView {
  const profile = config?.schema_version === LUMER_CONFIG_SCHEMA_VERSION
    ? config.openai_compatible ?? null
    : null;
  return {
    app: profile?.app ?? null,
    model: profile?.model ?? null,
    base_url_configured: profile !== null,
    has_api_key: profile?.api_key !== null && profile?.api_key !== undefined,
    config_file_present: config !== null,
  };
}

function mapRepositoryError(error: unknown): ProviderConfigServiceError {
  if (error instanceof ProviderConfigServiceError) return error;
  if (error instanceof LumerConfigParseError && error.kind === 'unsupported_schema') {
    return new ProviderConfigServiceError(
      'SCHEMA_VERSION_UNSUPPORTED',
      '本地配置文件版本不受支持。',
      409,
      false,
      { schema_version: error.schemaVersion, supported_versions: [LUMER_CONFIG_SCHEMA_VERSION] },
    );
  }
  if (error instanceof LumerConfigRepositoryError) {
    return new ProviderConfigServiceError(
      error.operation === 'write' ? 'CONFIG_WRITE_FAILED' : 'DATA_INTEGRITY_ERROR',
      error.operation === 'write' ? 'Provider 配置未能保存。' : 'Provider 配置无法安全读取。',
      500,
      error.operation === 'write',
      error.operation === 'read' ? { object_kind: 'lumer_config' } : null,
    );
  }
  return new ProviderConfigServiceError('DATA_INTEGRITY_ERROR', 'Provider 配置无法安全读取。', 500, false, { object_kind: 'lumer_config' });
}

export class ProviderConfigService {
  constructor(
    private readonly repository: Pick<LumerConfigRepository, 'read' | 'write'> = new LumerConfigRepository(),
  ) {}

  async getConfig(): Promise<ProviderConfigView> {
    try {
      return toView(await this.repository.read());
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  async saveConfig(value: unknown): Promise<ProviderConfigView> {
    const input = parseInput(value);
    const parsed = parseOpenAICompatibleSettings({
      app: input.app,
      base_url: input.base_url,
      model: input.model,
      api_key: input.api_key ?? null,
    });
    if (!parsed) {
      throw new ProviderConfigServiceError('REQUEST_INVALID', 'Provider 配置字段不符合合同。', 400, false, {
        fields: ['app', 'base_url', 'model', 'api_key'],
      });
    }

    try {
      const current = await this.repository.read();
      if (!current) {
        throw new ProviderConfigServiceError('CONFIG_NOT_INITIALIZED', '请先完成 Vault 设置。', 409, false, null);
      }
      const currentProfile = current.schema_version === LUMER_CONFIG_SCHEMA_VERSION
        ? current.openai_compatible ?? null
        : null;
      const profile: OpenAICompatibleSettings = {
        ...parsed,
        // Empty input is deliberately a preserve operation; DELETE is the clear operation.
        api_key: input.api_key === undefined || input.api_key === null || input.api_key.trim() === ''
          ? currentProfile?.api_key ?? null
          : parsed.api_key,
      };
      const next: LumerConfig = {
        schema_version: LUMER_CONFIG_SCHEMA_VERSION,
        vault_path: current.vault_path,
        default_chat_provider: current.default_chat_provider,
        default_analyze_provider: current.default_analyze_provider,
        openai_compatible: profile,
      };
      await this.repository.write(next);
      return toView(next);
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  async clearApiKey(): Promise<ProviderConfigView> {
    try {
      const current = await this.repository.read();
      if (!current || current.schema_version === LEGACY_LUMER_CONFIG_SCHEMA_VERSION || !current.openai_compatible) {
        return toView(current);
      }
      if (current.openai_compatible.api_key === null) return toView(current);
      const next: LumerConfig = {
        ...current,
        openai_compatible: { ...current.openai_compatible, api_key: null },
      };
      await this.repository.write(next);
      return toView(next);
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }
}
