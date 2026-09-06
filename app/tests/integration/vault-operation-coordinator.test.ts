import { spawn, ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  VaultOperationCoordinator,
  VaultOperationCoordinatorError,
} from '@/application/vault-operation-coordinator';
import {
  VaultRuntimeLock,
  VaultRuntimeLockError,
} from '@/lib/storage/vault-runtime-lock';
import {
  createVaultContext,
  initializeVaultLayout,
} from '@/lib/storage/vault-path';

let testRoot = '';
let oldVaultPath = '';
let newVaultPath = '';
let coordinator: VaultOperationCoordinator;
let child: ChildProcess | null = null;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForLine(process: ChildProcess, expected: string): Promise<void> {
  const timeout = setTimeout(() => process.kill('SIGKILL'), 5_000);
  try {
    for await (const chunk of process.stdout!) {
      if (String(chunk).includes(expected)) return;
    }
    throw new Error('lock holder exited before readiness');
  } finally {
    clearTimeout(timeout);
  }
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-vault-coordinator-'));
  oldVaultPath = path.join(testRoot, 'Old Vault');
  newVaultPath = path.join(testRoot, 'New Vault');
  await fs.mkdir(oldVaultPath);
  await fs.mkdir(newVaultPath);
  coordinator = new VaultOperationCoordinator();
});

afterEach(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
  child = null;
  await coordinator.close();
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('Vault runtime lock', () => {
  it('blocks a second process and is released by the OS after a crash', async () => {
    const context = await createVaultContext(oldVaultPath);
    await initializeVaultLayout(context);
    const lockPath = path.join(context.rootPath, '.lumer/runtime.lock');
    child = spawn(process.execPath, [
      path.join(process.cwd(), 'tests/fixtures/runtime-lock-holder.mjs'),
      lockPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    await waitForLine(child, 'LOCKED');

    await expect(VaultRuntimeLock.acquire(context)).rejects.toMatchObject({
      code: 'VAULT_ALREADY_OPEN',
    } satisfies Partial<VaultRuntimeLockError>);

    child.kill('SIGKILL');
    await once(child, 'exit');
    child = null;

    const recoveredLock = await VaultRuntimeLock.acquire(context);
    await recoveredLock.release();
  });
});

describe('VaultOperationCoordinator', () => {
  it('keeps an immutable context for a mutation and rejects switching with VAULT_BUSY', async () => {
    const originalContext = await coordinator.bootstrap(oldVaultPath);
    const started = deferred();
    const finish = deferred();
    const mutation = coordinator.runMutation('analyze', async (context) => {
      expect(context).toBe(originalContext);
      started.resolve();
      await finish.promise;
      expect(context).toBe(originalContext);
    });
    await started.promise;

    let persisted = false;
    await expect(coordinator.switchVault(newVaultPath, async () => {
      persisted = true;
    })).rejects.toMatchObject({
      code: 'VAULT_BUSY',
      activeOperationKinds: ['analyze'],
    } satisfies Partial<VaultOperationCoordinatorError>);
    expect(persisted).toBe(false);
    expect(coordinator.context).toBe(originalContext);

    finish.resolve();
    await mutation;
  });

  it('keeps old context/lock and releases the candidate lock when config persistence fails', async () => {
    const originalContext = await coordinator.bootstrap(oldVaultPath);

    await expect(coordinator.switchVault(newVaultPath, async () => {
      throw new Error('CONFIG_WRITE_FAILED');
    })).rejects.toThrow('CONFIG_WRITE_FAILED');
    expect(coordinator.context).toBe(originalContext);

    const candidateContext = await createVaultContext(newVaultPath);
    const candidateLock = await VaultRuntimeLock.acquire(candidateContext);
    await candidateLock.release();

    await expect(VaultRuntimeLock.acquire(originalContext)).rejects.toMatchObject({
      code: 'VAULT_ALREADY_OPEN',
    } satisfies Partial<VaultRuntimeLockError>);
  });

  it('holds the candidate lock during config persistence and releases the old lock after publish', async () => {
    const originalContext = await coordinator.bootstrap(oldVaultPath);
    const candidateContext = await createVaultContext(newVaultPath);
    await initializeVaultLayout(candidateContext);

    const published = await coordinator.switchVault(newVaultPath, async () => {
      await expect(VaultRuntimeLock.acquire(candidateContext)).rejects.toMatchObject({
        code: 'VAULT_ALREADY_OPEN',
      } satisfies Partial<VaultRuntimeLockError>);
      expect(coordinator.context).toBe(originalContext);
    });

    expect(coordinator.context).toBe(published);
    expect(published.rootPath).toBe(await fs.realpath(newVaultPath));
    expect(published.generation).toBe(2);
    const releasedOldLock = await VaultRuntimeLock.acquire(originalContext);
    await releasedOldLock.release();
  });
});
