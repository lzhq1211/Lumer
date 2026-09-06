import { NextRequest } from 'next/server';

import { AnnotationService } from '@/application/annotation-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AnnotationItemRouteContext {
  params: Promise<{ paperId: string; annotationId: string }>;
}

async function parseBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiRequestError('REQUEST_INVALID', 'Annotation 请求不是有效 JSON。', 400);
  }
}

function requireAllowedOrigin(request: NextRequest): void {
  if (!isAllowedOrigin(request)) {
    throw new ApiRequestError('ORIGIN_FORBIDDEN', '该 Annotation 请求不是来自当前 Lumer 页面。', 403);
  }
}

export async function PATCH(request: NextRequest, routeContext: AnnotationItemRouteContext) {
  try {
    requireAllowedOrigin(request);
    const body = await parseBody(request);
    const { paperId, annotationId } = await routeContext.params;
    const { coordinator } = await getConfiguredVaultAccess();
    const result = await coordinator.runMutation('annotation', (context) => (
      new AnnotationService().update(context, paperId, annotationId, body)
    ));
    return apiSuccess(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, routeContext: AnnotationItemRouteContext) {
  try {
    requireAllowedOrigin(request);
    const body = await parseBody(request);
    const { paperId, annotationId } = await routeContext.params;
    const { coordinator } = await getConfiguredVaultAccess();
    const result = await coordinator.runMutation('annotation', (context) => (
      new AnnotationService().delete(context, paperId, annotationId, body)
    ));
    return apiSuccess(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
