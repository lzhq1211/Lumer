import { NextRequest } from 'next/server';

import { DraftService } from '@/application/draft-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
interface Context { params: Promise<{ runId: string }> }

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { runId } = await context.params; const { context: vault } = await getConfiguredVaultAccess();
    const run = await new AnalysisRunRepository(vault).findById(runId);
    if (!run) throw new ApiRequestError('REQUEST_INVALID', 'AnalysisRun 不存在。', 400);
    return apiSuccess(run, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    if (!isAllowedOrigin(request)) throw new ApiRequestError('ORIGIN_FORBIDDEN', '该 Draft 请求不是来自当前 Lumer 页面。', 403);
    let body: unknown; try { body = await request.json(); } catch { throw new ApiRequestError('REQUEST_INVALID', 'Draft 请求不是有效 JSON。', 400); }
    const { runId } = await context.params; const { coordinator } = await getConfiguredVaultAccess();
    const run = await coordinator.runMutation('analyze', (vault) => new DraftService().save(vault, runId, body));
    return apiSuccess(run, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
