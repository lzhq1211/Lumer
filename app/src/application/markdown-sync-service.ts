import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { PaperMutationCoordinator, paperMutationCoordinator } from '@/application/paper-mutation-coordinator';
import { AnalysisRun, isOverviewRun } from '@/domain/analysis-run';
import { MarkdownSyncContext, PaperRecord } from '@/domain/paper';
import { RevisionSchema, Sha256Schema } from '@/domain/storage-types';
import { markdownHash, OVERVIEW_RENDERER_VERSION, PAPER_CARD_RENDERER_VERSION, renderPaperCard } from '@/lib/markdown/paper-card-renderer';
import { AtomicWriteError, atomicWriteFile } from '@/lib/storage/atomic-file';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { paperCardRelativePath } from '@/lib/storage/safe-file-name';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { resolveVaultPathForWrite, VaultContext } from '@/lib/storage/vault-path';

export type MarkdownAction = 'create' | 'overwrite' | 'save_as';

export interface MarkdownSyncRequest {
  readonly expected_paper_record_revision: number;
  readonly markdown_action: MarkdownAction;
  readonly expected_markdown_hash: string | null;
}

export interface MarkdownSyncServiceOptions {
  readonly beforeRename?: (targetPath: string) => void | Promise<void>;
}

export class MarkdownSyncServiceError extends Error {
  constructor(
    readonly code: 'RUN_STATE_INVALID' | 'PAPER_RECORD_REVISION_CONFLICT' | 'MARKDOWN_CONFLICT' | 'MARKDOWN_WRITE_FAILED',
    message: string,
    readonly status: 409 | 422,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MarkdownSyncServiceError';
  }
}

function assertRequest(request: MarkdownSyncRequest): void {
  RevisionSchema.parse(request.expected_paper_record_revision);
  if ((request.markdown_action === 'overwrite') !== (request.expected_markdown_hash !== null)) {
    throw new MarkdownSyncServiceError('RUN_STATE_INVALID', 'Markdown hash 与写入方式不一致。', 409, {});
  }
  if (request.expected_markdown_hash !== null) Sha256Schema.parse(request.expected_markdown_hash);
}

