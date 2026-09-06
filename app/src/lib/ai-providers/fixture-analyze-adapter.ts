import { randomUUID } from 'node:crypto';

import {
  ProviderStreamEvent,
  ProviderTaskAdapter,
  ProviderTaskRequest,
} from '@/lib/ai-providers/task-contract';

export class FixtureAnalyzeProviderAdapter implements ProviderTaskAdapter {
  constructor(private readonly finalText: string) {}

  async *run(request: ProviderTaskRequest): AsyncIterable<ProviderStreamEvent> {
    const providerSessionId = `fixture-${randomUUID()}`;
    const model = 'mock-fixture-v1';
    yield {
      type: 'session',
      provider: request.provider,
      provider_session_id: providerSessionId,
      model,
      text: null,
      error_code: null,
    };
    yield {
      type: 'completed',
      provider: request.provider,
      provider_session_id: providerSessionId,
      model,
      text: this.finalText,
      error_code: null,
    };
  }
}
