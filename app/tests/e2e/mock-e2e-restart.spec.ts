import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const enabled = process.env.LUMER_RESTART_E2E === '1';
const e2eRoot = process.env.LUMER_E2E_ROOT ?? path.join(os.tmpdir(), 'lumer-assistant-e2e');

test.skip(!enabled, '只在已播种固定 Mock 主链状态后执行重启恢复 Smoke。');

test('restores the persisted Mock E2E Paper, Reader, Final, History and Markdown after server restart', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/');

  const row = page.getByRole('row').filter({ hasText: 'single-column（Mock 候选）' });
  await expect(row).toBeVisible();
  await expect(row.getByText('已有', { exact: true })).toBeVisible();

  const settingsResponse = await page.request.get('/api/settings');
  expect(settingsResponse).toBeOK();
  const settingsPayload = await settingsResponse.json() as { data?: { config?: { vault_path?: string } } };
  const vaultPath = settingsPayload.data?.config?.vault_path;
  if (!vaultPath) throw new Error('重启后的 Settings 未返回 Vault 路径。');
  expect(vaultPath).toBe(await fs.realpath(path.join(e2eRoot, 'Research Vault')));

  await row.getByRole('link', { name: /阅读 single-column/ }).click();
  await expect(page.locator('.react-pdf__Page')).toBeVisible();
  await expect(page.getByRole('link', { name: '查看当前 Final' })).toBeVisible();

  await page.getByRole('link', { name: '查看当前 Final' }).click();
  await expect(page.getByRole('heading', { name: '最终版 Paper Card' })).toBeVisible();
  await expect(page.locator('.lumer-analysis-history').getByRole('link', { name: /Final/ })).toHaveCount(1);

  const cards = await fs.readdir(path.join(vaultPath, 'Paper Cards'));
  expect(cards).toHaveLength(1);
  await expect(fs.readFile(path.join(vaultPath, 'Paper Cards', cards[0]), 'utf8')).resolves.toContain('Alpha beta gamma delta.');
});
