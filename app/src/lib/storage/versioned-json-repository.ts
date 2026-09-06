import { promises as fs } from 'node:fs';

import {
  migrateStorageObject,
  StorageObjectByKind,
  StorageObjectKind,
  StorageSchemaError,
} from '@/lib/storage/schema-registry';
import { AtomicWriteOptions, atomicWriteJson } from '@/lib/storage/atomic-file';
import {
  resolveExistingVaultPath,
  resolveVaultPathForWrite,
  VaultContext,
} from '@/lib/storage/vault-path';

export class VersionedJsonRepositoryError extends Error {
  constructor(
    readonly operation: 'read' | 'write',
    message: string,
    readonly cause: unknown,
  ) {
    super(message);
    this.name = 'VersionedJsonRepositoryError';
  }
}

export class VersionedJsonRepository<Kind extends StorageObjectKind> {
  constructor(
    private readonly context: VaultContext,
    private readonly kind: Kind,
  ) {}

  async read(relativePath: string): Promise<StorageObjectByKind[Kind]> {
    try {
      const resolvedPath = await resolveExistingVaultPath(this.context, relativePath);
      const raw = await fs.readFile(resolvedPath.absolutePath, 'utf8');
      return migrateStorageObject(this.kind, JSON.parse(raw));
    } catch (error) {
      if (error instanceof StorageSchemaError) throw error;
      throw new VersionedJsonRepositoryError('read', '无法安全读取版本化 JSON。', error);
    }
  }

  async write(
    relativePath: string,
    value: unknown,
    options: AtomicWriteOptions = {},
  ): Promise<StorageObjectByKind[Kind]> {
    const validated = migrateStorageObject(this.kind, value);
    try {
      const resolvedPath = await resolveVaultPathForWrite(this.context, relativePath);
      await atomicWriteJson(resolvedPath, validated, options);
      return validated;
    } catch (error) {
      throw new VersionedJsonRepositoryError('write', '无法安全写入版本化 JSON。', error);
    }
  }
}
