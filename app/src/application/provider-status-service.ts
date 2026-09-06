import type { AIProvider } from '@/types';

import { getProviderRegistry } from '@/lib/ai-providers/provider-registry';
import type { ProviderStatus } from '@/lib/ai-providers/provider-registry';

export type SettingsProviderStatus = ProviderStatus;
export type { ProviderFailureCode } from '@/lib/ai-providers/provider-registry';

export async function getProviderStatus(provider: AIProvider): Promise<SettingsProviderStatus> {
  return getProviderRegistry().getStatus(provider);
}

export async function getProviderStatuses(): Promise<SettingsProviderStatus[]> {
  return getProviderRegistry().getStatuses();
}
