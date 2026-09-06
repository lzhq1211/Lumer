import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnalyzeCoordinator } from '@/application/analyze-coordinator';
import { MockAnalysisService } from '@/application/mock-analysis-service';
import { PaperLifecycleService, PaperLifecycleServiceError } from '@/application/paper-lifecycle-service';
import { paperOperationCoordinator } from '@/application/paper-operation-coordinator';
import { ImportPaperService, ImportSimulatedCrashError } from '@/application/import-paper-service';
import { ChatSessionRepository } from '@/lib/storage/chat-session-repository';
import { ImportOperationRepository } from '@/lib/storage/import-operation-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { markdownHash } from '@/lib/markdown/paper-card-renderer';
import { createVaultContext, initializeVaultLayout, VaultContext } from '@/lib/storage/vault-path';
import { generatePdfFixtures } from '../helpers/pdf-fixtures';

let testRoot = '';
let context: VaultContext;
let sourcePath = '';

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-delete-'));
  await generatePdfFixtures(testRoot);
  const vault = path.join(testRoot, 'Vault');
  await fs.mkdir(vault);
  context = await createVaultContext(vault);
  await initializeVaultLayout(context);
  sourcePath = path.join(testRoot, 'single-column.pdf');
});

afterEach(async () => { await fs.rm(testRoot, { recursive: true, force: true }); });

