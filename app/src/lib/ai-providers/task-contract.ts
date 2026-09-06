import { z } from 'zod';

import { AnalysisProviderSchema } from '@/domain/analysis-run';

const NonEmptyStringSchema = z.string().trim().min(1);

export const ProviderTaskKindSchema = z.enum(['chat', 'overview', 'analyze', 'schema_repair']);
export const ProviderSessionModeSchema = z.enum(['new', 'resume']);

export const ProviderTaskRequestSchema = z.strictObject({
  provider: AnalysisProviderSchema,
  task_kind: ProviderTaskKindSchema,
  session_mode: ProviderSessionModeSchema,
  provider_session_id: NonEmptyStringSchema.nullable(),
  model: NonEmptyStringSchema.nullable(),
  system_prompt: NonEmptyStringSchema,
  user_input: NonEmptyStringSchema,
}).superRefine((value, context) => {
  if (['overview', 'analyze'].includes(value.task_kind) && (value.session_mode !== 'new' || value.provider_session_id !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Overview/Analyze 必须创建全新的 Provider Session。' });
  }
  if (value.task_kind === 'schema_repair' && (value.session_mode !== 'resume' || value.provider_session_id === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Schema repair 必须续接同一 Provider Session。' });
  }
  if (value.task_kind === 'chat' && value.session_mode === 'new' && value.provider_session_id !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '新的 Chat Session 不得预先携带 Provider Session。' });
  }
  if (value.provider === 'openai_compatible' && (
    !['overview', 'chat'].includes(value.task_kind)
    || value.session_mode !== 'new'
    || value.provider_session_id !== null
    || value.model !== null
  )) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'OpenAI-compatible Provider 只支持 overview/chat + new 且不接受 Session 或调用方模型。' });
  }
});

export const ProviderStreamEventSchema = z.strictObject({
  type: z.enum(['session', 'text_delta', 'thinking_delta', 'completed', 'failed']),
  provider: AnalysisProviderSchema,
  provider_session_id: NonEmptyStringSchema.nullable(),
  model: NonEmptyStringSchema.nullable(),
  text: z.string().nullable(),
  error_code: NonEmptyStringSchema.nullable(),
});

export const ProviderTaskResultSchema = z.strictObject({
  provider: AnalysisProviderSchema,
  provider_session_id: NonEmptyStringSchema,
  model: NonEmptyStringSchema,
  final_text: z.string(),
});

export type ProviderTaskRequest = z.infer<typeof ProviderTaskRequestSchema>;
export type ProviderStreamEvent = z.infer<typeof ProviderStreamEventSchema>;
export type ProviderTaskResult = z.infer<typeof ProviderTaskResultSchema>;

export interface ProviderTaskAdapter {
  run(request: ProviderTaskRequest, signal?: AbortSignal): AsyncIterable<ProviderStreamEvent>;
}

export class ProviderTaskContractError extends Error {
  constructor(
    readonly code: 'PROVIDER_OUTPUT_INVALID' | 'PROVIDER_PROTOCOL_ERROR',
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProviderTaskContractError';
  }
}

export interface CollectedProviderTask {
  result: ProviderTaskResult;
  dropped_late_event_count: number;
}

export async function collectProviderTask(
  adapter: ProviderTaskAdapter,
  input: unknown,
  signal?: AbortSignal,
): Promise<CollectedProviderTask> {
  const request = ProviderTaskRequestSchema.safeParse(input);
  if (!request.success) {
    throw new ProviderTaskContractError('PROVIDER_OUTPUT_INVALID', 'Provider 请求不符合 C08 合同。', { issues: request.error.issues });
  }

  let terminal = false;
  let droppedLateEventCount = 0;
  let sessionId: string | null = null;
  let model: string | null = null;
  let result: ProviderTaskResult | null = null;

  for await (const rawEvent of adapter.run(request.data, signal)) {
    const event = ProviderStreamEventSchema.safeParse(rawEvent);
    if (!event.success) {
      throw new ProviderTaskContractError('PROVIDER_OUTPUT_INVALID', 'Provider Stream 事件不符合 C08 合同。', { issues: event.error.issues });
    }
    if (terminal) {
      droppedLateEventCount += 1;
      continue;
    }
    if (event.data.provider !== request.data.provider) {
      throw new ProviderTaskContractError('PROVIDER_OUTPUT_INVALID', 'Provider Stream 返回了错误的 Provider。', {
        requested_provider: request.data.provider,
        event_provider: event.data.provider,
      });
    }
    if (event.data.type === 'session') {
      sessionId = event.data.provider_session_id;
      model = event.data.model;
      continue;
    }
    if (event.data.type === 'failed') {
      terminal = true;
      const message = event.data.error_code === 'codex_timeout'
        ? request.data.task_kind === 'overview' ? 'Codex 概览超过 5 分钟，已停止。' : request.data.task_kind === 'chat' ? 'Codex Chat 已停止。' : 'Codex Analyze 超过 5 分钟，已停止。'
        : 'Provider 任务失败。';
      throw new ProviderTaskContractError('PROVIDER_PROTOCOL_ERROR', message, {
        provider: request.data.provider,
        error_code: event.data.error_code,
      });
    }
    if (event.data.type === 'completed') {
      terminal = true;
      const parsed = ProviderTaskResultSchema.safeParse({
        provider: event.data.provider,
        provider_session_id: event.data.provider_session_id ?? sessionId,
        model: event.data.model ?? model,
        final_text: event.data.text,
      });
      if (!parsed.success) {
        throw new ProviderTaskContractError('PROVIDER_OUTPUT_INVALID', 'Provider 完成事件缺少最终结果。', { issues: parsed.error.issues });
      }
      result = parsed.data;
    }
  }

  if (!result) {
    throw new ProviderTaskContractError('PROVIDER_OUTPUT_INVALID', 'Provider Stream 未发送 completed 终止事件。', {
      provider: request.data.provider,
    });
  }
  return { result, dropped_late_event_count: droppedLateEventCount };
}
