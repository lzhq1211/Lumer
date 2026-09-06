import os from 'node:os';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const e2eRoot = process.env.LUMER_E2E_ROOT ?? path.join(os.tmpdir(), 'lumer-assistant-e2e');
const e2ePort = Number(process.env.LUMER_E2E_PORT ?? '3000');

process.env.LUMER_E2E_ROOT = e2eRoot;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx next build --webpack && npm run start',
    env: {
      ...process.env,
      PORT: String(e2ePort),
      LUMER_CONFIG_DIR: path.join(e2eRoot, 'config'),
      LUMER_ANALYZE_MODE: process.env.LUMER_ANALYZE_MODE ?? 'fixture',
    },
    port: e2ePort,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
