import path from 'node:path';

import type { AnalyzeProvider, ChatProvider } from '@/types';

export const LUMER_CONFIG_SCHEMA_VERSION = 2 as const;
export const LEGACY_LUMER_CONFIG_SCHEMA_VERSION = 1 as const;

export interface OpenAICompatibleSettings {
  app: string;
  base_url: string;
  model: string;
  api_key: string | null;
}

export interface LumerConfig {
  schema_version: typeof LEGACY_LUMER_CONFIG_SCHEMA_VERSION | typeof LUMER_CONFIG_SCHEMA_VERSION;
  vault_path: string;
  default_chat_provider: ChatProvider | null;
  default_analyze_provider: AnalyzeProvider | null;
  openai_compatible?: OpenAICompatibleSettings | null;
}

export interface LumerConfigInput {
  vault_path: string;
  default_chat_provider: ChatProvider | null;
  default_analyze_provider: AnalyzeProvider | null;
}

export type VaultStatus = 'unconfigured' | 'valid' | 'unavailable' | 'permission_denied';

export interface SettingsView {
  config: LumerConfig | null;
  vault_status: VaultStatus;
  obsidian_initialized: boolean | null;
}

export class LumerConfigParseError extends Error {
  constructor(
    message: string,
    readonly kind: 'invalid' | 'unsupported_schema',
    readonly schemaVersion: unknown = null,
  ) {
    super(message);
    this.name = 'LumerConfigParseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

export function parseOpenAICompatibleSettings(value: unknown): OpenAICompatibleSettings | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ['api_key', 'app', 'base_url', 'model'])) return undefined;
  if (
    typeof value.app !== 'string'
    || value.app.trim().length === 0
    || value.app.trim().length > 120
    || typeof value.base_url !== 'string'
    || value.base_url.trim().length === 0
    || value.base_url.trim().length > 2048
    || typeof value.model !== 'string'
    || value.model.trim().length === 0
    || value.model.trim().length > 200
    || (value.api_key !== null && typeof value.api_key !== 'string')
  ) return undefined;
  try {
    const url = new URL(value.base_url.trim());
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || !url.pathname.split('/').some((segment) => segment === 'v1')
      || url.username || url.password || url.search || url.hash) return undefined;
  } catch {
    return undefined;
  }
  return {
    app: value.app.trim(),
    base_url: value.base_url.trim().replace(/\/+$/, ''),
    model: value.model.trim(),
    api_key: typeof value.api_key === 'string' && value.api_key.trim().length > 0 ? value.api_key : null,
  };
}

function parseChatProvider(value: unknown): ChatProvider | null | undefined {
  if (value === null || value === 'codex' || value === 'openai_compatible') {
    return value;
  }
  return undefined;
}

function parseAnalyzeProvider(value: unknown): AnalyzeProvider | null | undefined {
  if (value === null || value === 'codex' || value === 'openai_compatible') {
    return value;
  }
  return undefined;
}

export function parseLumerConfigInput(value: unknown): LumerConfigInput {
  if (!isRecord(value) || !hasExactKeys(value, [
    'default_analyze_provider',
    'default_chat_provider',
    'vault_path',
  ])) {
    throw new LumerConfigParseError('设置请求字段不完整或包含未知字段。', 'invalid');
  }

  const chatProvider = parseChatProvider(value.default_chat_provider);
  const analyzeProvider = parseAnalyzeProvider(value.default_analyze_provider);
  if (
    typeof value.vault_path !== 'string'
    || value.vault_path.trim().length === 0
    || chatProvider === undefined
    || analyzeProvider === undefined
  ) {
    throw new LumerConfigParseError('设置请求包含非法字段值。', 'invalid');
  }

  const vaultPath = value.vault_path.trim();
  if (!path.isAbsolute(vaultPath)) {
    throw new LumerConfigParseError('Vault 路径必须是绝对路径。', 'invalid');
  }

  return {
    vault_path: vaultPath,
    default_chat_provider: chatProvider,
    default_analyze_provider: analyzeProvider,
  };
}

export function parseLumerConfig(value: unknown): LumerConfig {
  if (!isRecord(value) || typeof value.schema_version !== 'number') {
    throw new LumerConfigParseError('本地配置文件字段不完整或包含未知字段。', 'invalid');
  }

  if (value.schema_version !== LEGACY_LUMER_CONFIG_SCHEMA_VERSION && value.schema_version !== LUMER_CONFIG_SCHEMA_VERSION) {
    throw new LumerConfigParseError(
      '本地配置文件版本不受支持。',
      'unsupported_schema',
      value.schema_version,
    );
  }

  const expectedKeys = ['default_analyze_provider', 'default_chat_provider', 'schema_version', 'vault_path'];
  if (!hasExactKeys(value, expectedKeys)
    && !(value.schema_version === LUMER_CONFIG_SCHEMA_VERSION && hasExactKeys(value, [...expectedKeys, 'openai_compatible']))) {
    throw new LumerConfigParseError('本地配置文件字段不完整或包含未知字段。', 'invalid');
  }

  const input = parseLumerConfigInput({
    vault_path: value.vault_path,
    default_chat_provider: value.default_chat_provider,
    default_analyze_provider: value.default_analyze_provider,
  });

  const openaiCompatible = value.schema_version === LEGACY_LUMER_CONFIG_SCHEMA_VERSION
    ? undefined
    : parseOpenAICompatibleSettings(value.openai_compatible ?? null);
  if (value.schema_version === LUMER_CONFIG_SCHEMA_VERSION && openaiCompatible === undefined) {
    throw new LumerConfigParseError('本地配置文件包含非法 OpenAI-compatible 配置。', 'invalid');
  }

  return {
    schema_version: value.schema_version as LumerConfig['schema_version'],
    ...input,
    ...(value.schema_version === LUMER_CONFIG_SCHEMA_VERSION ? { openai_compatible: openaiCompatible } : {}),
  };
}
