import { spawn } from 'node:child_process';
import path from 'node:path';

import { z } from 'zod';

import { PdfLimits } from '@/lib/pdf/pdf-limits';
import { getPythonCommand } from '@/lib/pdf/python-runtime';

const WorkerPageSchema = z.strictObject({
  pdf_page_index: z.number().int().min(0),
  display_page_number: z.number().int().min(1),
  text: z.string(),
});

const WorkerSuccessSchema = z.strictObject({
  ok: z.literal(true),
  data: z.strictObject({
    pymupdf_version: z.string().min(1),
    page_count: z.number().int().min(1),
    extracted_char_count: z.number().int().min(0),
    estimated_tokens: z.number().int().min(0),
    elapsed_ms: z.number().nonnegative(),
    pages: z.array(WorkerPageSchema).min(1),
  }),
});

const WorkerFailureSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.enum([
      'PDF_ENCRYPTED',
      'PDF_SCANNED',
      'PDF_CORRUPT',
      'PDF_LIMIT_EXCEEDED',
      'WORKER_PROTOCOL_ERROR',
    ]),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).nullable(),
  }),
});

const WorkerResponseSchema = z.discriminatedUnion('ok', [WorkerSuccessSchema, WorkerFailureSchema]);

export type PdfWorkerData = z.infer<typeof WorkerSuccessSchema>['data'];

export class PdfWorkerError extends Error {
  constructor(
    readonly code: z.infer<typeof WorkerFailureSchema>['error']['code'] | 'WORKER_UNAVAILABLE',
    message: string,
    readonly details: Record<string, unknown> | null = null,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PdfWorkerError';
  }
}

export async function runPdfWorker(pdfPath: string, limits: PdfLimits): Promise<PdfWorkerData> {
  const python = await getPythonCommand();
  const workerPath = path.join(process.cwd(), 'python', 'pdf_worker.py');

  return new Promise((resolve, reject) => {
    const child = spawn(python.command, [...python.argsPrefix, workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        reject(new PdfWorkerError('WORKER_UNAVAILABLE', 'PDF worker 执行超时。'));
      }
    }, 30_000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 16 * 1024 * 1024) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4_096) stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new PdfWorkerError('WORKER_UNAVAILABLE', '无法启动 PDF worker。', null, error));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new PdfWorkerError('WORKER_UNAVAILABLE', 'PDF worker 异常退出。', null, stderr));
        return;
      }
      try {
        const response = WorkerResponseSchema.parse(JSON.parse(stdout));
        if (!response.ok) {
          reject(new PdfWorkerError(
            response.error.code,
            response.error.message,
            response.error.details,
          ));
          return;
        }
        resolve(response.data);
      } catch (error) {
        reject(new PdfWorkerError('WORKER_UNAVAILABLE', 'PDF worker 返回协议无效。', null, error));
      }
    });

    child.stdin.end(JSON.stringify({ action: 'inspect_extract', pdf_path: pdfPath, limits }));
  });
}
