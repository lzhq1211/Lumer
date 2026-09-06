import { NextRequest } from 'next/server';

import { ChatRequestSchema, ChatService } from '@/application/chat-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';
import { createSseResponse, encodeSseEvent } from '@/lib/http/sse-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
interface Context { params: Promise<{ paperId: string }> }

export async function GET(request: NextRequest, context: Context) {
  try {
    const provider = request.nextUrl.searchParams.get('provider');
    if (request.nextUrl.searchParams.toString() !== `provider=${provider}` || (provider !== 'codex' && provider !== 'openai_compatible')) {
      throw new ApiRequestError('REQUEST_INVALID', 'Chat 查询必须指定有效 provider。', 400);
    }
    const { paperId } = await context.params; const { context: vault } = await getConfiguredVaultAccess();
    return apiSuccess(await new ChatService().get(vault, paperId, provider), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    if (!isAllowedOrigin(request)) throw new ApiRequestError('ORIGIN_FORBIDDEN', '该 Chat 请求不是来自当前 Lumer 页面。', 403);
    const body = ChatRequestSchema.parse(await request.json()); const { paperId } = await context.params; const { context: vault } = await getConfiguredVaultAccess();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { void (async () => { try { const session = await new ChatService().send(vault, paperId, body); controller.enqueue(encodeSseEvent({ type: 'completed', provider: body.provider, text: session.messages.at(-1)?.content ?? '' })); } catch (error) { const payload = await apiError(error).json(); controller.enqueue(encodeSseEvent({ type: 'failed', provider: body.provider, error: payload.error })); } finally { controller.close(); } })(); } });
    return createSseResponse(stream);
  } catch (error) { return apiError(error); }
}
