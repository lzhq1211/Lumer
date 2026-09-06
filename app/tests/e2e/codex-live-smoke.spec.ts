import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const enabled = process.env.LUMER_LIVE_CODEX_SMOKE === '1';
const root = process.env.LUMER_E2E_ROOT ?? path.join(os.tmpdir(), 'lumer-codex-live-smoke');
const configDirectory = path.join(root, 'config');
const vaultPath = path.join(root, 'Research Vault');
const fixtureDirectory = path.join(root, 'fixtures');
const fixturePath = path.join(fixtureDirectory, 'live-codex.pdf');
const realPdfPath = process.env.LUMER_LIVE_CODEX_PDF;

test.skip(!enabled, '仅在显式 LUMER_LIVE_CODEX_SMOKE=1 时调用真实 Codex。');

test.beforeAll(async () => {
  await fs.mkdir(fixtureDirectory, { recursive: true });
  if (!realPdfPath || !path.isAbsolute(realPdfPath)) {
    throw new Error('7B 需要通过 LUMER_LIVE_CODEX_PDF 指定真实 PDF 的绝对路径。');
  }
  const sourceStats = await fs.stat(realPdfPath);
  if (!sourceStats.isFile()) {
    throw new Error(`7B 指定的 PDF 不是文件：${realPdfPath}`);
  }
  await fs.copyFile(realPdfPath, fixturePath);
});

test.beforeEach(async () => {
  await fs.rm(configDirectory, { recursive: true, force: true });
  await fs.rm(vaultPath, { recursive: true, force: true });
  await fs.mkdir(path.join(vaultPath, '.obsidian'), { recursive: true });
});

test('真实 Codex 生成简明概览且 Final 前 Chat 被门控', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/settings');
  await page.getByLabel('Vault 绝对路径').fill(vaultPath);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('路径已验证，设置已原子保存。')).toBeVisible();
  await expect(page.getByRole('button', { name: '未接入' })).toBeDisabled();

  await page.goto('/');
  await page.getByLabel('选择要导入的 PDF').setInputFiles(fixturePath);
  await page.getByRole('link', { name: '阅读 live-codex' }).click();
  await page.getByRole('button', { name: '生成概览' }).click();
  await expect(page).toHaveURL(/\/papers\/[0-9a-f-]+\/analysis\/[0-9a-f-]+$/, { timeout: 330_000 });
  await expect(page.getByRole('heading', { name: 'Codex 概览' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Codex 概览正文')).toContainText(/研究问题|样本与方法/);

  const [, paperId, runId] = new URL(page.url()).pathname.match(/^\/papers\/([0-9a-f-]+)\/analysis\/([0-9a-f-]+)$/) ?? [];
  expect(paperId).toBeTruthy();
  expect(runId).toBeTruthy();
  const response = await page.request.get(`/api/analysis-runs/${runId}`);
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { data: { state: string; provider: string; provider_session_id: string | null; prompt_version: string; analysis_schema_version: string; raw_model_output: string | null } };
  expect(payload.data).toMatchObject({
    state: 'preview', provider: 'codex', provider_session_id: expect.any(String),
    prompt_version: 'codex-paper-overview-v3', analysis_schema_version: 'unstructured-text-v1', raw_model_output: expect.any(String),
  });
  const chatResponse = await page.request.get(`/api/papers/${paperId}/chat?provider=codex`);
  expect(chatResponse.status()).toBe(409);
  await expect(chatResponse.json()).resolves.toMatchObject({ error: { code: 'PAPER_CARD_REQUIRED' } });
});
