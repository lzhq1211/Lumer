import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

import {
  commitStagedFile,
  copyToStagedFile,
  removeVaultFile,
  replaceWithStagedFile,
  vaultPathExists,
} from '@/lib/storage/staged-file';
import {
  resolveExistingVaultPath,
  VaultContext,
  VaultPathError,
} from '@/lib/storage/vault-path';

export class ManagedPdfStore {
  constructor(private readonly context: VaultContext) {}

  async exists(relativePath: string): Promise<boolean> {
    return vaultPathExists(this.context, relativePath);
  }

  async read(relativePath: string): Promise<{ absolutePath: string; bytes: Buffer; sha256: string }> {
    const resolved = await resolveExistingVaultPath(this.context, relativePath);
    const stats = await fs.stat(resolved.absolutePath);
    if (!stats.isFile()) {
      throw new VaultPathError(
        'VAULT_PATH_INVALID',
        '托管 PDF 路径不是文件。',
        resolved.relativePath,
      );
    }
    const bytes = await fs.readFile(resolved.absolutePath);
    return {
      absolutePath: resolved.absolutePath,
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  async writeStaged(sourcePath: string, stagedRelativePath: string): Promise<void> {
    await copyToStagedFile(this.context, sourcePath, stagedRelativePath);
  }

  async commit(stagedRelativePath: string, canonicalRelativePath: string): Promise<void> {
    await commitStagedFile(this.context, stagedRelativePath, canonicalRelativePath);
  }

  async replace(stagedRelativePath: string, canonicalRelativePath: string): Promise<void> {
    await replaceWithStagedFile(this.context, stagedRelativePath, canonicalRelativePath);
  }

  async absolutePath(relativePath: string): Promise<string> {
    return (await resolveExistingVaultPath(this.context, relativePath)).absolutePath;
  }

  async remove(relativePath: string): Promise<boolean> {
    return removeVaultFile(this.context, relativePath);
  }
}
