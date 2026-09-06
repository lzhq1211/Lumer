import { CodexAnalyzeAdapter, getCodexCliAvailability } from './codex-analyze-adapter';
import { OpenAICompatibleAdapter } from './openai-compatible-adapter';
import type { ProviderTaskAdapter } from './task-contract';
import type { ProviderStatus } from './types';

export type { ProviderFailureCode, ProviderStatus } from './types';

export class ProviderRegistryError extends Error {
  constructor(readonly provider: unknown) {
    super('请求的 Provider 未被支持。');
    this.name = 'ProviderRegistryError';
  }
}

export interface ProviderRegistryOptions {
  readonly codexAdapter?: ProviderTaskAdapter;
  readonly openAICompatibleAdapter?: OpenAICompatibleAdapter;
  readonly codexAvailability?: typeof getCodexCliAvailability;
}

function codexStatus(availability: { installed: boolean; authenticated: boolean }): ProviderStatus {
  if (!availability.installed) {
    return {
      provider: 'codex',
      transport: 'cli',
      configured: false,
      installed: false,
      authenticated: false,
      available: false,
      detected_model: null,
      failure_code: 'PROVIDER_NOT_INSTALLED',
    };
  }
  if (!availability.authenticated) {
    return {
      provider: 'codex',
      transport: 'cli',
      configured: true,
      installed: true,
      authenticated: false,
      available: false,
      detected_model: null,
      failure_code: 'PROVIDER_NOT_AUTHENTICATED',
    };
  }
  return {
    provider: 'codex',
    transport: 'cli',
    configured: true,
    installed: true,
    authenticated: true,
    available: true,
    detected_model: null,
    failure_code: null,
  };
}

export class ProviderRegistry {
  private readonly codexAdapter: ProviderTaskAdapter;
  private readonly openAICompatibleAdapter: OpenAICompatibleAdapter;
  private readonly codexAvailability: typeof getCodexCliAvailability;

  constructor(options: ProviderRegistryOptions = {}) {
    this.codexAdapter = options.codexAdapter ?? new CodexAnalyzeAdapter();
    this.openAICompatibleAdapter = options.openAICompatibleAdapter ?? new OpenAICompatibleAdapter();
    this.codexAvailability = options.codexAvailability ?? getCodexCliAvailability;
  }

  resolveAnalyzeAdapter(provider: unknown): ProviderTaskAdapter {
    if (provider === 'codex') return this.codexAdapter;
    if (provider === 'openai_compatible') return this.openAICompatibleAdapter;
    throw new ProviderRegistryError(provider);
  }

  async getStatus(provider: unknown): Promise<ProviderStatus> {
    if (provider === 'codex') return codexStatus(await this.codexAvailability());
    if (provider === 'openai_compatible') return this.openAICompatibleAdapter.getStatus();
    throw new ProviderRegistryError(provider);
  }

  async getStatuses(): Promise<ProviderStatus[]> {
    return [await this.getStatus('codex'), await this.getStatus('openai_compatible')];
  }
}

let defaultProviderRegistry: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  defaultProviderRegistry ??= new ProviderRegistry();
  return defaultProviderRegistry;
}
