import { NextRequest } from 'next/server';

import { PaperLibraryService } from '@/application/paper-library-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Context { params: Promise<{ runId: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    if (!isAllowedOrigin(request)) {
      throw new ApiRequestError('ORIGIN_FORBIDDEN', '该 Metadata Candidate 请求不是来自当前 Lumer 页面。', 403);
    }
    let body: unknown;
    try { body = await request.json(); } catch { throw new ApiRequestError('REQUEST_INVALID', 'Metadata Candidate 请求不是有效 JSON。', 400); }
    const { runId } = await context.params;
    const { coordinator } = await getConfiguredVaultAccess();
    const paper = await coordinator.runMutation('metadata', (vault) => (
      new PaperLibraryService().acceptMetadataCandidate(vault, runId, body)
    ));
    return apiSuccess(paper, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
