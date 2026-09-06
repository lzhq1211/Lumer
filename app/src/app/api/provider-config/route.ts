import { NextRequest } from 'next/server';

import { ProviderConfigService, ProviderConfigServiceError } from '@/application/provider-config-service';
import { apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return apiSuccess(await new ProviderConfigService().getConfig(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!isAllowedOrigin(request)) {
      throw new ProviderConfigServiceError('ORIGIN_FORBIDDEN', '该 Provider 配置请求不是来自当前 Lumer 页面。', 403, false, null);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ProviderConfigServiceError('REQUEST_INVALID', 'Provider 配置请求不是有效 JSON。', 400, false, null);
    }
    return apiSuccess(await new ProviderConfigService().saveConfig(body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
