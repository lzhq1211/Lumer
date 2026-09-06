import { promises as fs } from 'node:fs';

import { AnnotationOperation, AnnotationOperationSchema } from '@/domain/paper';
import { UuidSchema } from '@/domain/storage-types';
import { removeVaultFile, vaultPathExists } from '@/lib/storage/staged-file';
import { VersionedJsonRepository } from '@/lib/storage/versioned-json-repository';
import { resolveExistingVaultPath, VaultContext } from '@/lib/storage/vault-path';

export class AnnotationOperationRepository {
  private readonly json: VersionedJsonRepository<'annotation_operation'>;

  constructor(private readonly context: VaultContext) {
    this.json = new VersionedJsonRepository(context, 'annotation_operation');
  }

  relativePath(paperId: string): string {
    return `.lumer/operations/annotations/${UuidSchema.parse(paperId)}.json`;
  }

  async exists(paperId: string): Promise<boolean> {
    return vaultPathExists(this.context, this.relativePath(paperId));
  }

  async read(paperId: string): Promise<AnnotationOperation> {
    return this.json.read(this.relativePath(paperId));
  }

  async create(operation: AnnotationOperation): Promise<AnnotationOperation> {
    const validated = AnnotationOperationSchema.parse(operation);
    if (await this.exists(validated.paper_id)) {
      throw new Error('AnnotationOperation already exists');
    }
    return this.json.write(this.relativePath(validated.paper_id), validated);
  }

  async update(operation: AnnotationOperation): Promise<AnnotationOperation> {
    const validated = AnnotationOperationSchema.parse(operation);
    if (!await this.exists(validated.paper_id)) {
      throw new Error('AnnotationOperation does not exist');
    }
    return this.json.write(this.relativePath(validated.paper_id), validated);
  }

  async remove(paperId: string): Promise<boolean> {
    return removeVaultFile(this.context, this.relativePath(paperId));
  }

  async list(): Promise<AnnotationOperation[]> {
    const directory = await resolveExistingVaultPath(this.context, '.lumer/operations/annotations');
    const entries = await fs.readdir(directory.absolutePath, { withFileTypes: true });
    const operations: AnnotationOperation[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const paperId = entry.name.slice(0, -5);
      UuidSchema.parse(paperId);
      const operation = await this.read(paperId);
      if (operation.paper_id !== paperId) throw new Error('AnnotationOperation filename mismatch');
      operations.push(operation);
    }
    return operations;
  }
}
