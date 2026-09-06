import { describe, expect, it } from 'vitest';

import { readSseData } from '@/lib/http/sse-client';
import { createSseResponse, encodeSseEvent } from '@/lib/http/sse-response';

describe('SSE response', () => {
  it('encodes the stable envelope with explicit nullable fields', () => {
    const frame = new TextDecoder().decode(encodeSseEvent({
      type: 'completed',
      analysis_run: { analysis_run_id: 'run-1' },
    }));
    expect(frame.endsWith('\n\n')).toBe(true);

    const payload = JSON.parse(frame.slice('data: '.length).trim());
    expect(payload).toEqual({
      event_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      type: 'completed',
      stage: null,
      provider: null,
      provider_session_id: null,
      model: null,
      text: null,
      analysis_run: { analysis_run_id: 'run-1' },
      error: null,
    });
  });

  it('creates a streaming Response with the existing headers', () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const response = createSseResponse(body);

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Connection')).toBe('keep-alive');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
  });

  it('round-trips an encoded event through the streaming response', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeSseEvent({ type: 'stage', stage: 'calling_provider' }));
        controller.close();
      },
    });
    const stream = createSseResponse(body).body;
    if (!stream) throw new Error('expected streaming response body');

    const events = [];
    for await (const event of readSseData<{ type: string; stage: string }>(stream)) events.push(event);

    expect(events).toEqual([
      expect.objectContaining({ type: 'stage', stage: 'calling_provider' }),
    ]);
  });
});
