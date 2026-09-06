import { describe, expect, it } from 'vitest';

import { ProviderAvailabilityError, requireAvailableProvider } from '@/application/provider-availability';
import { FixtureAnalyzeProviderAdapter } from '@/lib/ai-providers/fixture-analyze-adapter';
import { CodexAnalyzeAdapter } from '@/lib/ai-providers/codex-analyze-adapter';
import { apiError } from '@/lib/http/api-response';
import {
  collectProviderTask,
  ProviderStreamEvent,
  ProviderTaskAdapter,
  ProviderTaskContractError,
} from '@/lib/ai-providers/task-contract';

const analyzeRequest = {
  provider: 'codex' as const,
  task_kind: 'analyze' as const,
  session_mode: 'new' as const,
  provider_session_id: null,
  model: null,
  system_prompt: '总结必须使用简体中文；引文保持论文原语言。',
  user_input: '<untrusted_paper_text>Physical page 1</untrusted_paper_text>',
};

function adapterFrom(events: ProviderStreamEvent[]): ProviderTaskAdapter {
  return {
    async *run() {
      yield* events;
    },
  };
}

describe('Provider Task Contract (C08)', () => {
  it('只接受 Codex Analyze 合同，并消费 completed 最终文本', async () => {
    const codex = await collectProviderTask(new FixtureAnalyzeProviderAdapter('{"summary_language":"zh-CN"}'), analyzeRequest);

    expect(codex.result).toMatchObject({ provider: 'codex', model: 'mock-fixture-v1', final_text: '{"summary_language":"zh-CN"}' });
  });

  it('拒绝跨用 Analyze Session、未知字段和缺失 completed 事件', async () => {
    await expect(collectProviderTask(new FixtureAnalyzeProviderAdapter('{}'), { ...analyzeRequest, session_mode: 'resume', provider_session_id: 'old-session' }))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_INVALID' });
    await expect(collectProviderTask(adapterFrom([]), analyzeRequest)).rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_INVALID' });
    await expect(collectProviderTask(new FixtureAnalyzeProviderAdapter('{}'), { ...analyzeRequest, api_key: 'must-not-be-accepted' }))
      .rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_INVALID' });
  });

  it('在终止事件后丢弃迟到事件，不把半成品文本拼入最终结果', async () => {
    const result = await collectProviderTask(adapterFrom([
      { type: 'session', provider: 'codex', provider_session_id: 'session-1', model: 'unknown', text: null, error_code: null },
      { type: 'text_delta', provider: 'codex', provider_session_id: 'session-1', model: 'unknown', text: '{"partial":', error_code: null },
      { type: 'completed', provider: 'codex', provider_session_id: 'session-1', model: 'unknown', text: '{"complete":true}', error_code: null },
      { type: 'text_delta', provider: 'codex', provider_session_id: 'session-1', model: 'unknown', text: 'late', error_code: null },
    ]), analyzeRequest);

    expect(result).toEqual({
      result: { provider: 'codex', provider_session_id: 'session-1', model: 'unknown', final_text: '{"complete":true}' },
      dropped_late_event_count: 1,
    });
  });

  it('将 Codex CLI 执行结果转换为同一 Provider Task 合同', async () => {
    const result = await collectProviderTask(new CodexAnalyzeAdapter(async () => ({
      provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
      model: 'unknown',
      final_text: '{"background":[]}',
    })), analyzeRequest);

    expect(result.result).toEqual({
      provider: 'codex',
      provider_session_id: '9b851f06-040c-40a4-9a10-59a4eb48bc4d',
      model: 'unknown',
      final_text: '{"background":[]}',
    });
  });

  it('将 Provider 可用性映射为明确错误，且不会改写请求的 Provider', () => {
    const unavailable = [
      [{ installed: false, authenticated: false, available: false, failure_code: 'PROVIDER_NOT_INSTALLED' }, 'PROVIDER_NOT_INSTALLED'],
      [{ installed: true, authenticated: false, available: false, failure_code: 'PROVIDER_NOT_AUTHENTICATED' }, 'PROVIDER_NOT_AUTHENTICATED'],
      [{ installed: true, authenticated: true, available: false, failure_code: 'PROVIDER_UNAVAILABLE' }, 'PROVIDER_UNAVAILABLE'],
    ] as const;

    for (const [status, code] of unavailable) {
      expect(() => requireAvailableProvider({ provider: 'codex', detected_model: null, ...status }, 'codex'))
        .toThrow(ProviderAvailabilityError);
      try {
        requireAvailableProvider({ provider: 'codex', detected_model: null, ...status }, 'codex');
      } catch (error) {
        expect(error).toMatchObject({ code, provider: 'codex' });
      }
    }

    expect(() => requireAvailableProvider({
      provider: 'openai_compatible',
      configured: false,
      installed: null,
      authenticated: null,
      available: false,
      detected_model: null,
    }, 'openai_compatible')).toThrowError(new ProviderAvailabilityError('PROVIDER_NOT_CONFIGURED', 'openai_compatible'));
  });

  it('将 Provider 可用性和协议失败映射为合同定义的安全 HTTP 错误', async () => {
    const unavailable = apiError(new ProviderAvailabilityError('PROVIDER_NOT_INSTALLED', 'codex'));
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({ error: { code: 'PROVIDER_NOT_INSTALLED', details: { provider: 'codex' } } });

    const protocol = apiError(new ProviderTaskContractError('PROVIDER_PROTOCOL_ERROR', 'Provider 任务失败。', { provider: 'codex', error_code: 'connection_lost' }));
    expect(protocol.status).toBe(502);
    await expect(protocol.json()).resolves.toMatchObject({ error: { code: 'PROVIDER_PROTOCOL_ERROR', details: { provider: 'codex' } } });

    const notConfigured = apiError(new ProviderAvailabilityError('PROVIDER_NOT_CONFIGURED', 'openai_compatible'));
    expect(notConfigured.status).toBe(422);
    await expect(notConfigured.json()).resolves.toMatchObject({ error: { code: 'PROVIDER_NOT_CONFIGURED', details: { provider: 'openai_compatible' } } });
  });

  it('将 Provider failed 事件映射为安全的协议错误', async () => {
    await expect(collectProviderTask(adapterFrom([{
      type: 'failed', provider: 'codex', provider_session_id: null, model: null, text: null, error_code: 'connection_lost',
    }]), analyzeRequest)).rejects.toBeInstanceOf(ProviderTaskContractError);
    await expect(collectProviderTask(adapterFrom([{
      type: 'failed', provider: 'codex', provider_session_id: null, model: null, text: null, error_code: 'connection_lost',
    }]), analyzeRequest)).rejects.toMatchObject({ code: 'PROVIDER_PROTOCOL_ERROR' });
  });
});
