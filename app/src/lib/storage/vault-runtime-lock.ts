import { constants as fsConstants, promises as fs } from 'node:fs';

import { flock } from 'fs-ext-extra-prebuilt';

import {
  resolveVaultPathForWrite,
  VaultContext,
} from '@/lib/storage/vault-path';

export type VaultRuntimeLockErrorCode = 'VAULT_ALREADY_OPEN' | 'VAULT_LOCK_FAILED';

export class VaultRuntimeLockError extends Error {
  constructor(
    readonly code: VaultRuntimeLockErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VaultRuntimeLockError';
  }
}

function flockAsync(fd: number, operation: 'exnb' | 'un'): Promise<void> {
  return new Promise((resolve, reject) => {
    flock(fd, operation, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function isLockContention(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EAGAIN' || code === 'EACCES' || code === 'EWOULDBLOCK';
}

export class VaultRuntimeLock {
  private released = false;

  private constructor(
    private readonly handle: Awaited<ReturnType<typeof fs.open>>,
    readonly context: VaultContext,
  ) {}

  static async acquire(context: VaultContext): Promise<VaultRuntimeLock> {
    const lockPath = await resolveVaultPathForWrite(context, '.lumer/runtime.lock');
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;

    try {
      handle = await fs.open(
        lockPath.absolutePath,
        fsConstants.O_CREAT | fsConstants.O_RDWR,
        0o600,
      );
      await flockAsync(handle.fd, 'exnb');
      return new VaultRuntimeLock(handle, context);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (isLockContention(error)) {
        throw new VaultRuntimeLockError(
          'VAULT_ALREADY_OPEN',
          '目标 Vault 已由另一个 Lumer 进程持有。',
          error,
        );
      }
      throw new VaultRuntimeLockError('VAULT_LOCK_FAILED', '无法取得 Vault 运行锁。', error);
    }
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    try {
      await flockAsync(this.handle.fd, 'un').catch(() => undefined);
    } finally {
      await this.handle.close().catch(() => undefined);
    }
  }
}
