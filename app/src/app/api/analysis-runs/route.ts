import { NextRequest } from 'next/server';
import { z } from 'zod';

import { analyzeCoordinator } from '@/application/analyze-coordinator';
import { AnalysisRunControlService, AnalyzeCancelledError } from '@/application/analysis-run-control-service';
import { CodexAnalysisService, CreateAnalysisRunRequestSchema } from '@/application/codex-analysis-service';
import { MockAnalysisService } from '@/application/mock-analysis-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';
import { createSseResponse, encodeSseEvent, SseEventValue } from '@/lib/http/sse-response';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { VaultContext } from '@/lib/storage/vault-path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function analysisStream(
  coordinator: Awaited<ReturnType<typeof getConfiguredVaultAccess>>['coordinator'],
  context: VaultContext,
  request: z.infer<typeof CreateAnalysisRunRequestSchema>,
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
          const providerLabel = request.provider === 'codex' ? 'Codex' : 'OpenAI-compatible';
          enqueue({ type: 'stage', stage: 'calling_provider', provider: request.provider, text: `正在准备 ${providerLabel} 概览。` });
          const run = await coordinator.runMutation('analyze', (context) => (
            process.env.LUMER_ANALYZE_MODE === 'fixture' && request.provider === 'codex'
              ? new MockAnalysisService(analyzeCoordinator).createDraft(context, request, null, (running) => {
                runningRunId = running.analysis_run_id;
                if (streamCancelled) void interruptStream();
              })
              : new CodexAnalysisService(analyzeCoordinator).createOverview(context, request, (stage, text) => enqueue({ type: 'stage', stage, text }), null, (running) => {
                runningRunId = running.analysis_run_id;
                if (streamCancelled) void interruptStream();
              }, providerAbort.signal)
          ));
          terminal = true;
          enqueue({ type: 'completed', provider: run.provider, model: run.model, provider_session_id: run.provider_session_id, analysis_run: run });
        } catch (error) {
          terminal = true;
          if (error instanceof AnalyzeCancelledError) {
            if (!streamCancelled) enqueue({ type: 'cancelled', provider: request.provider });
            return;
          }
          const payload = await apiError(error).json();
          if (!streamCancelled) enqueue({ type: 'failed', provider: request.provider, error: payload.error });
        } finally {
          if (!streamCancelled) controller.close();
        }
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

export async function GET(request: NextRequest) {
  try {
    const keys = [...request.nextUrl.searchParams.keys()];
    if (keys.length !== 1 || request.nextUrl.searchParams.getAll('paper_id').length !== 1) {
      throw new ApiRequestError('REQUEST_INVALID', 'AnalysisRun 查询必须且只能包含 paper_id。', 400);
    }
    const paperId = request.nextUrl.searchParams.get('paper_id');
    if (!paperId) throw new ApiRequestError('REQUEST_INVALID', 'paper_id 不能为空。', 400);
    const { context } = await getConfiguredVaultAccess();
    return apiSuccess(await new AnalysisRunRepository(context).listForPaper(paperId), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAllowedOrigin(request)) {
      throw new ApiRequestError('ORIGIN_FORBIDDEN', '该论文分析请求不是来自当前 Lumer 页面。', 403);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiRequestError('REQUEST_INVALID', '论文分析请求不是有效 JSON。', 400);
    }
    const parsed = CreateAnalysisRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiRequestError('REQUEST_INVALID', '论文分析请求字段不符合合同。', 400);
    const { coordinator, context } = await getConfiguredVaultAccess();
    return analysisStream(coordinator, context, parsed.data);
  } catch (error) {
    return apiError(error);
  }
}
