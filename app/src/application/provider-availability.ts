import type { SettingsProviderStatus } from '@/application/provider-status-service';
import type { AIProvider } from '@/types';

export class ProviderAvailabilityError extends Error {
  constructor(
    readonly code: 'PROVIDER_NOT_CONFIGURED' | 'PROVIDER_NOT_INSTALLED' | 'PROVIDER_NOT_AUTHENTICATED' | 'PROVIDER_UNAVAILABLE',
    readonly provider: AIProvider,
  ) {
    super(`${provider} Provider 不可用。`);
    this.name = 'ProviderAvailabilityError';
  }
}

export type ProviderAvailabilityStatus = Pick<SettingsProviderStatus, 'provider' | 'installed' | 'authenticated' | 'available'> & {
  configured?: boolean;
  detected_model?: string | null;
};

export function requireAvailableProvider(status: ProviderAvailabilityStatus, provider: AIProvider): void {
  if (status.provider !== provider) {
    throw new ProviderAvailabilityError('PROVIDER_UNAVAILABLE', provider);
  }
  if (status.configured === false) throw new ProviderAvailabilityError('PROVIDER_NOT_CONFIGURED', provider);
  if (status.installed === false) throw new ProviderAvailabilityError('PROVIDER_NOT_INSTALLED', provider);
  if (status.authenticated === false) throw new ProviderAvailabilityError('PROVIDER_NOT_AUTHENTICATED', provider);
  if (!status.available) throw new ProviderAvailabilityError('PROVIDER_UNAVAILABLE', provider);
}
