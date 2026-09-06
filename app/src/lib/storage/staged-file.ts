import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { syncDirectory } from '@/lib/storage/atomic-file';
import {
  resolveExistingVaultPath,
  resolveVaultPathForWrite,
  VaultContext,
  VaultPathError,
} from '@/lib/storage/vault-path';

export async function vaultPathExists(context: VaultContext, relativePath: string): Promise<boolean> {
  try {
    await resolveExistingVaultPath(context, relativePath);
    return true;
  } catch (error) {
    if (error instanceof VaultPathError && error.code === 'VAULT_PATH_NOT_FOUND') return false;
    throw error;
  }
}

export async function writeStagedBytes(
  context: VaultContext,
  relativePath: string,
  data: string | Uint8Array,
): Promise<void> {
  const target = await resolveVaultPathForWrite(context, relativePath);
  const handle = await fs.open(target.absolutePath, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(target.absolutePath, { force: true }).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

export async function copyToStagedFile(
  context: VaultContext,
  sourcePath: string,
  relativePath: string,
): Promise<void> {
  const target = await resolveVaultPathForWrite(context, relativePath);
  try {
    await pipeline(
      createReadStream(sourcePath),
      createWriteStream(target.absolutePath, { flags: 'wx', mode: 0o600 }),
    );
    const handle = await fs.open(target.absolutePath, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await fs.rm(target.absolutePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function commitStagedFile(
  context: VaultContext,
  stagedRelativePath: string,
  canonicalRelativePath: string,
): Promise<void> {
  if (await vaultPathExists(context, canonicalRelativePath)) {
    throw new Error('canonical target already exists');
  }
  const staged = await resolveExistingVaultPath(context, stagedRelativePath);
  const canonical = await resolveVaultPathForWrite(context, canonicalRelativePath);
  if (path.dirname(staged.absolutePath) !== path.dirname(canonical.absolutePath)) {
    throw new Error('staged and canonical files must share a directory');
  }
  await fs.rename(staged.absolutePath, canonical.absolutePath);
  await syncDirectory(path.dirname(canonical.absolutePath));
}

export async function replaceWithStagedFile(
  context: VaultContext,
  stagedRelativePath: string,
  canonicalRelativePath: string,
): Promise<void> {
  const staged = await resolveExistingVaultPath(context, stagedRelativePath);
  const canonical = await resolveExistingVaultPath(context, canonicalRelativePath);
  if (path.dirname(staged.absolutePath) !== path.dirname(canonical.absolutePath)) {
    throw new Error('staged and canonical files must share a directory');
  }
  await fs.rename(staged.absolutePath, canonical.absolutePath);
  await syncDirectory(path.dirname(canonical.absolutePath));
}

export async function removeVaultFile(
  context: VaultContext,
  relativePath: string,
): Promise<boolean> {
  let target;
  try {
    target = await resolveExistingVaultPath(context, relativePath);
  } catch (error) {
    if (error instanceof VaultPathError && error.code === 'VAULT_PATH_NOT_FOUND') return false;
    throw error;
  }
  await fs.rm(target.absolutePath);
  await syncDirectory(path.dirname(target.absolutePath));
  return true;
}
