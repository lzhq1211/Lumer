import { NextRequest } from 'next/server';

import { analyzeCoordinator } from '@/application/analyze-coordinator';
import { AnalysisRunControlService } from '@/application/analysis-run-control-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context { params: Promise<{ runId: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    if (!isAllowedOrigin(request)) {
      throw new ApiRequestError('ORIGIN_FORBIDDEN', '该取消请求不是来自当前 Lumer 页面。', 403);
    }
    const { runId } = await context.params;
    const { coordinator } = await getConfiguredVaultAccess();
    const run = await coordinator.runMutation('analyze', (vault) => (
      new AnalysisRunControlService(analyzeCoordinator).cancel(vault, runId)
    ));
    return apiSuccess(run, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
