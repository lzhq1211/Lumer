import { NextRequest } from 'next/server';

import { apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';
import { LUMER_CONFIG_SCHEMA_VERSION, LumerConfig } from '@/lib/config/lumer-config';
import { LumerConfigRepository } from '@/lib/config/lumer-config-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function view(config: LumerConfig | null) {
  return { configured: Boolean(config?.easyscholar_secret_key) };
}

export async function GET() {
  try {
    return apiSuccess(view(await new LumerConfigRepository().read()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!isAllowedOrigin(request)) return apiError(new Error('该请求不是来自当前 Lumer 页面。'));
    const body = await request.json() as { secret_key?: unknown };
    if (typeof body.secret_key !== 'string' || body.secret_key.trim().length === 0) {
      return apiError(new Error('EasyScholar SecretKey 不能为空。'));
    }
    const repository = new LumerConfigRepository();
    const current = await repository.read();
    if (!current) return apiError(new Error('请先完成 Lumer 基础设置。'));
    const next: LumerConfig = {
      ...current,
      schema_version: LUMER_CONFIG_SCHEMA_VERSION,
      easyscholar_secret_key: body.secret_key.trim(),
    };
    await repository.write(next);
    return apiSuccess(view(next), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isAllowedOrigin(request)) return apiError(new Error('该请求不是来自当前 Lumer 页面。'));
    const repository = new LumerConfigRepository();
    const current = await repository.read();
    if (!current) return apiSuccess({ configured: false });
    const next: LumerConfig = { ...current, schema_version: LUMER_CONFIG_SCHEMA_VERSION, easyscholar_secret_key: null };
    await repository.write(next);
    return apiSuccess(view(next), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
