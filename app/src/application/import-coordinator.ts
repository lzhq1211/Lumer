export class ImportCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  private async runKeyExclusive<Result>(
    key: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }

  async runExclusive<Result>(key: string, operation: () => Promise<Result>): Promise<Result> {
    return this.runKeyExclusive('import-lifecycle', () => (
      this.runKeyExclusive(`source-sha256:${key}`, operation)
    ));
  }
}

export const importCoordinator = new ImportCoordinator();
