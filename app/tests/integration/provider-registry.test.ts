import { describe, expect, it } from 'vitest';

import { ProviderRegistry, ProviderRegistryError } from '@/lib/ai-providers/provider-registry';
import { OpenAICompatibleAdapter } from '@/lib/ai-providers/openai-compatible-adapter';

describe('Provider Registry (5E)', () => {
  it('only resolves the two fixed Provider IDs and keeps HTTP separate from Chat', async () => {
    const httpAdapter = new OpenAICompatibleAdapter({
      readConfig: () => ({ base_url: 'https://provider.example/v1', model: 'configured-model', api_key: null }),
      fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'configured-model' }] }), { status: 200 }),
    });
    const registry = new ProviderRegistry({
      openAICompatibleAdapter: httpAdapter,
      codexAvailability: async () => ({ installed: true, authenticated: true }),
    });

    expect(registry.resolveAnalyzeAdapter('openai_compatible')).toBe(httpAdapter);
    expect(registry.resolveAnalyzeAdapter('codex')).toBeTruthy();
    expect(() => registry.resolveAnalyzeAdapter('client_supplied_module')).toThrow(ProviderRegistryError);
    await expect(registry.getStatus('openai_compatible')).resolves.toMatchObject({
      provider: 'openai_compatible',
      transport: 'http',
      configured: true,
      installed: null,
      authenticated: true,
      available: true,
      detected_model: 'configured-model',
      failure_code: null,
    });
    await expect(registry.getStatuses()).resolves.toHaveLength(2);
  });
});
