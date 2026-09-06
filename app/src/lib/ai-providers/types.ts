import type { AIProvider } from '@/types';

export type ProviderFailureCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_NOT_INSTALLED'
  | 'PROVIDER_NOT_AUTHENTICATED'
  | 'PROVIDER_UNAVAILABLE';

export interface ProviderModel {
  id: string;
  owned_by: string;
  created: number;
  display_name?: string;
}

export interface ProviderStatus {
  provider: AIProvider;
  transport: 'cli' | 'http';
  configured: boolean;
  installed: boolean | null;
  authenticated: boolean | null;
  available: boolean;
  detected_model: string | null;
  failure_code: ProviderFailureCode | null;
}

export interface ProviderValidationResult {
  provider: AIProvider;
  ok: boolean;
  model?: string;
  response?: string;
  message: string;
}

export interface ProviderRuntime {
  id: AIProvider;
  listModels: () => Promise<ProviderModel[]>;
  getStatus: () => Promise<ProviderStatus>;
  validateConnection: () => Promise<ProviderValidationResult>;
}