async function paperWithManagedChildren() {
  const imported = await new ImportPaperService().import(context, sourcePath, 'fixture.pdf');
  const run = await new MockAnalysisService(new AnalyzeCoordinator()).createDraft(context, {
    paper_id: imported.paper.paper_id,
    provider: 'codex',
  });
  const cardPath = `Paper Cards/current--${imported.paper.paper_id.slice(0, 8)}.md`;
  const oldCardPath = `Paper Cards/old-copy--${imported.paper.paper_id.slice(0, 8)}.md`;
  const card = '# Current managed card\n';
  await fs.writeFile(path.join(context.rootPath, cardPath), card);
  await fs.writeFile(path.join(context.rootPath, oldCardPath), '# Former unmanaged card\n');
  const paper = await new PaperRepository(context).replace({
    ...imported.paper,
    card_path: cardPath,
    markdown_hash: markdownHash(card),
    markdown_sync_status: 'synced',
    record_revision: 2,
    updated_at: new Date().toISOString(),
  });
  await new ChatSessionRepository(context).write({
    schema_version: 1,
    paper_id: paper.paper_id,
    session_revision: 1,
    sessions: {
      codex: {
        session_id: randomUUID(),
        provider: 'codex',
        provider_session_id: 'fixture-session',
        model: 'fixture-model',
        messages: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      openai_compatible: null,
    },
  });
  return { paper, run, cardPath, oldCardPath };
}

describe('PaperLifecycleService', () => {
  it('permanently removes only the frozen managed cascade after one matching confirmation', async () => {
    const { paper, run, cardPath, oldCardPath } = await paperWithManagedChildren();
    const result = await new PaperLifecycleService().delete(context, paper.paper_id, {
      expected_record_revision: paper.record_revision,
      confirmed_paper_id: paper.paper_id,
    });

    expect(result.deleted_managed_paths).toEqual(expect.arrayContaining([
      `.lumer/sessions/${paper.paper_id}.json`,
      `.lumer/analyses/${paper.paper_id}/${run.analysis_run_id}.json`,
      `.lumer/extractions/${paper.paper_id}.json`,
      cardPath,
      paper.pdf_path,
      `.lumer/papers/${paper.paper_id}.json`,
    ]));
    expect(await new PaperRepository(context).exists(paper.paper_id)).toBe(false);
    await expect(fs.access(path.join(context.rootPath, oldCardPath))).resolves.toBeUndefined();
    await expect(fs.access(path.join(context.rootPath, cardPath))).rejects.toThrow();
  });

  it('returns PAPER_BUSY instead of waiting behind an in-flight paper mutation', async () => {
    const { paper } = await paperWithManagedChildren();
    let release!: () => void;
    const held = paperOperationCoordinator.runMutation(paper.paper_id, () => new Promise<void>((resolve) => { release = resolve; }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(new PaperLifecycleService().delete(context, paper.paper_id, {
      expected_record_revision: paper.record_revision,
      confirmed_paper_id: paper.paper_id,
    })).rejects.toMatchObject({ paperId: paper.paper_id });
    release();
    await held;
  });

  it('blocks new paper mutations until its exclusive delete lease has finished', async () => {
    const { paper } = await paperWithManagedChildren();
    let releaseDelete!: () => void;
    const deleting = paperOperationCoordinator.runDelete(paper.paper_id, () => new Promise<void>((resolve) => { releaseDelete = resolve; }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    let mutationEntered = false;
    const queuedMutation = paperOperationCoordinator.runMutation(paper.paper_id, async () => { mutationEntered = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mutationEntered).toBe(false);
    releaseDelete();
    await Promise.all([deleting, queuedMutation]);
    expect(mutationEntered).toBe(true);
  });

  it('keeps the PaperRecord when a child deletion fails and succeeds on retry', async () => {
    const { paper } = await paperWithManagedChildren();
    const pdfPath = path.join(context.rootPath, paper.pdf_path);
    await fs.rm(pdfPath);
    await fs.symlink(path.join(testRoot, 'missing.pdf'), pdfPath);

    await expect(new PaperLifecycleService().delete(context, paper.paper_id, {
      expected_record_revision: paper.record_revision,
      confirmed_paper_id: paper.paper_id,
    })).rejects.toMatchObject({
      code: 'DELETE_FAILED',
    } satisfies Partial<PaperLifecycleServiceError>);
    expect(await new PaperRepository(context).exists(paper.paper_id)).toBe(true);

    await fs.unlink(pdfPath);
    await fs.writeFile(pdfPath, 'restored managed PDF');
    await expect(new PaperLifecycleService().delete(context, paper.paper_id, {
      expected_record_revision: paper.record_revision,
      confirmed_paper_id: paper.paper_id,
    })).resolves.toMatchObject({ paper_id: paper.paper_id });
  });

  it('rejects a stale revision before any child is deleted', async () => {
    const { paper } = await paperWithManagedChildren();
    await expect(new PaperLifecycleService().delete(context, paper.paper_id, {
      expected_record_revision: paper.record_revision - 1,
      confirmed_paper_id: paper.paper_id,
    })).rejects.toMatchObject({ code: 'PAPER_RECORD_REVISION_CONFLICT' });
    expect(await new PaperRepository(context).exists(paper.paper_id)).toBe(true);
  });

  it('clears a safely recoverable import journal before fixing the delete object list', async () => {
    await expect(new ImportPaperService().import(context, sourcePath, 'interrupted.pdf', {
      injectFault(point) {
        if (point === 'paper_committed') throw new ImportSimulatedCrashError(point);
      },
    })).rejects.toMatchObject({ point: 'paper_committed' });
    const [paper] = await new PaperRepository(context).list();
    expect(await new ImportOperationRepository(context).list()).toHaveLength(1);

    await expect(new PaperLifecycleService().delete(context, paper.paper_id, {
      expected_record_revision: paper.record_revision,
      confirmed_paper_id: paper.paper_id,
    })).resolves.toMatchObject({ paper_id: paper.paper_id });
    await expect(new ImportOperationRepository(context).list()).resolves.toEqual([]);
  });

  it('keeps recovery evidence when an import journal is inconsistent', async () => {
    await expect(new ImportPaperService().import(context, sourcePath, 'broken-interrupted.pdf', {
      injectFault(point) {
        if (point === 'paper_committed') throw new ImportSimulatedCrashError(point);
      },
    })).rejects.toMatchObject({ point: 'paper_committed' });
    const [paper] = await new PaperRepository(context).list();
    await fs.rm(path.join(context.rootPath, paper.pdf_path));

    await expect(new PaperLifecycleService().delete(context, paper.paper_id, {
      expected_record_revision: paper.record_revision,
      confirmed_paper_id: paper.paper_id,
    })).rejects.toMatchObject({ code: 'DATA_INTEGRITY_ERROR' });
    expect(await new PaperRepository(context).exists(paper.paper_id)).toBe(true);
    expect(await new ImportOperationRepository(context).list()).toHaveLength(1);
  });
});
