import { NextRequest } from 'next/server';

import { PaperLibraryService } from '@/application/paper-library-service';
import { PaperLifecycleService } from '@/application/paper-lifecycle-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PaperRouteContext {
  params: Promise<{ paperId: string }>;
}

export async function GET(_request: NextRequest, routeContext: PaperRouteContext) {
  try {
    const { paperId } = await routeContext.params;
    const { context } = await getConfiguredVaultAccess();
    return apiSuccess(await new PaperLibraryService().detail(context, paperId), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, routeContext: PaperRouteContext) {
  try {
    if (!isAllowedOrigin(request)) {
      throw new ApiRequestError(
        'ORIGIN_FORBIDDEN',
        '该 Metadata 请求不是来自当前 Lumer 页面。',
        403,
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiRequestError('REQUEST_INVALID', 'Metadata 请求不是有效 JSON。', 400);
    }

    const { paperId } = await routeContext.params;
    const { coordinator } = await getConfiguredVaultAccess();
    const paper = await coordinator.runMutation('metadata', (mutationContext) => (
      new PaperLibraryService().updateMetadata(mutationContext, paperId, body)
    ));
    return apiSuccess(paper, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, routeContext: PaperRouteContext) {
  try {
    if (!isAllowedOrigin(request)) {
      throw new ApiRequestError('ORIGIN_FORBIDDEN', '该删除请求不是来自当前 Lumer 页面。', 403);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiRequestError('REQUEST_INVALID', '删除请求不是有效 JSON。', 400);
    }
    const { paperId } = await routeContext.params;
    const { coordinator } = await getConfiguredVaultAccess();
    const result = await coordinator.runMutation('delete', (context) => (
      new PaperLifecycleService().delete(context, paperId, body)
    ));
    return apiSuccess(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
