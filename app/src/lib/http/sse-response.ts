import { randomUUID } from 'node:crypto';

export interface SseEventValue {
  readonly type: string;
  readonly stage?: string | null;
  readonly provider?: string | null;
  readonly provider_session_id?: string | null;
  readonly model?: string | null;
  readonly text?: string | null;
  readonly analysis_run?: unknown;
  readonly error?: unknown;
}

export function encodeSseEvent(value: SseEventValue): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify({
    event_id: randomUUID(),
    stage: null,
    provider: null,
    provider_session_id: null,
    model: null,
    text: null,
    analysis_run: null,
    error: null,
    ...value,
  })}\n\n`);
}

export function createSseResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
    },
  });
}
