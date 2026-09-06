import { randomUUID } from 'node:crypto';

import {
  OpenAICompatibleConfig,
  OpenAICompatibleConfigError,
  OpenAICompatibleConfigReader,
  readConfiguredOpenAICompatibleConfig,
} from './openai-compatible-config';
import {
  ProviderStreamEvent,
  ProviderTaskAdapter,
  ProviderTaskContractError,
  ProviderTaskRequest,
  ProviderTaskRequestSchema,
} from './task-contract';

export const OPENAI_COMPAT_STATUS_TIMEOUT_MS = 10_000;
export const OPENAI_COMPAT_OVERVIEW_TIMEOUT_MS = 5 * 60 * 1000;
export const OPENAI_COMPAT_CHAT_TIMEOUT_MS = 5 * 60 * 1000;

export interface OpenAICompatibleProviderStatus {
  readonly provider: 'openai_compatible';
  readonly transport: 'http';
  readonly configured: boolean;
  readonly installed: null;
  readonly authenticated: boolean | null;
  readonly available: boolean;
  readonly detected_model: string | null;
  readonly failure_code: 'PROVIDER_NOT_CONFIGURED' | 'PROVIDER_NOT_AUTHENTICATED' | 'PROVIDER_UNAVAILABLE' | null;
}

export interface OpenAICompatibleAdapterOptions {
  readonly readConfig?: OpenAICompatibleConfigReader;
  readonly fetchImpl?: typeof fetch;
  readonly statusTimeoutMs?: number;
  readonly overviewTimeoutMs?: number;
  readonly chatTimeoutMs?: number;
  readonly idGenerator?: () => string;
}

interface TimedSignal {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
}

class OpenAICompatibleResponseError extends Error {
  constructor(readonly code: 'invalid_response' | 'empty_content') {
    super('OpenAI-compatible Provider 返回不符合最小响应合同。');
    this.name = 'OpenAICompatibleResponseError';
  }
}

function createTimedSignal(signal: AbortSignal | undefined, timeoutMs: number): TimedSignal {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function authorizationHeaders(config: OpenAICompatibleConfig): Record<string, string> {
  return config.api_key === null
    ? { 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json', Authorization: `Bearer ${config.api_key}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseModelIds(value: unknown): string[] | null {
  if (!isRecord(value) || !Array.isArray(value.data)) return null;
  const ids: string[] = [];
  for (const item of value.data) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.trim().length === 0) return null;
    ids.push(item.id.trim());
  }
  return ids;
}

function parseCompletion(value: unknown, config: OpenAICompatibleConfig, idGenerator: () => string) {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new OpenAICompatibleResponseError('invalid_response');
  }
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== 'string') {
    throw new OpenAICompatibleResponseError('invalid_response');
  }
  if (choice.message.content.trim().length === 0) {
    throw new OpenAICompatibleResponseError('empty_content');
  }

  const providerTaskId = typeof value.id === 'string' && value.id.trim().length > 0
    ? value.id.trim()
    : idGenerator();
  const responseModel = typeof value.model === 'string' && value.model.trim().length > 0
    ? value.model.trim()
    : config.model;

  return {
    provider_session_id: providerTaskId,
    model: responseModel,
    final_text: choice.message.content,
  };
}

function statusForUnavailable(): OpenAICompatibleProviderStatus {
  return {
    provider: 'openai_compatible',
    transport: 'http',
    configured: true,
    installed: null,
    authenticated: null,
    available: false,
    detected_model: null,
    failure_code: 'PROVIDER_UNAVAILABLE',
  };
}

function statusForConfigurationError(): OpenAICompatibleProviderStatus {
  return {
    provider: 'openai_compatible',
    transport: 'http',
    configured: false,
    installed: null,
    authenticated: null,
    available: false,
    detected_model: null,
    failure_code: 'PROVIDER_NOT_CONFIGURED',
  };
}

function failedEvent(errorCode: string): ProviderStreamEvent {
  return {
    type: 'failed',
    provider: 'openai_compatible',
    provider_session_id: null,
    model: null,
    text: null,
    error_code: errorCode,
  };
}

function failureCodeForFetch(error: unknown, timedSignal: TimedSignal, callerSignal: AbortSignal | undefined): string {
  if (timedSignal.timedOut()) return 'http_timeout';
  if (callerSignal?.aborted) return 'http_aborted';
  return error instanceof OpenAICompatibleResponseError ? error.code : 'network_error';
}

function failureCodeForResponse(error: unknown, timedSignal: TimedSignal, callerSignal: AbortSignal | undefined): string {
  if (timedSignal.timedOut()) return 'http_timeout';
  if (callerSignal?.aborted) return 'http_aborted';
  return error instanceof OpenAICompatibleResponseError ? error.code : 'invalid_response';
}

export class OpenAICompatibleAdapter implements ProviderTaskAdapter {
  private readonly readConfig: OpenAICompatibleConfigReader;
  private readonly fetchImpl: typeof fetch;
  private readonly statusTimeoutMs: number;
  private readonly overviewTimeoutMs: number;
  private readonly chatTimeoutMs: number;
  private readonly idGenerator: () => string;

