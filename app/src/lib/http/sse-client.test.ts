import { describe, expect, it } from 'vitest';

import { readSseData } from '@/lib/http/sse-client';

const encoder = new TextEncoder();

function streamFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

async function collect<T>(stream: ReadableStream<Uint8Array>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of readSseData<T>(stream)) values.push(value);
  return values;
}

describe('SSE client parser', () => {
  it('reassembles a UTF-8 frame split across multiple byte chunks', async () => {
    const bytes = encoder.encode('data: {"type":"stage","text":"正在生成"}\n\n');
    const firstBreak = bytes.indexOf(0xe6) + 1;

    await expect(collect(streamFrom([
      bytes.slice(0, firstBreak),
      bytes.slice(firstBreak, firstBreak + 2),
      bytes.slice(firstBreak + 2),
    ]))).resolves.toEqual([{ type: 'stage', text: '正在生成' }]);
  });

  it('parses multiple LF and CRLF frames from one chunk', async () => {
    const bytes = encoder.encode([
      'data: {"type":"stage"}\n\n',
      'data: {"type":"completed"}\r\n\r\n',
    ].join(''));

    await expect(collect(streamFrom([bytes]))).resolves.toEqual([
      { type: 'stage' },
      { type: 'completed' },
    ]);
  });

  it('ignores frames without data lines and parses the remaining frame at EOF', async () => {
    const bytes = encoder.encode([
      ': heartbeat\nignored: value\n\n',
      'event: message\ndata: {"type":"completed","text":"done"}',
    ].join(''));

    await expect(collect(streamFrom([bytes]))).resolves.toEqual([
      { type: 'completed', text: 'done' },
    ]);
  });

  it('preserves JSON.parse failure semantics for invalid data', async () => {
    const invalid = streamFrom([encoder.encode('data: {invalid}\n\n')]);
    await expect(collect(invalid)).rejects.toBeInstanceOf(SyntaxError);
  });
});
