import { NextRequest } from 'next/server';

import { DraftService } from '@/application/draft-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
interface Context { params: Promise<{ runId: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    if (!isAllowedOrigin(request)) throw new ApiRequestError('ORIGIN_FORBIDDEN', '该派生 Draft 请求不是来自当前 Lumer 页面。', 403);
    const { runId } = await context.params; const { coordinator } = await getConfiguredVaultAccess();
    return apiSuccess(await coordinator.runMutation('analyze', (vault) => new DraftService().derive(vault, runId)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
