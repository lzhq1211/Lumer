import { NextRequest } from 'next/server';

import { MarkdownSyncService } from '@/application/markdown-sync-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
interface Context { params: Promise<{ runId: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    if (!isAllowedOrigin(request)) throw new ApiRequestError('ORIGIN_FORBIDDEN', '该 Markdown 同步请求不是来自当前 Lumer 页面。', 403);
    let body: unknown; try { body = await request.json(); } catch { throw new ApiRequestError('REQUEST_INVALID', 'Markdown 同步请求不是有效 JSON。', 400); }
    const requestBody = body as { expected_paper_record_revision?: unknown; markdown_action?: unknown; expected_markdown_hash?: unknown };
    if (typeof requestBody.expected_paper_record_revision !== 'number' || !['create', 'overwrite', 'save_as'].includes(String(requestBody.markdown_action)) || !(typeof requestBody.expected_markdown_hash === 'string' || requestBody.expected_markdown_hash === null)) {
      throw new ApiRequestError('REQUEST_INVALID', 'Markdown 同步请求字段不符合合同。', 400);
    }
    const { runId } = await context.params;
    const { coordinator } = await getConfiguredVaultAccess();
    return apiSuccess(await coordinator.runMutation('markdown_sync', async (vault) => {
      const run = await new AnalysisRunRepository(vault).findById(runId);
      if (!run) throw new ApiRequestError('REQUEST_INVALID', '未找到 AnalysisRun。', 400);
      return new MarkdownSyncService().sync(vault, run.paper_id, runId, requestBody as never);
    }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
