import { randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  LUMER_CONFIG_SCHEMA_VERSION,
  LumerConfig,
  LumerConfigParseError,
  parseLumerConfig,
} from '@/lib/config/lumer-config';

export function getLumerConfigDirectory(): string {
  return process.env.LUMER_CONFIG_DIR || path.join(os.homedir(), '.lumer');
}

export class LumerConfigRepositoryError extends Error {
  constructor(
    message: string,
    readonly operation: 'read' | 'write',
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LumerConfigRepositoryError';
  }
}

export class LumerConfigRepository {
  readonly configPath: string;

  constructor(readonly configDirectory = getLumerConfigDirectory()) {
    this.configPath = path.join(configDirectory, 'config.json');
  }

  async read(): Promise<LumerConfig | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.configPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new LumerConfigRepositoryError('无法读取本地配置文件。', 'read', error);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new LumerConfigParseError('本地配置文件不是有效 JSON。', 'invalid', error);
    }

    return parseLumerConfig(parsed);
  }

  async write(config: LumerConfig): Promise<void> {
    await fs.mkdir(this.configDirectory, { recursive: true, mode: 0o700 });

    const tempPath = path.join(
      this.configDirectory,
      `.config.json.${process.pid}.${randomUUID()}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;

    try {
      const persistedConfig: LumerConfig = config.schema_version === LUMER_CONFIG_SCHEMA_VERSION
        ? { ...config, openai_compatible: config.openai_compatible ?? null }
        : config;
      handle = await fs.open(tempPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      await handle.writeFile(`${JSON.stringify(persistedConfig, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(tempPath, this.configPath);

      const directoryHandle = await fs.open(this.configDirectory, fsConstants.O_RDONLY);
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw new LumerConfigRepositoryError('无法原子保存本地配置文件。', 'write', error);
    }
  }
}
