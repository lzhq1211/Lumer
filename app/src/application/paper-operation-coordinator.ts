type LockMode = 'read' | 'write';

interface PendingLock {
  readonly mode: LockMode;
  readonly resolve: (release: () => void) => void;
}

class AsyncReaderWriterLock {
  private activeReaders = 0;
  private activeWriter = false;
  private readonly queue: PendingLock[] = [];

  async acquire(mode: LockMode): Promise<() => void> {
    return new Promise((resolve) => {
      this.queue.push({ mode, resolve });
      this.drain();
    });
  }

  tryAcquireWrite(): (() => void) | null {
    if (this.activeWriter || this.activeReaders > 0 || this.queue.length > 0) return null;
    this.activeWriter = true;
    return () => {
      this.activeWriter = false;
      this.drain();
    };
  }

  private drain(): void {
    if (this.activeWriter || this.queue.length === 0) return;
    const next = this.queue[0];
    if (next.mode === 'write') {
      if (this.activeReaders > 0) return;
      this.queue.shift();
      this.activeWriter = true;
      next.resolve(() => {
        this.activeWriter = false;
        this.drain();
      });
      return;
    }

    while (this.queue[0]?.mode === 'read' && !this.activeWriter) {
      const reader = this.queue.shift();
      if (!reader) return;
      this.activeReaders += 1;
      reader.resolve(() => {
        this.activeReaders -= 1;
        this.drain();
      });
    }
  }
}

export class PaperOperationBusyError extends Error {
  constructor(readonly paperId: string) {
    super('该论文存在进行中的操作。');
    this.name = 'PaperOperationBusyError';
  }
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export class PaperOperationCoordinator {
  private readonly lifecycleLocks = new Map<string, AsyncReaderWriterLock>();
  private readonly recordMutexes = new Map<string, AsyncMutex>();

  private lifecycleLock(paperId: string): AsyncReaderWriterLock {
    let lock = this.lifecycleLocks.get(paperId);
    if (!lock) {
      lock = new AsyncReaderWriterLock();
      this.lifecycleLocks.set(paperId, lock);
    }
    return lock;
  }

  private recordMutex(paperId: string): AsyncMutex {
    let mutex = this.recordMutexes.get(paperId);
    if (!mutex) {
      mutex = new AsyncMutex();
      this.recordMutexes.set(paperId, mutex);
    }
    return mutex;
  }

  async runMutation<Result>(paperId: string, operation: () => Promise<Result>): Promise<Result> {
    const releaseLifecycle = await this.lifecycleLock(paperId).acquire('read');
    try {
      return await this.recordMutex(paperId).runExclusive(operation);
    } finally {
      releaseLifecycle();
    }
  }

  async runLifecycleRead<Result>(paperId: string, operation: () => Promise<Result>): Promise<Result> {
    const release = await this.lifecycleLock(paperId).acquire('read');
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async runDelete<Result>(paperId: string, operation: () => Promise<Result>): Promise<Result> {
    const releaseLifecycle = this.lifecycleLock(paperId).tryAcquireWrite();
    if (!releaseLifecycle) throw new PaperOperationBusyError(paperId);
    try {
      return await this.recordMutex(paperId).runExclusive(operation);
    } finally {
      releaseLifecycle();
    }
  }
}

export const paperOperationCoordinator = new PaperOperationCoordinator();
