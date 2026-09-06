import { getProviderStatuses } from '@/application/provider-status-service';
import { apiError, apiSuccess } from '@/lib/http/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return apiSuccess(await getProviderStatuses(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
