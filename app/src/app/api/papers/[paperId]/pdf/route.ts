import { NextRequest, NextResponse } from 'next/server';

import { ReaderService } from '@/application/reader-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError } from '@/lib/http/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PaperPdfRouteContext {
  params: Promise<{ paperId: string }>;
}

function contentDispositionFileName(fileName: string): string {
  return encodeURIComponent(fileName).replace(/[!'()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

export async function GET(request: NextRequest, routeContext: PaperPdfRouteContext) {
  try {
    if ([...request.nextUrl.searchParams.keys()].length > 0) {
      throw new ApiRequestError('REQUEST_INVALID', 'PDF 读取不接受路径或其他查询参数。', 400);
    }
    const { paperId } = await routeContext.params;
    const { context } = await getConfiguredVaultAccess();
    const result = await new ReaderService().readManagedPdf(context, paperId);
    return new NextResponse(new Uint8Array(result.bytes), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `inline; filename*=UTF-8''${contentDispositionFileName(result.paper.original_file_name)}`,
        'Content-Length': String(result.bytes.byteLength),
        'Content-Type': 'application/pdf',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
