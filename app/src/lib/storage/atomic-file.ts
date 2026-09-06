import { randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';

import { ResolvedVaultPath } from '@/lib/storage/vault-path';

export type AtomicWriteFaultPoint = 'after_file_sync' | 'before_rename' | 'after_rename';

export interface AtomicWriteOptions {
  readonly mode?: number;
  readonly injectFault?: (point: AtomicWriteFaultPoint) => void | Promise<void>;
  readonly beforeRename?: () => void | Promise<void>;
}

export class AtomicWriteError extends Error {
  constructor(
    message: string,
    readonly committed: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AtomicWriteError';
  }
}

export async function syncDirectory(directoryPath: string): Promise<void> {
  const directory = await fs.open(directoryPath, fsConstants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function atomicWriteFile(
  target: ResolvedVaultPath,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const directoryPath = path.dirname(target.absolutePath);
  const tempPath = path.join(
    directoryPath,
    `.${path.basename(target.absolutePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  let committed = false;

  try {
    handle = await fs.open(
      tempPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      options.mode ?? 0o600,
    );
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;

    await options.injectFault?.('after_file_sync');
    await options.injectFault?.('before_rename');
    await options.beforeRename?.();
    await fs.rename(tempPath, target.absolutePath);
    committed = true;
    await options.injectFault?.('after_rename');
    await syncDirectory(directoryPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (!committed) await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw new AtomicWriteError(
      committed
        ? '文件已原子替换，但提交后的持久化确认失败。'
        : '文件未能原子写入。',
      committed,
      error,
    );
  }
}

export async function atomicWriteJson(
  target: ResolvedVaultPath,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await atomicWriteFile(target, `${JSON.stringify(value, null, 2)}\n`, options);
}
