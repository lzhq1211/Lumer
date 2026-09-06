import { promises as fs } from 'node:fs';

import {
  AnalysisRun,
  AnalysisRunSchema,
  assertAnalysisRunCreate,
  assertAnalysisRunUpdate,
  isActiveAnalysisRun,
} from '@/domain/analysis-run';
import { UuidSchema } from '@/domain/storage-types';
import { StorageSchemaError } from '@/lib/storage/schema-registry';
import { removeVaultFile, vaultPathExists } from '@/lib/storage/staged-file';
import { VersionedJsonRepository } from '@/lib/storage/versioned-json-repository';
import { resolveExistingVaultPath, VaultContext } from '@/lib/storage/vault-path';

export class AnalysisRunRepository {
  private readonly json: VersionedJsonRepository<'analysis_run'>;

  constructor(private readonly context: VaultContext) {
    this.json = new VersionedJsonRepository(context, 'analysis_run');
  }

  relativePath(paperId: string, runId: string): string {
    return `.lumer/analyses/${UuidSchema.parse(paperId)}/${UuidSchema.parse(runId)}.json`;
  }

  async exists(paperId: string, runId: string): Promise<boolean> {
    return vaultPathExists(this.context, this.relativePath(paperId, runId));
  }

  async read(paperId: string, runId: string): Promise<AnalysisRun> {
    return this.json.read(this.relativePath(paperId, runId));
  }

  async create(run: AnalysisRun): Promise<AnalysisRun> {
    const validated = AnalysisRunSchema.parse(run);
    assertAnalysisRunCreate(validated);
    const relativePath = this.relativePath(validated.paper_id, validated.analysis_run_id);
    if (await vaultPathExists(this.context, relativePath)) throw new Error('AnalysisRun already exists');
    await fs.mkdir((await resolveExistingVaultPath(this.context, '.lumer/analyses')).absolutePath + `/${validated.paper_id}`, { recursive: true });
    return this.json.write(relativePath, validated);
  }

  async replace(run: AnalysisRun): Promise<AnalysisRun> {
    const validated = AnalysisRunSchema.parse(run);
    const previous = await this.read(validated.paper_id, validated.analysis_run_id);
    assertAnalysisRunUpdate(previous, validated);
    return this.json.write(this.relativePath(validated.paper_id, validated.analysis_run_id), validated);
  }

  async remove(paperId: string, runId: string): Promise<boolean> {
    return removeVaultFile(this.context, this.relativePath(paperId, runId));
  }

  async listForPaper(paperId: string): Promise<AnalysisRun[]> {
    const validatedPaperId = UuidSchema.parse(paperId);
    const relativeDirectory = `.lumer/analyses/${validatedPaperId}`;
    if (!await vaultPathExists(this.context, relativeDirectory)) return [];
    const directory = await resolveExistingVaultPath(this.context, relativeDirectory);
    const entries = await fs.readdir(directory.absolutePath, { withFileTypes: true });
    const runs: AnalysisRun[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const runId = entry.name.slice(0, -5);
      if (!UuidSchema.safeParse(runId).success) {
        throw new StorageSchemaError('DATA_INTEGRITY_ERROR', 'AnalysisRun 文件名不符合领域 ID 合同。', { object_kind: 'analysis_run' });
      }
      const run = await this.read(validatedPaperId, runId);
      if (run.paper_id !== validatedPaperId || run.analysis_run_id !== runId) {
        throw new StorageSchemaError('DATA_INTEGRITY_ERROR', 'AnalysisRun 文件路径与对象身份不一致。', { object_kind: 'analysis_run' });
      }
      runs.push(run);
    }
    return runs;
  }

  async listAll(): Promise<AnalysisRun[]> {
    const directory = await resolveExistingVaultPath(this.context, '.lumer/analyses');
    const entries = await fs.readdir(directory.absolutePath, { withFileTypes: true });
    const runs: AnalysisRun[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue;
      if (!UuidSchema.safeParse(entry.name).success) {
        throw new StorageSchemaError('DATA_INTEGRITY_ERROR', 'AnalysisRun 目录名不符合 Paper ID 合同。', { object_kind: 'analysis_run' });
      }
      runs.push(...await this.listForPaper(entry.name));
    }
    return runs;
  }

  async findById(runId: string): Promise<AnalysisRun | null> {
    const validatedRunId = UuidSchema.parse(runId);
    return (await this.listAll()).find((run) => run.analysis_run_id === validatedRunId) ?? null;
  }

  async findActive(): Promise<AnalysisRun | null> {
    const activeRuns = (await this.listAll()).filter(isActiveAnalysisRun);
    if (activeRuns.length > 1) {
      throw new StorageSchemaError('DATA_INTEGRITY_ERROR', '检测到多个全局活动 AnalysisRun。', { object_kind: 'analysis_run' });
    }
    return activeRuns[0] ?? null;
  }
}
