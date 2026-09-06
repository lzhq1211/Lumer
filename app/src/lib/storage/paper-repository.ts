import { promises as fs } from 'node:fs';

import { PaperRecord, PaperRecordSchema } from '@/domain/paper';
import { UuidSchema } from '@/domain/storage-types';
import { VersionedJsonRepository } from '@/lib/storage/versioned-json-repository';
import { StorageSchemaError } from '@/lib/storage/schema-registry';
import {
  resolveExistingVaultPath,
  VaultContext,
} from '@/lib/storage/vault-path';
import { removeVaultFile, vaultPathExists } from '@/lib/storage/staged-file';

export class PaperRepository {
  private readonly json: VersionedJsonRepository<'paper_record'>;

  constructor(private readonly context: VaultContext) {
    this.json = new VersionedJsonRepository(context, 'paper_record');
  }

  relativePath(paperId: string): string {
    return `.lumer/papers/${UuidSchema.parse(paperId)}.json`;
  }

  async read(paperId: string): Promise<PaperRecord> {
    return this.json.read(this.relativePath(paperId));
  }

  async exists(paperId: string): Promise<boolean> {
    return vaultPathExists(this.context, this.relativePath(paperId));
  }

  async create(record: PaperRecord): Promise<PaperRecord> {
    const validated = PaperRecordSchema.parse(record);
    const relativePath = this.relativePath(validated.paper_id);
    if (await vaultPathExists(this.context, relativePath)) {
      throw new Error('PaperRecord already exists');
    }
    return this.json.write(relativePath, validated);
  }

  async replace(record: PaperRecord): Promise<PaperRecord> {
    const validated = PaperRecordSchema.parse(record);
    const relativePath = this.relativePath(validated.paper_id);
    if (!await vaultPathExists(this.context, relativePath)) {
      throw new Error('PaperRecord does not exist');
    }
    return this.json.write(relativePath, validated);
  }

  async remove(paperId: string): Promise<boolean> {
    return removeVaultFile(this.context, this.relativePath(paperId));
  }

  async list(): Promise<PaperRecord[]> {
    const directory = await resolveExistingVaultPath(this.context, '.lumer/papers');
    const entries = await fs.readdir(directory.absolutePath, { withFileTypes: true });
    const records: PaperRecord[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const paperId = entry.name.slice(0, -5);
      if (!UuidSchema.safeParse(paperId).success) {
        throw new StorageSchemaError(
          'DATA_INTEGRITY_ERROR',
          'PaperRecord 文件名不符合领域 ID 合同。',
          { object_kind: 'paper_record' },
        );
      }
      const record = await this.read(paperId);
      if (record.paper_id !== paperId) throw new Error('PaperRecord filename mismatch');
      records.push(record);
    }
    return records;
  }

  async findBySourceSha256(sourceSha256: string): Promise<PaperRecord | null> {
    return (await this.list()).find((record) => record.source_sha256 === sourceSha256) ?? null;
  }
}
