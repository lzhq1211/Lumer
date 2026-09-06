import { describe, expect, it, vi } from 'vitest';

import { collectProviderTask } from './task-contract';
import { OpenAICompatibleAdapter, OpenAICompatibleProviderStatus } from './openai-compatible-adapter';
import { OpenAICompatibleConfigError } from './openai-compatible-config';
import type { OpenAICompatibleConfig } from './openai-compatible-config';

const config: OpenAICompatibleConfig = {
  base_url: 'https://provider.example/v1',
  model: 'configured-model',
  api_key: 'unit-test-key',
};

const overviewRequest = {
  provider: 'openai_compatible' as const,
  task_kind: 'overview' as const,
  session_mode: 'new' as const,
  provider_session_id: null,
  model: null,
  system_prompt: '请用简体中文总结。',
  user_input: '<untrusted_paper_text>Paper body</untrusted_paper_text>',
};

const chatRequest = {
  ...overviewRequest,
  task_kind: 'chat' as const,
  user_input: '<untrusted_chat_history>上一轮</untrusted_chat_history>\n<question>继续解释</question>',
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function expectProtocolFailure(adapter: OpenAICompatibleAdapter, errorCode: string, request = overviewRequest, signal?: AbortSignal) {
  await expect(collectProviderTask(adapter, request, signal)).rejects.toMatchObject({
    code: 'PROVIDER_PROTOCOL_ERROR',
    details: { error_code: errorCode },
  });
}

describe('OpenAI-compatible HTTP Provider', () => {
  it('sends only the minimum non-streaming chat completion request and returns a unified result', async () => {
    let captured: { input: string | URL | Request; init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      captured = { input, init };
      return jsonResponse({
        id: 'remote-task-1',
        model: 'remote-model',
        choices: [{ message: { content: '这是完整概览。' } }],
      });
    });
    const result = await collectProviderTask(new OpenAICompatibleAdapter({ readConfig: () => config, fetchImpl }), overviewRequest);
    expect(captured).not.toBeNull();
    const request = captured as unknown as { input: string | URL | Request; init?: RequestInit };

    expect(result.result).toEqual({
      provider: 'openai_compatible',
      provider_session_id: 'remote-task-1',
      model: 'remote-model',
      final_text: '这是完整概览。',
    });
    expect(request.input).toBe('https://provider.example/v1/chat/completions');
    expect(request.init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(request.init?.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer unit-test-key' });
    expect(JSON.parse(String(request.init?.body))).toEqual({
      model: 'configured-model',
      messages: [
        { role: 'system', content: '请用简体中文总结。' },
        { role: 'user', content: '<untrusted_paper_text>Paper body</untrusted_paper_text>' },
      ],
      stream: false,
    });
  });

  it('uses a generated task ID and configured model when the response omits them', async () => {
    const adapter = new OpenAICompatibleAdapter({
      readConfig: () => ({ ...config, api_key: null }),
      fetchImpl: async (_input, init) => {
        expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
        return jsonResponse({ choices: [{ message: { content: '完整文本' } }] });
      },
      idGenerator: () => 'local-task-id',
    });

    await expect(collectProviderTask(adapter, overviewRequest)).resolves.toMatchObject({
      result: {
        provider_session_id: 'local-task-id',
        model: 'configured-model',
        final_text: '完整文本',
      },
    });
  });

  it('accepts chat/new/no-session and sends the same non-streaming wire contract', async () => {
    let captured: { input: string | URL | Request; init?: RequestInit } | null = null;
    const result = await collectProviderTask(new OpenAICompatibleAdapter({
      readConfig: () => ({ ...config, api_key: null }),
      fetchImpl: async (input, init) => {
        captured = { input, init };
        return jsonResponse({ id: 'chat-task-1', choices: [{ message: { content: 'HTTP Chat 回答' } }] });
      },
    }), chatRequest);

    expect(result.result).toEqual({
      provider: 'openai_compatible',
      provider_session_id: 'chat-task-1',
      model: 'configured-model',
      final_text: 'HTTP Chat 回答',
    });
    const request = captured as unknown as { input: string | URL | Request; init?: RequestInit };
    expect(request.input).toBe('https://provider.example/v1/chat/completions');
    expect(JSON.parse(String(request.init?.body))).toMatchObject({ model: 'configured-model', stream: false });
    expect(JSON.parse(String(request.init?.body)).messages).toEqual([
      { role: 'system', content: '请用简体中文总结。' },
      { role: 'user', content: chatRequest.user_input },
    ]);
  });

  it('checks /models with a hard timeout and returns only the safe Provider Status DTO', async () => {
    let captured: { input: string | URL | Request; init?: RequestInit } | null = null;
    const adapter = new OpenAICompatibleAdapter({
      readConfig: () => config,
      fetchImpl: async (input, init) => {
        captured = { input, init };
        return jsonResponse({ data: [{ id: 'configured-model' }, { id: 'other-model' }] });
      },
    });
    const status = await adapter.getStatus();
    expect(captured).not.toBeNull();
    const request = captured as unknown as { input: string | URL | Request; init?: RequestInit };

    expect(status).toEqual({
      provider: 'openai_compatible',
      transport: 'http',
      configured: true,
      installed: null,
      authenticated: true,
      available: true,
      detected_model: 'configured-model',
      failure_code: null,
    });
    expect(request.input).toBe('https://provider.example/v1/models');
    expect(request.init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(request.init?.headers).toEqual({ Authorization: 'Bearer unit-test-key' });
    expect(JSON.stringify(status)).not.toContain(config.base_url);
    expect(JSON.stringify(status)).not.toContain(config.api_key!);
  });

  it('distinguishes authentication, availability, malformed response and missing configured model', async () => {
    const cases: Array<[number, Partial<OpenAICompatibleProviderStatus>]> = [
      [401, { authenticated: false, failure_code: 'PROVIDER_NOT_AUTHENTICATED' }],
      [403, { authenticated: false, failure_code: 'PROVIDER_NOT_AUTHENTICATED' }],
      [500, { authenticated: null, failure_code: 'PROVIDER_UNAVAILABLE' }],
    ];
    for (const [statusCode, expected] of cases) {
      const adapter = new OpenAICompatibleAdapter({ readConfig: () => config, fetchImpl: async () => jsonResponse({ secret: 'upstream-body' }, statusCode) });
      await expect(adapter.getStatus()).resolves.toMatchObject({ available: false, ...expected });
    }

    const malformed = new OpenAICompatibleAdapter({ readConfig: () => config, fetchImpl: async () => new Response('not-json', { status: 200 }) });
    await expect(malformed.getStatus()).resolves.toMatchObject({ authenticated: null, available: false, failure_code: 'PROVIDER_UNAVAILABLE' });

    const modelMissing = new OpenAICompatibleAdapter({ readConfig: () => config, fetchImpl: async () => jsonResponse({ data: [{ id: 'other-model' }] }) });
    await expect(modelMissing.getStatus()).resolves.toMatchObject({ authenticated: true, available: false, detected_model: null, failure_code: 'PROVIDER_UNAVAILABLE' });
  });

  it('returns unavailable on a status timeout and not-configured when configuration is absent', async () => {
    const timeoutFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new Error('aborted'));
      else init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const timeoutAdapter = new OpenAICompatibleAdapter({ readConfig: () => config, fetchImpl: timeoutFetch, statusTimeoutMs: 5 });
    await expect(timeoutAdapter.getStatus()).resolves.toMatchObject({ configured: true, authenticated: null, available: false, failure_code: 'PROVIDER_UNAVAILABLE' });

    const unconfigured = new OpenAICompatibleAdapter({ readConfig: () => { throw new OpenAICompatibleConfigError('missing'); } });
    await expect(unconfigured.getStatus()).resolves.toEqual({
      provider: 'openai_compatible',
      transport: 'http',
      configured: false,
      installed: null,
      authenticated: null,
      available: false,
      detected_model: null,
      failure_code: 'PROVIDER_NOT_CONFIGURED',
    });
  });

  it('rejects unsupported task and session combinations before any network call', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '不得调用' } }] }));
    const adapter = new OpenAICompatibleAdapter({ readConfig: () => config, fetchImpl });
    const unsupported = [
      { ...overviewRequest, task_kind: 'analyze' as const },
      { ...overviewRequest, task_kind: 'schema_repair' as const },
      { ...overviewRequest, session_mode: 'resume' as const, provider_session_id: 'old-task' },
      { ...overviewRequest, model: 'caller-supplied-model' },
      { ...chatRequest, session_mode: 'resume' as const, provider_session_id: 'old-task' },
      { ...chatRequest, model: 'caller-supplied-model' },
    ];

    for (const request of unsupported) {
      await expect(collectProviderTask(adapter, request)).rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_INVALID' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['empty content', { choices: [{ message: { content: '  ' } }] }, 'empty_content'],
    ['wrong content type', { choices: [{ message: { content: ['not-string'] } }] }, 'invalid_response'],
    ['missing choices', { id: 'task', model: 'model' }, 'invalid_response'],
    ['missing message', { choices: [{}] }, 'invalid_response'],
  ])('rejects %s without retaining the upstream response', async (_label, body, errorCode) => {
    const adapter = new OpenAICompatibleAdapter({ readConfig: () => config, fetchImpl: async () => jsonResponse(body) });
    await expectProtocolFailure(adapter, errorCode);
  });

  it.each([
    [401, 'provider_not_authenticated'],
    [403, 'provider_not_authenticated'],
    [429, 'http_status'],
    [500, 'http_status'],
  ])('maps HTTP %s to a stable safe failure', async (status, errorCode) => {
    const adapter = new OpenAICompatibleAdapter({ readConfig: () => config, fetchImpl: async () => jsonResponse({ secret: 'upstream-body' }, status) });
    await expectProtocolFailure(adapter, errorCode);
    await expect(collectProviderTask(adapter, overviewRequest)).rejects.not.toThrow('upstream-body');
  });

  it('maps timeout and caller abort without leaking endpoint or key', async () => {
    const neverResolvingFetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new Error('aborted'));
      else init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const timeoutAdapter = new OpenAICompatibleAdapter({ readConfig: () => config, fetchImpl: neverResolvingFetch, overviewTimeoutMs: 5 });
    await expectProtocolFailure(timeoutAdapter, 'http_timeout');

    const controller = new AbortController();
    controller.abort();
    const abortedAdapter = new OpenAICompatibleAdapter({ readConfig: () => config, fetchImpl: neverResolvingFetch, overviewTimeoutMs: 1000 });
    await expectProtocolFailure(abortedAdapter, 'http_aborted', { ...overviewRequest }, controller.signal);
    const abortedEvents = [];
    for await (const event of abortedAdapter.run(overviewRequest, controller.signal)) abortedEvents.push(event);
    expect(JSON.stringify(abortedEvents)).not.toContain(config.base_url);
    expect(JSON.stringify(abortedEvents)).not.toContain(config.api_key!);
  });

  it('maps invalid JSON response to a protocol error', async () => {
    const adapter = new OpenAICompatibleAdapter({
      readConfig: () => config,
      fetchImpl: async () => new Response('not-json', { status: 200 }),
    });
    await expectProtocolFailure(adapter, 'invalid_response');
  });

  it('keeps configuration failures safe when the adapter is called directly', async () => {
    const adapter = new OpenAICompatibleAdapter({ readConfig: () => { throw new Error('local secret should not escape'); } });
    const events = [];
    for await (const event of adapter.run(overviewRequest)) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'failed', provider: 'openai_compatible', error_code: 'configuration_error' });
    expect(JSON.stringify(events[0])).not.toContain('local secret');
  });
});