async function markdownHashAt(context: VaultContext, relativePath: string): Promise<string | null> {
  const target = await resolveVaultPathForWrite(context, relativePath);
  try {
    return markdownHash(await fs.readFile(target.absolutePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function copyTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '-');
}

async function nextSaveAsPath(context: VaultContext, sourcePath: string, now: Date): Promise<string> {
  const parsed = path.posix.parse(sourcePath);
  const base = `${parsed.name}--copy-${copyTimestamp(now)}`;
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${parsed.dir}/${base}${suffix === 1 ? '' : `-${suffix}`}${parsed.ext}`;
    if (await markdownHashAt(context, candidate) === null) return candidate;
  }
}

export class MarkdownSyncService {
  constructor(
    private readonly coordinator: PaperMutationCoordinator = paperMutationCoordinator,
    private readonly options: MarkdownSyncServiceOptions = {},
  ) {}

  async createContext(
    context: VaultContext,
    paper: PaperRecord,
    run: AnalysisRun,
    request: Omit<MarkdownSyncRequest, 'expected_paper_record_revision'>,
  ): Promise<MarkdownSyncContext> {
    const completeRequest = { ...request, expected_paper_record_revision: paper.record_revision };
    assertRequest(completeRequest);
    const canonicalPath = paper.card_path ?? paperCardRelativePath(paper.title, paper.paper_id);
    const targetCardPath = request.markdown_action === 'save_as'
      ? await nextSaveAsPath(context, canonicalPath, new Date())
      : canonicalPath;
    await this.assertTarget(context, targetCardPath, request.markdown_action, request.expected_markdown_hash);
    return {
      operation_id: randomUUID(),
      analysis_run_id: run.analysis_run_id,
      renderer_version: isOverviewRun(run) ? OVERVIEW_RENDERER_VERSION : PAPER_CARD_RENDERER_VERSION,
      markdown_action: request.markdown_action,
      target_card_path: targetCardPath,
      expected_markdown_hash: request.expected_markdown_hash,
      rendered_hash: markdownHash(renderPaperCard(run)),
      created_at: new Date().toISOString(),
    };
  }

  async sync(context: VaultContext, paperId: string, runId: string, request: MarkdownSyncRequest): Promise<PaperRecord> {
    assertRequest(request);
    return this.coordinator.runMutation(paperId, async () => {
      const papers = new PaperRepository(context);
      const paper = await papers.read(paperId);
      if (paper.record_revision !== request.expected_paper_record_revision) {
        throw new MarkdownSyncServiceError('PAPER_RECORD_REVISION_CONFLICT', '论文记录已更新。', 409, {
          expected_revision: request.expected_paper_record_revision,
          actual_revision: paper.record_revision,
        });
      }
      if (paper.current_final_run_id === null || paper.current_final_run_id !== runId) {
        throw new MarkdownSyncServiceError('RUN_STATE_INVALID', '当前论文没有可同步的 Final。', 409, { paper_id: paperId });
      }
      const run = await new AnalysisRunRepository(context).read(paperId, runId);
      if (!['finalizing', 'finalized'].includes(run.state)) {
        throw new MarkdownSyncServiceError('RUN_STATE_INVALID', '当前 Final 状态不能同步 Markdown。', 409, { run_id: run.analysis_run_id, state: run.state });
      }
      const syncContext = await this.createContext(context, paper, run, request);
      const pending = await papers.replace(this.pendingRecord(paper, syncContext));
      return this.writePending(context, pending, run);
    });
  }

  pendingRecord(paper: PaperRecord, syncContext: MarkdownSyncContext): PaperRecord {
    return {
      ...paper,
      markdown_sync_status: 'pending',
      pending_card_path: syncContext.target_card_path,
      markdown_sync_context: syncContext,
      markdown_sync_error: null,
      record_revision: paper.record_revision + 1,
      updated_at: new Date().toISOString(),
    };
  }

  async writePending(context: VaultContext, paper: PaperRecord, run: AnalysisRun): Promise<PaperRecord> {
    const syncContext = paper.markdown_sync_context;
    if (syncContext === null || paper.pending_card_path === null || syncContext.analysis_run_id !== run.analysis_run_id) {
      throw new MarkdownSyncServiceError('RUN_STATE_INVALID', 'Markdown 同步上下文不完整。', 422, { paper_id: paper.paper_id });
    }
    const markdown = renderPaperCard(run);
    if (markdownHash(markdown) !== syncContext.rendered_hash) {
      throw new MarkdownSyncServiceError('RUN_STATE_INVALID', 'Markdown Renderer 结果与持久化上下文不一致。', 422, { run_id: run.analysis_run_id });
    }
    const papers = new PaperRepository(context);
    try {
      await this.assertTarget(context, syncContext.target_card_path, syncContext.markdown_action, syncContext.expected_markdown_hash);
      const target = await resolveVaultPathForWrite(context, syncContext.target_card_path);
      await atomicWriteFile(target, markdown, {
        beforeRename: async () => {
          await this.options.beforeRename?.(target.absolutePath);
          await this.assertTarget(context, syncContext.target_card_path, syncContext.markdown_action, syncContext.expected_markdown_hash);
        },
      });
    } catch (error) {
      const conflict = (error instanceof MarkdownSyncServiceError && error.code === 'MARKDOWN_CONFLICT')
        || (error instanceof AtomicWriteError && error.cause instanceof MarkdownSyncServiceError && error.cause.code === 'MARKDOWN_CONFLICT');
      return papers.replace({
        ...paper,
        markdown_sync_status: conflict ? 'conflict' : 'error',
        markdown_sync_error: conflict ? 'Paper Card 已被外部修改，未覆盖。' : 'Paper Card 写入失败；Final 已安全保存。',
        record_revision: paper.record_revision + 1,
        updated_at: new Date().toISOString(),
      });
    }
    return papers.replace({
      ...paper,
      card_path: syncContext.target_card_path,
      markdown_hash: syncContext.rendered_hash,
      markdown_sync_status: 'synced',
      pending_card_path: null,
      markdown_sync_context: null,
      markdown_sync_error: null,
      record_revision: paper.record_revision + 1,
      updated_at: new Date().toISOString(),
    });
  }

  private async assertTarget(
    context: VaultContext,
    targetCardPath: string,
    action: MarkdownAction,
    expectedHash: string | null,
  ): Promise<void> {
    const actualHash = await markdownHashAt(context, targetCardPath);
    const allowed = action === 'overwrite'
      ? actualHash === expectedHash
      : actualHash === null;
    if (allowed) return;
    throw new MarkdownSyncServiceError('MARKDOWN_CONFLICT', 'Paper Card 已被外部修改，请选择覆盖或另存新文件。', 409, {
      target_card_path: targetCardPath,
      expected_markdown_hash: expectedHash,
      actual_markdown_hash: actualHash,
    });
  }
}
