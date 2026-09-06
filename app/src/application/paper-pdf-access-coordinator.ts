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

export class PaperPdfAccessCoordinator {
  private readonly locks = new Map<string, AsyncReaderWriterLock>();

  async runRead<T>(paperId: string, operation: () => Promise<T>): Promise<T> {
    return this.runLocked(paperId, 'read', operation);
  }

  async runWrite<T>(paperId: string, operation: () => Promise<T>): Promise<T> {
    return this.runLocked(paperId, 'write', operation);
  }

  private async runLocked<T>(
    paperId: string,
    mode: LockMode,
    operation: () => Promise<T>,
  ): Promise<T> {
    let lock = this.locks.get(paperId);
    if (!lock) {
      lock = new AsyncReaderWriterLock();
      this.locks.set(paperId, lock);
    }
    const release = await lock.acquire(mode);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export const paperPdfAccessCoordinator = new PaperPdfAccessCoordinator();
