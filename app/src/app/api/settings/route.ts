import { NextRequest } from 'next/server';

import { SettingsService, SettingsServiceError } from '@/application/settings-service';
import { apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const view = await new SettingsService().getSettings();
    return apiSuccess(view, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!isAllowedOrigin(request)) {
      throw new SettingsServiceError(
        'ORIGIN_FORBIDDEN',
        '该设置请求不是来自当前 Lumer 页面。',
        403,
        false,
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new SettingsServiceError(
        'REQUEST_INVALID',
        '设置请求不是有效 JSON。',
        400,
        false,
      );
    }

    const view = await new SettingsService().saveSettings(body);
    return apiSuccess(view, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
