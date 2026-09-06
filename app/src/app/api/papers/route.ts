import { NextRequest } from 'next/server';

import {
  PaperLibraryService,
  parsePaperListQuery,
} from '@/application/paper-library-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { apiError, apiSuccess } from '@/lib/http/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { context } = await getConfiguredVaultAccess();
    const query = parsePaperListQuery(request.nextUrl.searchParams);
    return apiSuccess(await new PaperLibraryService().list(context, query), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
