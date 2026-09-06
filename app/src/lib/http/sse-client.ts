function parseFrame<T>(frame: string): T | null {
  const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith('data:'));
  return dataLine ? JSON.parse(dataLine.slice(5).trim()) as T : null;
}

export async function* readSseData<T>(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = parseFrame<T>(frame);
        if (data !== null) yield data;
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const data = parseFrame<T>(buffer);
      if (data !== null) yield data;
    }
  } finally {
    reader.releaseLock();
  }
}