  constructor(options: OpenAICompatibleAdapterOptions = {}) {
    this.readConfig = options.readConfig ?? (() => readConfiguredOpenAICompatibleConfig());
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.statusTimeoutMs = options.statusTimeoutMs ?? OPENAI_COMPAT_STATUS_TIMEOUT_MS;
    this.overviewTimeoutMs = options.overviewTimeoutMs ?? OPENAI_COMPAT_OVERVIEW_TIMEOUT_MS;
    this.chatTimeoutMs = options.chatTimeoutMs ?? OPENAI_COMPAT_CHAT_TIMEOUT_MS;
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  async getStatus(): Promise<OpenAICompatibleProviderStatus> {
    let config: OpenAICompatibleConfig;
    try {
      config = await this.readConfig();
    } catch (error) {
      if (error instanceof OpenAICompatibleConfigError) return statusForConfigurationError();
      return statusForUnavailable();
    }

    const timedSignal = createTimedSignal(undefined, this.statusTimeoutMs);
    try {
      const response = await this.fetchImpl(`${config.base_url}/models`, {
        method: 'GET',
        headers: config.api_key === null ? {} : { Authorization: `Bearer ${config.api_key}` },
        redirect: 'error',
        signal: timedSignal.signal,
      });
      if (response.status === 401 || response.status === 403) {
        return {
          ...statusForUnavailable(),
          authenticated: false,
          failure_code: 'PROVIDER_NOT_AUTHENTICATED',
        };
      }
      if (response.status !== 200) return statusForUnavailable();

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return statusForUnavailable();
      }
      const modelIds = parseModelIds(body);
      if (modelIds === null) return statusForUnavailable();
      const detectedModel = modelIds.includes(config.model) ? config.model : null;
      return {
        provider: 'openai_compatible',
        transport: 'http',
        configured: true,
        installed: null,
        authenticated: true,
        available: detectedModel !== null,
        detected_model: detectedModel,
        failure_code: detectedModel === null ? 'PROVIDER_UNAVAILABLE' : null,
      };
    } catch {
      return statusForUnavailable();
    } finally {
      timedSignal.dispose();
    }
  }

  async *run(request: ProviderTaskRequest, signal?: AbortSignal): AsyncIterable<ProviderStreamEvent> {
    const parsedRequest = ProviderTaskRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      throw new ProviderTaskContractError('PROVIDER_OUTPUT_INVALID', 'Provider 请求不符合 C08 合同。', {
        issues: parsedRequest.error.issues,
      });
    }
    if (
      parsedRequest.data.provider !== 'openai_compatible'
      || !['overview', 'chat'].includes(parsedRequest.data.task_kind)
      || parsedRequest.data.session_mode !== 'new'
      || parsedRequest.data.provider_session_id !== null
      || parsedRequest.data.model !== null
    ) {
      throw new ProviderTaskContractError('PROVIDER_OUTPUT_INVALID', 'OpenAI-compatible Provider 只支持 overview/new/no-session。', {
        provider: parsedRequest.data.provider,
        task_kind: parsedRequest.data.task_kind,
      });
    }

    let config: OpenAICompatibleConfig;
    try {
      config = await this.readConfig();
    } catch (error) {
      if (error instanceof OpenAICompatibleConfigError) {
        yield failedEvent('provider_not_configured');
        return;
      }
      yield failedEvent('configuration_error');
      return;
    }

    const timeoutMs = parsedRequest.data.task_kind === 'chat' ? this.chatTimeoutMs : this.overviewTimeoutMs;
    const timedSignal = createTimedSignal(signal, timeoutMs);
    try {
      const response = await this.fetchImpl(`${config.base_url}/chat/completions`, {
        method: 'POST',
        headers: authorizationHeaders(config),
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: parsedRequest.data.system_prompt },
            { role: 'user', content: parsedRequest.data.user_input },
          ],
          stream: false,
        }),
        redirect: 'error',
        signal: timedSignal.signal,
      });
      if (response.status === 401 || response.status === 403) {
        yield failedEvent('provider_not_authenticated');
        return;
      }
      if (!response.ok) {
        yield failedEvent('http_status');
        return;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        yield failedEvent(failureCodeForResponse(error, timedSignal, signal));
        return;
      }
      let result;
      try {
        result = parseCompletion(body, config, this.idGenerator);
      } catch (error) {
        yield failedEvent(failureCodeForResponse(error, timedSignal, signal));
        return;
      }

      yield {
        type: 'session',
        provider: 'openai_compatible',
        provider_session_id: result.provider_session_id,
        model: result.model,
        text: null,
        error_code: null,
      };
      yield {
        type: 'completed',
        provider: 'openai_compatible',
        provider_session_id: result.provider_session_id,
        model: result.model,
        text: result.final_text,
        error_code: null,
      };
    } catch (error) {
      yield failedEvent(failureCodeForFetch(error, timedSignal, signal));
    } finally {
      timedSignal.dispose();
    }
  }
}

export { OpenAICompatibleAdapter as OpenAICompatibleProviderAdapter };
