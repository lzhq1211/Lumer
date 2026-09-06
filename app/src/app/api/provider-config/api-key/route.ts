import { NextRequest } from 'next/server';

import { ProviderConfigService, ProviderConfigServiceError } from '@/application/provider-config-service';
import { apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest) {
  try {
    if (!isAllowedOrigin(request)) {
      throw new ProviderConfigServiceError('ORIGIN_FORBIDDEN', '该 Provider 配置请求不是来自当前 Lumer 页面。', 403, false, null);
    }
    return apiSuccess(await new ProviderConfigService().clearApiKey(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
