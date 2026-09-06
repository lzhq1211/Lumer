import { AIProvider } from '@/types';

export const DEFAULT_AI_PROVIDER: AIProvider = 'codex';

export function parseAIProvider(value: string | null | undefined): AIProvider | undefined {
  if (value === 'codex' || value === 'openai_compatible') {
    return value;
  }

  return undefined;
}
