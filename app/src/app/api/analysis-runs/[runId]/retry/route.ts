import { NextRequest } from 'next/server';
import { z } from 'zod';

import { analyzeCoordinator } from '@/application/analyze-coordinator';
import { AnalysisRunControlService, AnalyzeCancelledError } from '@/application/analysis-run-control-service';
import { CodexAnalysisService } from '@/application/codex-analysis-service';
import { MockAnalysisService } from '@/application/mock-analysis-service';
import { AnalysisProviderSchema } from '@/domain/analysis-run';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';
import { createSseResponse, encodeSseEvent, SseEventValue } from '@/lib/http/sse-response';
import { VaultContext } from '@/lib/storage/vault-path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RetryRunRequestSchema = z.strictObject({ provider: AnalysisProviderSchema });
interface Context { params: Promise<{ runId: string }> }

function retryStream(
  coordinator: Awaited<ReturnType<typeof getConfiguredVaultAccess>>['coordinator'],
  context: VaultContext,
  runId: string,
  requestedProvider: z.infer<typeof AnalysisProviderSchema>,
): Response {
  let runningRunId: string | null = null;
  let streamCancelled = false;
  let terminal = false;
  const providerAbort = new AbortController();
  const interruptStream = async () => {
    if (terminal || runningRunId === null) return;
    await new AnalysisRunControlService(analyzeCoordinator).interrupt(context, runningRunId);
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (value: SseEventValue) => controller.enqueue(encodeSseEvent(value));
      void (async () => {
        try {
          enqueue({ type: 'stage', stage: 'calling_provider', text: '正在创建新的论文分析 Retry Run。' });
          const run = await coordinator.runMutation('analyze', (vault) => (
            process.env.LUMER_ANALYZE_MODE === 'fixture' && requestedProvider === 'codex'
              ? new MockAnalysisService(analyzeCoordinator).retryDraft(vault, runId, (running) => {
                runningRunId = running.analysis_run_id;
                if (streamCancelled) void interruptStream();
              })
              : new CodexAnalysisService(analyzeCoordinator).retryDraft(vault, runId, (stage, text) => enqueue({ type: 'stage', stage, text }), (running) => {
                runningRunId = running.analysis_run_id;
                if (streamCancelled) void interruptStream();
              }, providerAbort.signal, requestedProvider)
          ));
          terminal = true;
          enqueue({ type: 'completed', provider: run.provider, model: run.model, provider_session_id: run.provider_session_id, analysis_run: run });
        } catch (error) {
          terminal = true;
          if (error instanceof AnalyzeCancelledError) {
            if (!streamCancelled) enqueue({ type: 'cancelled', provider: requestedProvider });
            return;
          }
          const payload = await apiError(error).json();
          if (!streamCancelled) enqueue({ type: 'failed', provider: requestedProvider, error: payload.error });
        } finally { if (!streamCancelled) controller.close(); }
      })();
    },
    async cancel() {
      streamCancelled = true;
      await interruptStream();
      providerAbort.abort();
    },
  });
  return createSseResponse(body);
}

export async function POST(request: NextRequest, context: Context) {
  try {
    if (!isAllowedOrigin(request)) throw new ApiRequestError('ORIGIN_FORBIDDEN', '该 Retry 请求不是来自当前 Lumer 页面。', 403);
    let body: unknown;
    try { body = await request.json(); } catch { throw new ApiRequestError('REQUEST_INVALID', 'Retry 请求不是有效 JSON。', 400); }
    const parsed = RetryRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiRequestError('REQUEST_INVALID', 'Retry 请求字段不符合合同。', 400);
    const { runId } = await context.params;
    const access = await getConfiguredVaultAccess();
    return retryStream(access.coordinator, access.context, runId, parsed.data.provider);
  } catch (error) { return apiError(error); }
}
