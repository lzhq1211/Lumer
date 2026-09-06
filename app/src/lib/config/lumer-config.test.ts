import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LumerConfigParseError,
  parseLumerConfig,
  parseLumerConfigInput,
} from '@/lib/config/lumer-config';

const absoluteVaultPath = path.resolve('/tmp/lumer-config-test-vault');

describe('LumerConfig strict parsing', () => {
  it('accepts the frozen schema and nullable provider defaults', () => {
    expect(parseLumerConfig({
      schema_version: 1,
      vault_path: absoluteVaultPath,
      default_chat_provider: 'codex',
      default_analyze_provider: null,
    })).toEqual({
      schema_version: 1,
      vault_path: absoluteVaultPath,
      default_chat_provider: 'codex',
      default_analyze_provider: null,
    });
  });

  it('accepts schema 2 with a validated OpenAI-compatible configuration', () => {
    expect(parseLumerConfig({
      schema_version: 2,
      vault_path: absoluteVaultPath,
      default_chat_provider: 'openai_compatible',
      default_analyze_provider: null,
      openai_compatible: {
        app: 'Local API',
        base_url: 'http://127.0.0.1:8045/v1',
        model: 'fixture-model',
        api_key: 'secret',
      },
    })).toEqual({
      schema_version: 2,
      vault_path: absoluteVaultPath,
      default_chat_provider: 'openai_compatible',
      default_analyze_provider: null,
      openai_compatible: {
        app: 'Local API',
        base_url: 'http://127.0.0.1:8045/v1',
        model: 'fixture-model',
        api_key: 'secret',
      },
    });
  });

  it('allows OpenAI-compatible as either independent provider default', () => {
    expect(parseLumerConfigInput({
      vault_path: absoluteVaultPath,
      default_chat_provider: null,
      default_analyze_provider: 'openai_compatible',
    })).toMatchObject({ default_analyze_provider: 'openai_compatible' });
    expect(parseLumerConfigInput({
      vault_path: absoluteVaultPath,
      default_chat_provider: 'openai_compatible',
      default_analyze_provider: null,
    })).toMatchObject({ default_chat_provider: 'openai_compatible' });
  });

  it('rejects unknown input fields instead of silently dropping them', () => {
    expect(() => parseLumerConfigInput({
      vault_path: absoluteVaultPath,
      default_chat_provider: null,
      default_analyze_provider: null,
      token: 'must-not-be-accepted',
    })).toThrow(LumerConfigParseError);
  });

  it('rejects relative Vault paths', () => {
    expect(() => parseLumerConfigInput({
      vault_path: 'relative/vault',
      default_chat_provider: null,
      default_analyze_provider: null,
    })).toThrow(/absolute path|绝对路径/);
  });

  it('distinguishes unsupported schema versions', () => {
    expect.assertions(2);
    try {
      parseLumerConfig({
        schema_version: 3,
        vault_path: absoluteVaultPath,
        default_chat_provider: null,
        default_analyze_provider: null,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(LumerConfigParseError);
      expect((error as LumerConfigParseError).kind).toBe('unsupported_schema');
    }
  });
});
