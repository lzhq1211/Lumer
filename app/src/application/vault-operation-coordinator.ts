import path from 'node:path';

import { LumerConfigRepository } from '@/lib/config/lumer-config-repository';
import {
  VaultRuntimeLock,
  VaultRuntimeLockError,
} from '@/lib/storage/vault-runtime-lock';
import {
  createVaultContext,
  initializeVaultLayout,
  VaultContext,
  VaultPathError,
} from '@/lib/storage/vault-path';

export const VAULT_MUTATION_KINDS = [
  'import',
  'metadata',
  'annotation',
  'chat',
  'analyze',
  'finalize',
  'markdown_sync',
  'delete',
] as const;

export type VaultMutationKind = (typeof VAULT_MUTATION_KINDS)[number];
export type VaultOperationCoordinatorErrorCode =
  | 'VAULT_NOT_CONFIGURED'
  | 'VAULT_BUSY'
  | 'VAULT_ALREADY_OPEN'
  | 'VAULT_UNAVAILABLE';

export class VaultOperationCoordinatorError extends Error {
  constructor(
    readonly code: VaultOperationCoordinatorErrorCode,
    message: string,
    readonly activeOperationKinds: VaultMutationKind[] = [],
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VaultOperationCoordinatorError';
  }
}

interface ActiveVault {
  readonly context: VaultContext;
  readonly lock: VaultRuntimeLock;
}

function mapVaultSetupError(error: unknown): VaultOperationCoordinatorError {
  if (error instanceof VaultOperationCoordinatorError) return error;
  if (error instanceof VaultRuntimeLockError && error.code === 'VAULT_ALREADY_OPEN') {
    return new VaultOperationCoordinatorError(
      'VAULT_ALREADY_OPEN',
      error.message,
      [],
      error,
    );
  }
  if (error instanceof VaultRuntimeLockError || error instanceof VaultPathError) {
    return new VaultOperationCoordinatorError(
      'VAULT_UNAVAILABLE',
      'Vault 业务存储无法安全初始化。',
      [],
      error,
    );
  }
  return new VaultOperationCoordinatorError(
    'VAULT_UNAVAILABLE',
    'Vault 切换无法完成。',
    [],
    error,
  );
}

export class VaultOperationCoordinator {
  private activeVault: ActiveVault | null = null;
  private readonly activeMutations = new Map<VaultMutationKind, number>();
  private switching = false;

  get context(): VaultContext | null {
    return this.activeVault?.context ?? null;
  }

  get activeOperationKinds(): VaultMutationKind[] {
    return [...this.activeMutations.keys()].sort();
  }

  async bootstrap(vaultPath: string): Promise<VaultContext> {
    if (this.activeVault) {
      const requested = await createVaultContext(vaultPath, this.activeVault.context.generation);
      if (requested.rootPath !== this.activeVault.context.rootPath) {
        throw new VaultOperationCoordinatorError(
          'VAULT_UNAVAILABLE',
          '当前进程已绑定另一个 Vault；必须通过 Settings 切换。',
        );
      }
      return this.activeVault.context;
    }

    try {
      const context = await createVaultContext(vaultPath, 1);
      await initializeVaultLayout(context);
      const lock = await VaultRuntimeLock.acquire(context);
      this.activeVault = Object.freeze({ context, lock });
      return context;
    } catch (error) {
      throw mapVaultSetupError(error);
    }
  }

  async runMutation<Result>(
    kind: VaultMutationKind,
    mutation: (context: VaultContext) => Promise<Result>,
  ): Promise<Result> {
    if (this.switching) {
      throw new VaultOperationCoordinatorError('VAULT_BUSY', 'Vault 正在切换。');
    }
    const activeVault = this.activeVault;
    if (!activeVault) {
      throw new VaultOperationCoordinatorError('VAULT_NOT_CONFIGURED', 'Vault 尚未配置。');
    }

    this.activeMutations.set(kind, (this.activeMutations.get(kind) ?? 0) + 1);
    try {
      return await mutation(activeVault.context);
    } finally {
      const remaining = (this.activeMutations.get(kind) ?? 1) - 1;
      if (remaining === 0) this.activeMutations.delete(kind);
      else this.activeMutations.set(kind, remaining);
    }
  }

  async switchVault(
    vaultPath: string,
    persistConfig: () => Promise<void>,
  ): Promise<VaultContext> {
    if (this.switching || this.activeMutations.size > 0) {
      throw new VaultOperationCoordinatorError(
        'VAULT_BUSY',
        '存在进行中的 Vault 操作，当前不能切换。',
        this.activeOperationKinds,
      );
    }

    this.switching = true;
    const previousVault = this.activeVault;
    let candidateLock: VaultRuntimeLock | null = null;
    try {
      const candidateContext = await createVaultContext(
        vaultPath,
        (previousVault?.context.generation ?? 0) + 1,
      );
      await initializeVaultLayout(candidateContext);

      if (previousVault?.context.rootPath === candidateContext.rootPath) {
        await persistConfig();
        this.activeVault = Object.freeze({
          context: candidateContext,
          lock: previousVault.lock,
        });
        return candidateContext;
      }

      candidateLock = await VaultRuntimeLock.acquire(candidateContext);
      await persistConfig();
      this.activeVault = Object.freeze({ context: candidateContext, lock: candidateLock });
      candidateLock = null;
      await previousVault?.lock.release();
      return candidateContext;
    } catch (error) {
      await candidateLock?.release();
      if (
        error instanceof VaultOperationCoordinatorError
        || error instanceof VaultRuntimeLockError
        || error instanceof VaultPathError
      ) {
        throw mapVaultSetupError(error);
      }
      throw error;
    } finally {
      this.switching = false;
    }
  }

  async close(): Promise<void> {
    const activeVault = this.activeVault;
    this.activeVault = null;
    this.activeMutations.clear();
    await activeVault?.lock.release();
  }
}

const coordinatorRegistry = new Map<string, VaultOperationCoordinator>();

export function getVaultOperationCoordinator(
  repository: LumerConfigRepository,
): VaultOperationCoordinator {
  const key = path.resolve(repository.configDirectory);
  let coordinator = coordinatorRegistry.get(key);
  if (!coordinator) {
    coordinator = new VaultOperationCoordinator();
    coordinatorRegistry.set(key, coordinator);
  }
  return coordinator;
}

export async function releaseVaultOperationCoordinator(configDirectory: string): Promise<void> {
  const key = path.resolve(configDirectory);
  const coordinator = coordinatorRegistry.get(key);
  coordinatorRegistry.delete(key);
  await coordinator?.close();
}
