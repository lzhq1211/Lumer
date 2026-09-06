import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

import { VaultRelativePathSchema } from '@/domain/storage-types';

export type VaultPathErrorCode =
  | 'VAULT_ROOT_INVALID'
  | 'VAULT_PATH_INVALID'
  | 'VAULT_PATH_ESCAPE'
  | 'VAULT_SYMLINK_ESCAPE'
  | 'VAULT_PATH_NOT_FOUND';

export class VaultPathError extends Error {
  constructor(
    readonly code: VaultPathErrorCode,
    message: string,
    readonly relativePath: string | null,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VaultPathError';
  }
}

export interface VaultContext {
  readonly rootPath: string;
  readonly generation: number;
}

export interface ResolvedVaultPath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertWithinRoot(context: VaultContext, candidatePath: string, relativePath: string): void {
  if (!isWithinRoot(context.rootPath, candidatePath)) {
    throw new VaultPathError(
      'VAULT_PATH_ESCAPE',
      '路径越过已验证的 Vault 根目录。',
      relativePath,
    );
  }
}

function parseRelativePath(relativePath: string): string {
  const result = VaultRelativePathSchema.safeParse(relativePath);
  if (!result.success) {
    throw new VaultPathError(
      'VAULT_PATH_INVALID',
      'Vault 相对路径不合法。',
      relativePath,
      result.error,
    );
  }
  return result.data;
}

export async function createVaultContext(rootPath: string, generation = 1): Promise<VaultContext> {
  if (!path.isAbsolute(rootPath)) {
    throw new VaultPathError('VAULT_ROOT_INVALID', 'Vault 根目录必须是绝对路径。', null);
  }

  try {
    const canonicalRoot = await fs.realpath(rootPath);
    const stats = await fs.stat(canonicalRoot);
    if (!stats.isDirectory()) {
      throw new VaultPathError('VAULT_ROOT_INVALID', 'Vault 根路径不是目录。', null);
    }
    return Object.freeze({ rootPath: canonicalRoot, generation });
  } catch (error) {
    if (error instanceof VaultPathError) throw error;
    throw new VaultPathError('VAULT_ROOT_INVALID', 'Vault 根目录不可用。', null, error);
  }
}

export async function resolveExistingVaultPath(
  context: VaultContext,
  relativePath: string,
): Promise<ResolvedVaultPath> {
  const validatedPath = parseRelativePath(relativePath);
  const lexicalPath = path.resolve(context.rootPath, ...validatedPath.split('/'));
  assertWithinRoot(context, lexicalPath, validatedPath);

  try {
    const stats = await fs.lstat(lexicalPath);
    if (stats.isSymbolicLink()) {
      throw new VaultPathError(
        'VAULT_SYMLINK_ESCAPE',
        'Vault 路径不得指向 symlink。',
        validatedPath,
      );
    }
    const canonicalPath = await fs.realpath(lexicalPath);
    assertWithinRoot(context, canonicalPath, validatedPath);
    return Object.freeze({ absolutePath: canonicalPath, relativePath: validatedPath });
  } catch (error) {
    if (error instanceof VaultPathError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new VaultPathError(
      code === 'ENOENT' ? 'VAULT_PATH_NOT_FOUND' : 'VAULT_PATH_INVALID',
      code === 'ENOENT' ? 'Vault 路径不存在。' : 'Vault 路径无法安全解析。',
      validatedPath,
      error,
    );
  }
}

export async function resolveVaultPathForWrite(
  context: VaultContext,
  relativePath: string,
): Promise<ResolvedVaultPath> {
  const validatedPath = parseRelativePath(relativePath);
  const lexicalPath = path.resolve(context.rootPath, ...validatedPath.split('/'));
  assertWithinRoot(context, lexicalPath, validatedPath);

  const parentRelativePath = path.posix.dirname(validatedPath);
  let canonicalParent: string;
  if (parentRelativePath === '.') {
    canonicalParent = context.rootPath;
  } else {
    const parent = await resolveExistingVaultPath(context, parentRelativePath);
    const stats = await fs.stat(parent.absolutePath);
    if (!stats.isDirectory()) {
      throw new VaultPathError('VAULT_PATH_INVALID', '目标父路径不是目录。', validatedPath);
    }
    canonicalParent = parent.absolutePath;
  }

  const canonicalCandidate = path.join(canonicalParent, path.posix.basename(validatedPath));
  assertWithinRoot(context, canonicalCandidate, validatedPath);

  try {
    const existing = await fs.lstat(canonicalCandidate);
    if (existing.isSymbolicLink()) {
      throw new VaultPathError(
        'VAULT_SYMLINK_ESCAPE',
        '写入目标不得是 symlink。',
        validatedPath,
      );
    }
  } catch (error) {
    if (error instanceof VaultPathError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new VaultPathError('VAULT_PATH_INVALID', '写入目标无法安全检查。', validatedPath, error);
    }
  }

  return Object.freeze({ absolutePath: canonicalCandidate, relativePath: validatedPath });
}

const VAULT_DIRECTORIES = [
  'Papers',
  'Paper Cards',
  '.lumer',
  '.lumer/papers',
  '.lumer/extractions',
  '.lumer/analyses',
  '.lumer/operations',
  '.lumer/operations/imports',
  '.lumer/operations/annotations',
  '.lumer/sessions',
] as const;

export async function initializeVaultLayout(context: VaultContext): Promise<void> {
  for (const relativePath of VAULT_DIRECTORIES) {
    const candidate = path.resolve(context.rootPath, ...relativePath.split('/'));
    assertWithinRoot(context, candidate, relativePath);
    try {
      const stats = await fs.lstat(candidate);
      if (stats.isSymbolicLink()) {
        throw new VaultPathError(
          'VAULT_SYMLINK_ESCAPE',
          'Vault 布局目录不得是 symlink。',
          relativePath,
        );
      }
      if (!stats.isDirectory()) {
        throw new VaultPathError('VAULT_PATH_INVALID', 'Vault 布局路径不是目录。', relativePath);
      }
    } catch (error) {
      if (error instanceof VaultPathError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new VaultPathError('VAULT_PATH_INVALID', 'Vault 布局目录无法检查。', relativePath, error);
      }
      await fs.mkdir(candidate, { mode: 0o700 });
    }

    const canonicalPath = await fs.realpath(candidate);
    assertWithinRoot(context, canonicalPath, relativePath);
    try {
      await fs.access(canonicalPath, fsConstants.R_OK | fsConstants.W_OK);
    } catch (error) {
      throw new VaultPathError(
        'VAULT_PATH_INVALID',
        'Vault 布局目录不可读写。',
        relativePath,
        error,
      );
    }
  }
}
