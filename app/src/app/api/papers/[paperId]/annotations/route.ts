import { NextRequest } from 'next/server';

import { AnnotationService } from '@/application/annotation-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AnnotationRouteContext {
  params: Promise<{ paperId: string }>;
}

export async function GET(request: NextRequest, routeContext: AnnotationRouteContext) {
  try {
    if ([...request.nextUrl.searchParams.keys()].length > 0) {
      throw new ApiRequestError('REQUEST_INVALID', 'Annotation 读取不接受查询参数。', 400);
    }
    const { paperId } = await routeContext.params;
    const { context } = await getConfiguredVaultAccess();
    return apiSuccess(await new AnnotationService().list(context, paperId), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, routeContext: AnnotationRouteContext) {
  try {
    if (!isAllowedOrigin(request)) {
      throw new ApiRequestError('ORIGIN_FORBIDDEN', '该 Annotation 请求不是来自当前 Lumer 页面。', 403);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiRequestError('REQUEST_INVALID', 'Annotation 请求不是有效 JSON。', 400);
    }
    const { paperId } = await routeContext.params;
    const { coordinator } = await getConfiguredVaultAccess();
    const result = await coordinator.runMutation('annotation', (context) => (
      new AnnotationService().create(context, paperId, body)
    ));
    return apiSuccess(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
