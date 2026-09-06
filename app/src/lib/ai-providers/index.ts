import { getCodexCliAvailability } from '@/lib/ai-providers/codex-analyze-adapter';
import type { AIProvider } from '@/types';

export { getProviderRegistry, ProviderRegistry, ProviderRegistryError } from './provider-registry';
export { OpenAICompatibleAdapter, OpenAICompatibleProviderAdapter } from './openai-compatible-adapter';
export { readOpenAICompatibleConfig } from './openai-compatible-config';

import type { ProviderRuntime } from './types';

const codexRuntime: ProviderRuntime = {
  id: 'codex',
  async listModels() {
    return [];
  },
  async getStatus() {
    const status = await getCodexCliAvailability();
    return {
      provider: 'codex' as const,
      transport: 'cli' as const,
      configured: status.installed,
      installed: status.installed,
      authenticated: status.authenticated,
      available: status.installed && status.authenticated,
      detected_model: null,
      failure_code: !status.installed
        ? 'PROVIDER_NOT_INSTALLED' as const
        : !status.authenticated ? 'PROVIDER_NOT_AUTHENTICATED' as const : null,
    };
  },
  async validateConnection() {
    const status = await getCodexCliAvailability();
    return {
      provider: 'codex',
      ok: status.authenticated,
      message: status.authenticated ? 'Codex CLI 已登录。' : 'Codex CLI 尚未登录。',
    };
  },
};

export function getProviderRuntime(provider: AIProvider = 'codex'): ProviderRuntime {
  if (provider !== 'codex') throw new Error('Unsupported AI provider: codex only.');
  return codexRuntime;
}
