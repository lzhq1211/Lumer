import { LumerConfigRepository } from '@/lib/config/lumer-config-repository';

const BASE_URL_ENV = 'LUMER_OPENAI_COMPAT_BASE_URL';
const MODEL_ENV = 'LUMER_OPENAI_COMPAT_MODEL';
const API_KEY_ENV = 'LUMER_OPENAI_COMPAT_API_KEY';

export interface OpenAICompatibleConfig {
  readonly base_url: string;
  readonly model: string;
  readonly api_key: string | null;
}

export type OpenAICompatibleConfigReader = () => OpenAICompatibleConfig | Promise<OpenAICompatibleConfig>;

export class OpenAICompatibleConfigError extends Error {
  readonly code = 'PROVIDER_NOT_CONFIGURED' as const;

  constructor(
    readonly reason: 'missing' | 'invalid_base_url' | 'invalid_config',
    readonly details: Record<string, unknown> = {},
  ) {
    super('OpenAI-compatible Provider 配置不可用。');
    this.name = 'OpenAICompatibleConfigError';
  }
}

function nonBlank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function hasV1Path(pathname: string): boolean {
  return pathname.split('/').some((segment) => segment === 'v1');
}

function parseBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OpenAICompatibleConfigError('invalid_base_url', { reason: 'invalid_url' });
  }

  const allowedProtocol = url.protocol === 'https:'
    || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
  if (!allowedProtocol || !hasV1Path(url.pathname) || url.username || url.password || url.search || url.hash) {
    throw new OpenAICompatibleConfigError('invalid_base_url', { reason: 'url_policy' });
  }

  return value.replace(/\/+$/, '');
}

export function readOpenAICompatibleConfig(env: NodeJS.ProcessEnv = process.env): OpenAICompatibleConfig {
  const baseUrl = nonBlank(env[BASE_URL_ENV]);
  const model = nonBlank(env[MODEL_ENV]);
  const apiKey = nonBlank(env[API_KEY_ENV]);

  if (!baseUrl || !model) {
    const missing_fields = [
      !baseUrl ? BASE_URL_ENV : null,
      !model ? MODEL_ENV : null,
    ].filter((field): field is string => field !== null);
    throw new OpenAICompatibleConfigError('missing', { missing_fields });
  }

  return {
    base_url: parseBaseUrl(baseUrl),
    model,
    api_key: apiKey,
  };
}

/**
 * Read the persisted Settings profile first, preserving the legacy environment fallback.
 * The returned shape intentionally excludes the user-facing app label.
 */
export async function readConfiguredOpenAICompatibleConfig(): Promise<OpenAICompatibleConfig> {
  let config;
  try {
    config = await new LumerConfigRepository().read();
  } catch {
    throw new OpenAICompatibleConfigError('invalid_config');
  }

  const profile = config?.schema_version === 2 ? config.openai_compatible : undefined;
  if (profile) {
    return {
      base_url: parseBaseUrl(profile.base_url),
      model: profile.model,
      api_key: profile.api_key,
    };
  }

  return readOpenAICompatibleConfig();
}

export const OPENAI_COMPAT_BASE_URL_ENV = BASE_URL_ENV;
export const OPENAI_COMPAT_MODEL_ENV = MODEL_ENV;
export const OPENAI_COMPAT_API_KEY_ENV = API_KEY_ENV;
