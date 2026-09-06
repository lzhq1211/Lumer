import { createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { NextRequest } from 'next/server';

import { ImportPaperService } from '@/application/import-paper-service';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { ApiRequestError, apiError, apiSuccess } from '@/lib/http/api-response';
import { isAllowedOrigin } from '@/lib/http/same-origin';
import { PDF_LIMITS } from '@/lib/pdf/pdf-limits';
import { PdfSupportError } from '@/lib/pdf/pdf-support-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseSinglePdf(formData: FormData): File {
  const files = formData.getAll('file');
  if (files.length !== 1 || !(files[0] instanceof File)) {
    throw new ApiRequestError('REQUEST_INVALID', '必须提供且只能提供一个 PDF 文件。', 400);
  }
  const file = files[0];
  if (!file.name.trim()) {
    throw new ApiRequestError('REQUEST_INVALID', '文件名不能为空。', 400);
  }
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    throw new PdfSupportError('PDF_INVALID_EXTENSION', '只支持 .pdf 文件。', 422);
  }
  if (file.size > PDF_LIMITS.max_file_bytes) {
    throw new PdfSupportError(
      'PDF_LIMIT_EXCEEDED',
      'PDF 文件大小超过限制。',
      413,
      { limit_kind: 'max_file_bytes', limit: PDF_LIMITS.max_file_bytes, actual: file.size },
    );
  }
  return file;
}

async function stageUpload(file: File, directory: string): Promise<string> {
  const stagedPath = path.join(directory, 'upload.pdf');
  await pipeline(
    Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(stagedPath, { flags: 'wx', mode: 0o600 }),
  );
  return stagedPath;
}

export async function POST(request: NextRequest) {
  let uploadDirectory: string | null = null;
  try {
    if (!isAllowedOrigin(request)) {
      throw new ApiRequestError(
        'ORIGIN_FORBIDDEN',
        '该导入请求不是来自当前 Lumer 页面。',
        403,
      );
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      throw new ApiRequestError('REQUEST_INVALID', '导入请求必须使用 multipart/form-data。', 400);
    }
    const file = parseSinglePdf(await request.formData());
    uploadDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-import-'));
    const sourcePath = await stageUpload(file, uploadDirectory);

    const { coordinator } = await getConfiguredVaultAccess();
    const result = await coordinator.runMutation('import', (context) => (
      new ImportPaperService().import(context, sourcePath, file.name)
    ));
    return apiSuccess(result, {
      status: result.duplicate ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  } finally {
    if (uploadDirectory) {
      await fs.rm(uploadDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
