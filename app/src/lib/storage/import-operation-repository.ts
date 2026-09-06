import { promises as fs } from 'node:fs';

import { ImportOperation, ImportOperationSchema } from '@/domain/paper';
import { UuidSchema } from '@/domain/storage-types';
import { removeVaultFile, vaultPathExists } from '@/lib/storage/staged-file';
import { VersionedJsonRepository } from '@/lib/storage/versioned-json-repository';
import { resolveExistingVaultPath, VaultContext } from '@/lib/storage/vault-path';

export class ImportOperationRepository {
  private readonly json: VersionedJsonRepository<'import_operation'>;

  constructor(private readonly context: VaultContext) {
    this.json = new VersionedJsonRepository(context, 'import_operation');
  }

  relativePath(paperId: string): string {
    return `.lumer/operations/imports/${UuidSchema.parse(paperId)}.json`;
  }

  async create(operation: ImportOperation): Promise<ImportOperation> {
    const validated = ImportOperationSchema.parse(operation);
    const relativePath = this.relativePath(validated.paper_id);
    if (await vaultPathExists(this.context, relativePath)) {
      throw new Error('ImportOperation already exists');
    }
    return this.json.write(relativePath, validated);
  }

  async update(operation: ImportOperation): Promise<ImportOperation> {
    const validated = ImportOperationSchema.parse(operation);
    if (!await vaultPathExists(this.context, this.relativePath(validated.paper_id))) {
      throw new Error('ImportOperation does not exist');
    }
    return this.json.write(this.relativePath(validated.paper_id), validated);
  }

  async remove(paperId: string): Promise<boolean> {
    return removeVaultFile(this.context, this.relativePath(paperId));
  }

  async list(): Promise<ImportOperation[]> {
    const directory = await resolveExistingVaultPath(this.context, '.lumer/operations/imports');
    const entries = await fs.readdir(directory.absolutePath, { withFileTypes: true });
    const operations: ImportOperation[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const paperId = entry.name.slice(0, -5);
      UuidSchema.parse(paperId);
      const operation = await this.json.read(this.relativePath(paperId));
      if (operation.paper_id !== paperId) throw new Error('ImportOperation filename mismatch');
      operations.push(operation);
    }
    return operations;
  }
}
