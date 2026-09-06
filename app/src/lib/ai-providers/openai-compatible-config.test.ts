import { describe, expect, it } from 'vitest';

import {
  OPENAI_COMPAT_API_KEY_ENV,
  OPENAI_COMPAT_BASE_URL_ENV,
  OPENAI_COMPAT_MODEL_ENV,
  OpenAICompatibleConfigError,
  readOpenAICompatibleConfig,
} from './openai-compatible-config';

function env(baseUrl?: string, model?: string, apiKey?: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    [OPENAI_COMPAT_BASE_URL_ENV]: baseUrl,
    [OPENAI_COMPAT_MODEL_ENV]: model,
    [OPENAI_COMPAT_API_KEY_ENV]: apiKey,
  };
}

describe('OpenAI-compatible environment configuration', () => {
  it('treats missing and whitespace values as not configured without exposing values', () => {
    expect(() => readOpenAICompatibleConfig(env('  ', '  ', 'unit-test-key'))).toThrow(OpenAICompatibleConfigError);
    try {
      readOpenAICompatibleConfig(env(undefined, undefined, 'unit-test-key'));
    } catch (error) {
      expect(error).toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', reason: 'missing' });
      expect(JSON.stringify(error)).not.toContain('unit-test-key');
    }
  });

  it('accepts HTTPS remote endpoints and loopback HTTP endpoints, normalizing trailing slashes', () => {
    expect(readOpenAICompatibleConfig(env('https://provider.example/v1/', 'configured-model'))).toEqual({
      base_url: 'https://provider.example/v1',
      model: 'configured-model',
      api_key: null,
    });
    expect(readOpenAICompatibleConfig(env('http://localhost:1234/v1', 'local-model', 'unit-test-key'))).toEqual({
      base_url: 'http://localhost:1234/v1',
      model: 'local-model',
      api_key: 'unit-test-key',
    });
    expect(readOpenAICompatibleConfig(env('http://127.0.0.1/v1', 'local-model'))).toMatchObject({ api_key: null });
    expect(readOpenAICompatibleConfig(env('http://[::1]:1234/v1', 'local-model'))).toMatchObject({ api_key: null });
  });

  it('rejects non-loopback HTTP, missing /v1, credentials, query and fragment URLs', () => {
    for (const baseUrl of [
      'http://provider.example/v1',
      'https://provider.example/api',
      'https://user:password@provider.example/v1',
      'https://provider.example/v1?tenant=test',
      'https://provider.example/v1#fragment',
    ]) {
      expect(() => readOpenAICompatibleConfig(env(baseUrl, 'configured-model'))).toThrowError(
        expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED', reason: 'invalid_base_url' }),
      );
    }
  });
});
