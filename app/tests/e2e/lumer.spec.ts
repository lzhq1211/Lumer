import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test, type Locator } from '@playwright/test';

const e2eRoot = process.env.LUMER_E2E_ROOT ?? path.join(os.tmpdir(), 'lumer-assistant-e2e');
const configDirectory = path.join(e2eRoot, 'config');
const vaultPath = path.join(e2eRoot, 'Research Vault');
const fixtureDirectory = path.join(e2eRoot, 'fixtures');
const fixturePath = path.join(fixtureDirectory, 'single-column.pdf');
const execFileAsync = promisify(execFile);

async function expectLibraryRowLayout(row: Locator) {
  const actions = row.locator('.lumer-paper-row-actions');
  const controls = actions.locator('a, button');
  await expect(controls).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) await expect(controls.nth(index)).toBeVisible();
  await expect(row).toHaveCSS('min-height', '58px');
  await expect(row).toHaveCSS('gap', '8px');
  await expect(actions).toHaveCSS('width', '292px');

  const metrics = await actions.evaluate((element) => {
    const container = element as HTMLElement;
    const bounds = container.getBoundingClientRect();
    const children = [...container.children].map((child) => {
      const rect = child.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    return {
      clientWidth: container.clientWidth,
      scrollWidth: container.scrollWidth,
      left: bounds.left,
      right: bounds.right,
      children,
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.children.every(({ left, right }) => left >= metrics.left && right <= metrics.right)).toBe(true);
}

test.beforeAll(async () => {
  await fs.mkdir(fixtureDirectory, { recursive: true });
  await execFileAsync(path.join(process.cwd(), '.venv/bin/python3'), [
    path.join(process.cwd(), 'tests/fixtures/create_pdf_fixtures.py'),
    fixtureDirectory,
  ]);
});

test.beforeEach(async () => {
  await fs.rm(configDirectory, { recursive: true, force: true });
  await fs.rm(vaultPath, { recursive: true, force: true });
  await fs.mkdir(path.join(vaultPath, '.obsidian'), { recursive: true });
});

test('implements the frozen App Shell and keeps Tag on the Library route', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/');

  await expect(page).toHaveTitle(/Lumer Assistant/);
  await expect(page.getByRole('heading', { name: '文献库' })).toBeVisible();
  await expect(page.getByText('先连接 Obsidian Vault')).toBeVisible();

  const primaryNavigation = page.getByRole('navigation', { name: '主导航' });
  await expect(primaryNavigation.getByRole('link')).toHaveCount(2);
  await expect(primaryNavigation.getByRole('link', { name: '文献库' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: '设置', exact: true })).toHaveAttribute('href', '/settings');

  await expect(page.locator('.lumer-rail-column')).toHaveCSS('width', '84px');
  await expect(page.locator('.lumer-topbar-row')).toHaveCSS('height', '60px');
  await expect(page.locator('.lumer-topbar')).toHaveCSS('height', '50px');
  await expect(page.locator('.lumer-library-secondary')).toHaveCSS('width', '224px');

  await primaryNavigation.getByRole('link', { name: '标签' }).click();
  await expect(page).toHaveURL(/\?view=tag$/);
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page.getByRole('heading', { name: '标签' })).toBeVisible();
  await expect(primaryNavigation.getByRole('link', { name: '标签' })).toHaveAttribute('aria-current', 'page');
});

test('rejects an invalid Vault and restores atomically saved settings after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/settings');

  const vaultInput = page.getByLabel('Vault 绝对路径');
  await expect(vaultInput).toBeVisible();
  await expect(page.locator('.lumer-settings-column')).toHaveCSS('width', '880px');

  await vaultInput.fill(path.join(e2eRoot, 'missing-vault'));
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('Vault 路径不存在。', { exact: false })).toBeVisible();
  await expect(vaultInput).toHaveValue(path.join(e2eRoot, 'missing-vault'));

  await vaultInput.fill(vaultPath);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('路径已验证，设置已原子保存。')).toBeVisible();

  await page.reload();
  await expect(vaultInput).toHaveValue(await fs.realpath(vaultPath));
  await expect(page.getByText('Vault 已验证')).toBeVisible();
});

test('persists API as the analysis provider and sends the selected provider from Reader', async ({ page }) => {
  await page.route('**/api/providers', async (route) => {
    await route.fulfill({
      json: {
        data: [
          { provider: 'codex', transport: 'cli', configured: true, installed: true, authenticated: true, available: true, detected_model: null, failure_code: null },
          { provider: 'openai_compatible', transport: 'http', configured: true, installed: null, authenticated: true, available: true, detected_model: 'fixture-api-model', failure_code: null },
        ],
      },
    });
  });
  await page.goto('/settings');
  await page.getByLabel('Vault 绝对路径').fill(vaultPath);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('路径已验证，设置已原子保存。')).toBeVisible();

  const analyzeProvider = page.getByLabel('默认论文分析 Provider');
  await analyzeProvider.selectOption('openai_compatible');
  await expect(analyzeProvider).toHaveValue('openai_compatible');
  const chatProvider = page.getByLabel('默认自由对话 Provider');
  await chatProvider.selectOption('openai_compatible');
  await expect(chatProvider).toHaveValue('openai_compatible');
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('设置已保存')).toBeVisible();

  const settingsPayload = await page.request.get('/api/settings').then((response) => response.json()) as { data?: { config?: { default_analyze_provider?: string | null; default_chat_provider?: string | null } } };
  expect(settingsPayload.data?.config?.default_analyze_provider).toBe('openai_compatible');
  expect(settingsPayload.data?.config?.default_chat_provider).toBe('openai_compatible');

  await page.goto('/');
  await page.getByLabel('选择要导入的 PDF').setInputFiles(fixturePath);
  const row = page.getByRole('row').filter({ hasText: 'single-column' });
  await row.getByRole('link', { name: /阅读 single-column/ }).click();
  await expect(page.locator('.react-pdf__Page')).toBeVisible();

  let analysisRequest: Record<string, unknown> | null = null;
  await page.route('**/api/analysis-runs', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    analysisRequest = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: 'data: {"event_id":"fixture-api-event","stage":null,"provider":"openai_compatible","provider_session_id":null,"model":null,"text":null,"analysis_run":null,"error":{"code":"FIXTURE_STOP","message":"fixture"},"type":"failed"}\n\n',
    });
  });

  const card = page.locator('.lumer-reader-analysis-card');
  await expect(card.getByRole('heading')).toHaveCount(0);
  await expect(card.locator('strong')).toHaveText('生成论文概览');
  await expect(card.locator('div > span')).toHaveCount(0);
  await expect(card.getByRole('button', { name: '生成概览' })).toBeEnabled();
  await expect(card.locator('.lumer-analysis-data-warning')).toContainText('API 服务');
  await card.getByRole('button', { name: '生成概览' }).click();
  await expect.poll(() => analysisRequest).toMatchObject({ paper_id: expect.any(String), provider: 'openai_compatible' });
});

test('imports a supported PDF and reports duplicate bytes without a second write', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/settings');
  await page.getByLabel('Vault 绝对路径').fill(vaultPath);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('路径已验证，设置已原子保存。')).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('button', { name: '导入 PDF' })).toBeEnabled();
  await page.getByLabel('选择要导入的 PDF').setInputFiles(fixturePath);
  await expect(page.getByText('导入完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'single-column' })).toBeVisible();
  expect(await fs.readdir(path.join(vaultPath, '.lumer/papers'))).toHaveLength(1);

  await page.getByLabel('选择要导入的 PDF').setInputFiles(fixturePath);
  await expect(page.getByText('已找到相同论文')).toBeVisible();
  await expect(page.getByText('未重复写入。', { exact: false })).toBeVisible();
  expect(await fs.readdir(path.join(vaultPath, '.lumer/papers'))).toHaveLength(1);
});

test('keeps a fixed analysis entry and opens the generated Mock Draft from Library', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/settings');
  await page.getByLabel('Vault 绝对路径').fill(vaultPath);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('路径已验证，设置已原子保存。')).toBeVisible();

  await page.goto('/');
  await page.getByLabel('选择要导入的 PDF').setInputFiles(fixturePath);
  let row = page.getByRole('row').filter({ hasText: 'single-column' });
  const unavailableEntry = row.getByRole('button', { name: /查看解析 single-column/ });
  await expect(unavailableEntry).toBeDisabled();
  await expect(unavailableEntry).toHaveAttribute('title', '尚未生成解析');
  await expect(row.getByRole('link', { name: /阅读 single-column/ })).toBeVisible();
  await expectLibraryRowLayout(row);

  await row.getByRole('link', { name: /阅读 single-column/ }).click();
  await page.getByRole('button', { name: '生成概览' }).click();
  await expect(page).toHaveURL(/\/papers\/[0-9a-f-]+\/analysis\/[0-9a-f-]+$/);
  const analysisUrl = new URL(page.url());
  const analysisRunId = analysisUrl.pathname.split('/').at(-1);
  expect(analysisRunId).toMatch(/^[0-9a-f-]+$/);

  await page.getByRole('link', { name: '文献库', exact: true }).click();
  row = page.getByRole('row').filter({ hasText: 'single-column' });
  const analysisEntry = row.getByRole('link', { name: /查看解析 single-column/ });
  await expectLibraryRowLayout(row);
  await expect(analysisEntry).toHaveAttribute('href', `/papers/${analysisUrl.pathname.split('/')[2]}/analysis/${analysisRunId}`);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  row = page.getByRole('row').filter({ hasText: 'single-column' });
  await expect(page.getByRole('heading', { name: '文献库' })).toBeVisible();
  await expectLibraryRowLayout(row);
  await row.getByRole('link', { name: /查看解析 single-column/ }).click();
  await expect(page).toHaveURL(analysisUrl.href);
  await expect(page.getByRole('heading', { name: 'Draft Paper Card' })).toBeVisible();
});

test('requires one explicit confirmation before permanently deleting the managed paper', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/settings');
  await page.getByLabel('Vault 绝对路径').fill(vaultPath);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('路径已验证，设置已原子保存。')).toBeVisible();

  await page.goto('/');
  await page.getByLabel('选择要导入的 PDF').setInputFiles(fixturePath);
  const row = page.getByRole('row').filter({ hasText: 'single-column' });
  await row.getByRole('button', { name: /删除 single-column/ }).click();
  const dialog = page.getByRole('dialog', { name: '永久删除这篇论文？' });
  await expect(dialog).toContainText('没有废纸篓、撤销或恢复');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: /删除 single-column/ }).click();
  await dialog.getByRole('button', { name: '确认永久删除' }).click();
  await expect(page.getByText('还没有论文')).toBeVisible();
  expect(await fs.readdir(path.join(vaultPath, '.lumer/papers'))).toEqual([]);
  expect(await fs.readdir(path.join(vaultPath, '.lumer/extractions'))).toEqual([]);
  expect(await fs.readdir(path.join(vaultPath, 'Papers'))).toEqual([]);
});

test('lists, filters and atomically edits non-destructive Paper Metadata across reload', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/settings');
  await page.getByLabel('Vault 绝对路径').fill(vaultPath);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('路径已验证，设置已原子保存。')).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('button', { name: '导入 PDF' })).toBeEnabled();
  await page.getByLabel('选择要导入的 PDF').setInputFiles(fixturePath);
  const importedRow = page.getByRole('row').filter({ hasText: 'single-column' });
  await expect(importedRow).toBeVisible();
  await importedRow.getByRole('button', { name: /查看或编辑/ }).click();

  const metadataDialog = page.getByRole('dialog', { name: '查看 / 编辑论文' });
  await metadataDialog.getByLabel('标题').fill('Developmental EEG study');
  await metadataDialog.getByLabel('作者（逗号分隔）').fill('Ada Lovelace, Grace Hopper');
  await metadataDialog.getByLabel('年份').fill('2026');
  await metadataDialog.getByLabel('期刊').fill('Nature Communications');
  await metadataDialog.getByLabel('DOI').fill('10.1000/lumer');
  await metadataDialog.getByLabel('标签（逗号分隔）').fill('EEG, Development');
  await metadataDialog.getByLabel('状态').selectOption('read');
  await metadataDialog.getByRole('button', { name: '保存 Metadata' }).click();

  const updatedRow = page.getByRole('row').filter({ hasText: 'Developmental EEG study' });
  await expect(updatedRow).toContainText('Ada Lovelace, Grace Hopper');
  await expect(updatedRow).toContainText('已读');
  await expect(updatedRow).toContainText('EEG');

  await page.getByPlaceholder('搜索标题、作者或 DOI').fill('missing paper');
  await expect(page.getByText('没有符合条件的论文')).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await page.getByRole('button', { name: /已读 1/ }).click();
  await expect(updatedRow).toBeVisible();

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '标签' }).click();
  await expect(page).toHaveURL(/\?view=tag$/);
  await page.getByRole('navigation', { name: '标签' }).getByRole('button', { name: /Development/ }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Developmental EEG study' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'Developmental EEG study' })).toContainText('2026');
  expect(await fs.readdir(path.join(vaultPath, '.lumer/papers'))).toHaveLength(1);
});

test('opens imported single- and two-column PDFs through paper_id Reader routes', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/settings');
  await page.getByLabel('Vault 绝对路径').fill(vaultPath);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('路径已验证，设置已原子保存。')).toBeVisible();

  await page.goto('/');
  await page.getByLabel('选择要导入的 PDF').setInputFiles(fixturePath);
  await expect(page.getByRole('row').filter({ hasText: 'single-column' })).toBeVisible();
  await page.getByLabel('选择要导入的 PDF').setInputFiles(path.join(fixtureDirectory, 'two-column.pdf'));
  await expect(page.getByRole('row').filter({ hasText: 'two-column' })).toBeVisible();

  let chatRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/papers/') && request.url().includes('/chat')) chatRequests += 1;
  });
  await page.getByRole('link', { name: '阅读 single-column' }).click();
  await expect(page).toHaveURL(/\/reader\/[0-9a-f-]+$/);
  await expect(page.getByRole('link', { name: '返回文献库' })).toHaveAttribute('href', '/');
  await expect(page.locator('.lumer-reader-ai-panel')).toHaveCSS('width', '380px');
  await expect(page.locator('.react-pdf__Page')).toBeVisible();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.getByRole('region', { name: '论文自由对话' })).toHaveCount(0);
  expect(chatRequests).toBe(0);
  await expect(page.getByRole('button', { name: '生成概览' })).toBeEnabled();

  await page.getByRole('button', { name: '重要标注' }).click();
  await page.locator('.react-pdf__Page__textContent span').first().evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  const memoField = page.locator('textarea#annotation-memo');
  await expect(memoField).toBeVisible();
  await memoField.fill('浏览器验收 Memo');
  await page.getByRole('button', { name: '保存 Memo' }).click();
  await expect(page.getByText('浏览器验收 Memo')).toBeVisible();
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.locator('textarea#annotation-memo')).toHaveCount(0);

  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('2 / 2')).toBeVisible();
  await expect(page).toHaveURL(/\?page=2$/);
  await page.reload();
  await expect(page.getByText('2 / 2')).toBeVisible();
  await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled();
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page).toHaveURL(/\/reader\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: '放大 PDF' }).click();
  await expect(page.getByText('110%')).toBeVisible();

  await page.goto(`${page.url()}?page=3`);
  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page).toHaveURL(/\/reader\/[0-9a-f-]+$/);

  await page.getByRole('link', { name: '返回文献库' }).click();
  await page.getByRole('link', { name: '阅读 two-column' }).click();
  await expect(page.locator('.react-pdf__Page')).toBeVisible();
  await expect(page.getByText('1 / 2')).toBeVisible();
});

test('completes the fixture Analyze → Draft → Verify → Final → Markdown → restart path', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/settings');
  await page.getByLabel('Vault 绝对路径').fill(vaultPath);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('路径已验证，设置已原子保存。')).toBeVisible();

  await page.goto('/');
  await page.getByLabel('选择要导入的 PDF').setInputFiles(fixturePath);
  await page.getByRole('link', { name: '阅读 single-column' }).click();
  await expect(page.getByRole('button', { name: '生成概览' })).toBeEnabled();
  await page.getByRole('button', { name: '生成概览' }).click();
  await expect(page).toHaveURL(/\/papers\/[0-9a-f-]+\/analysis\/[0-9a-f-]+$/);
  const paperCard = page.getByRole('region', { name: 'Paper Card' });
  await expect(paperCard.getByRole('heading', { name: 'Draft Paper Card' })).toBeVisible();
  await expect(paperCard.getByRole('heading', { name: '作者解释' })).toHaveCount(0);
  await expect(paperCard.getByRole('heading', { name: '局限性' })).toHaveCount(0);
  await expect(paperCard.locator('.lumer-status-badge')).toHaveText('待验证 Evidence');
  await expect(paperCard.getByRole('region', { name: 'Metadata Candidate' })).toContainText('single-column（Mock 候选）');
  await paperCard.getByRole('button', { name: '接受候选并更新 Metadata' }).click();
  await expect(paperCard.getByRole('status')).toContainText('Metadata Candidate 已接受并更新论文记录。');

  await page.getByLabel('研究背景 1').fill('已由浏览器 happy-path 编辑并保存的 Draft。');
  await page.getByLabel('Finding 1').fill('已由浏览器编辑并保留可定位 Evidence 的核心发现。');
  await page.getByLabel('Evidence quote 1').fill('Alpha beta gamma delta.');
  await page.getByRole('button', { name: '保存 Draft' }).click();
  await expect(paperCard.getByRole('status')).toContainText('Draft 已保存；受影响的 Evidence 已回到待验证状态。');
  await page.getByRole('button', { name: '验证证据' }).click();
  await expect(paperCard.getByRole('status')).toContainText('Evidence 已验证，Gate 已通过。');
  const evidenceReturn = page.getByRole('link', { name: '回到原文' });
  await expect(evidenceReturn).toHaveAttribute('href', /\/reader\/[0-9a-f-]+\?page=1$/);
  await evidenceReturn.click();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await page.goBack();
  await expect(paperCard.getByRole('heading', { name: 'Draft Paper Card' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存为最终版' })).toBeVisible();
  await page.getByRole('button', { name: '保存为最终版' }).click();
  await expect(paperCard.getByRole('status')).toContainText('Final 已安全保存，Paper Card Markdown 已生成。');
  await expect(paperCard.getByRole('heading', { name: '最终版 Paper Card' })).toBeVisible();
  await expect(paperCard.getByRole('button', { name: '复制为新草稿' })).toBeVisible();
  await expect(page.locator('.lumer-evidence-panel')).toHaveCSS('width', '420px');

  await page.reload();
  await expect(page.getByRole('heading', { name: '最终版 Paper Card' })).toBeVisible();
  await expect(page.locator('.lumer-analysis-history').getByRole('link', { name: /Final/ })).toBeVisible();
  const readerLink = page.getByRole('link', { name: '返回阅读器' });
  await expect(readerLink).toBeVisible();
  const chatPostProviders: string[] = [];
  await page.route('**/api/papers/*/chat*', async (route) => {
    if (route.request().method() === 'GET') {
      const provider = new URL(route.request().url()).searchParams.get('provider');
      await route.fulfill({ json: { data: provider === 'openai_compatible' ? { messages: [{ role: 'assistant', content: 'API 历史' }] } : null } });
      return;
    }
    const body = route.request().postDataJSON() as { message: string; provider: string };
    chatPostProviders.push(body.provider);
    if (body.provider === 'openai_compatible' && body.message === '触发 HTTP 错误') {
      await route.fulfill({ status: 502, json: { error: { code: 'CHAT_PROVIDER_UNAVAILABLE', message: 'API Provider 暂不可用。' } } });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: `data: {"type":"completed","provider":"${body.provider}","text":"Mock Chat 回答"}\n\n`,
    });
  });
  await readerLink.click();
  await expect(page.getByRole('link', { name: '查看已生成 Paper Card' })).toBeVisible();
  const chat = page.getByRole('region', { name: '论文自由对话' });
  await expect(chat).toBeVisible();
  await expect(chat.getByPlaceholder('随心输入')).toBeVisible();
  await expect(chat.getByRole('button', { name: '发送到 Codex' })).toBeDisabled();
  await chat.getByPlaceholder('随心输入').fill('请解释这个结果');
  await chat.getByPlaceholder('随心输入').press('Control+Enter');
  await expect(chat.getByText('Mock Chat 回答')).toBeVisible();
  await chat.getByLabel('Chat Provider').selectOption('openai_compatible');
  await expect(chat.getByText('API 历史')).toBeVisible();
  await expect(chat.getByLabel('向 API 提问')).toBeVisible();
  await chat.getByLabel('向 API 提问').fill('触发 HTTP 错误');
  await chat.getByLabel('向 API 提问').press('Control+Enter');
  await expect(chat.getByRole('alert')).toContainText('API Provider 暂不可用。');
  await expect(chat.getByLabel('向 API 提问')).toHaveValue('触发 HTTP 错误');
  expect(chatPostProviders).toEqual(['codex', 'openai_compatible']);
  await page.getByRole('link', { name: '查看已生成 Paper Card' }).click();
  await expect(page.getByRole('heading', { name: '最终版 Paper Card' })).toBeVisible();
  await page.getByRole('link', { name: '返回阅读器' }).click();
  await page.getByRole('link', { name: '返回文献库' }).click();
  await expect(page.getByRole('link', { name: /查看解析 single-column/ })).toBeVisible();
  const cards = await fs.readdir(path.join(vaultPath, 'Paper Cards'));
  expect(cards).toHaveLength(1);
  await expect(fs.readFile(path.join(vaultPath, 'Paper Cards', cards[0]), 'utf8')).resolves.toContain('Alpha beta gamma delta.');
});

test('keeps the previous Final stable while re-analyzing and preserves both runs in History', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/settings');
  await page.getByLabel('Vault 绝对路径').fill(vaultPath);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('路径已验证，设置已原子保存。')).toBeVisible();

  await page.goto('/');
  await page.getByLabel('选择要导入的 PDF').setInputFiles(fixturePath);
  await page.getByRole('link', { name: '阅读 single-column' }).click();
  await page.getByRole('button', { name: '生成概览' }).click();
  await expect(page).toHaveURL(/\/papers\/[0-9a-f-]+\/analysis\/[0-9a-f-]+$/);
  const firstMatch = new URL(page.url()).pathname.match(/^\/papers\/([0-9a-f-]+)\/analysis\/([0-9a-f-]+)$/);
  expect(firstMatch).not.toBeNull();
  const [, paperId, firstRunId] = firstMatch!;
  const firstCard = page.getByRole('region', { name: 'Paper Card' });
  await firstCard.getByLabel('Finding 1').fill('第一版 Final');
  await firstCard.getByRole('button', { name: '保存 Draft' }).click();
  await expect(firstCard.getByRole('status')).toContainText('Draft 已保存');
  await page.getByRole('button', { name: '验证证据' }).click();
  await expect(firstCard.getByRole('status')).toContainText('Gate 已通过');
  await page.getByRole('button', { name: '保存为最终版' }).click();
  await expect(firstCard.getByRole('status')).toContainText('Final 已安全保存');
  const firstPaper = await page.request.get(`/api/papers/${paperId}`);
  expect(firstPaper.ok()).toBeTruthy();
  expect((await firstPaper.json()).data.paper.current_final_run_id).toBe(firstRunId);

  await page.goto(`/reader/${paperId}`);
  await expect(page.getByRole('button', { name: '重新生成概览' })).toBeVisible();
  await page.getByRole('button', { name: '重新生成概览' }).click();
  await expect(page).toHaveURL(/\/papers\/[0-9a-f-]+\/analysis\/[0-9a-f-]+$/);
  const secondMatch = new URL(page.url()).pathname.match(/^\/papers\/([0-9a-f-]+)\/analysis\/([0-9a-f-]+)$/);
  expect(secondMatch).not.toBeNull();
  const [, secondPaperId, secondRunId] = secondMatch!;
  expect(secondPaperId).toBe(paperId);
  expect(secondRunId).not.toBe(firstRunId);
  const beforeSecondFinal = await page.request.get(`/api/papers/${paperId}`);
  expect((await beforeSecondFinal.json()).data.paper.current_final_run_id).toBe(firstRunId);

  const secondCard = page.getByRole('region', { name: 'Paper Card' });
  await secondCard.getByLabel('Finding 1').fill('第二版 Final');
  await secondCard.getByRole('button', { name: '保存 Draft' }).click();
  await page.getByRole('button', { name: '验证证据' }).click();
  await expect(secondCard.getByRole('status')).toContainText('Gate 已通过');
  await page.getByRole('button', { name: '保存为最终版' }).click();
  await expect(secondCard.getByRole('status')).toContainText('Final 已安全保存');

  const secondPaper = await page.request.get(`/api/papers/${paperId}`);
  expect((await secondPaper.json()).data.paper.current_final_run_id).toBe(secondRunId);
  const historyResponse = await page.request.get(`/api/analysis-runs?paper_id=${paperId}`);
  const history = (await historyResponse.json()).data as Array<{ analysis_run_id: string; state: string }>;
  expect(history.filter((item) => item.state === 'finalized').map((item) => item.analysis_run_id)).toEqual(expect.arrayContaining([firstRunId, secondRunId]));

  await page.goto(`/papers/${paperId}/analysis/${firstRunId}`);
  await expect(page.getByRole('heading', { name: '最终版 Paper Card' })).toBeVisible();
  await expect(page.getByLabel('Finding 1')).toHaveValue('第一版 Final');
});

test('handles external Markdown conflict with cancel, overwrite and save-as choices', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/settings');
  await page.getByLabel('Vault 绝对路径').fill(vaultPath);
  await page.getByRole('button', { name: '保存设置' }).click();
  await expect(page.getByText('路径已验证，设置已原子保存。')).toBeVisible();
  await page.goto('/');
  await page.getByLabel('选择要导入的 PDF').setInputFiles(fixturePath);
  await page.getByRole('link', { name: '阅读 single-column' }).click();
  await page.getByRole('button', { name: '生成概览' }).click();
  await expect(page).toHaveURL(/\/papers\/[0-9a-f-]+\/analysis\/[0-9a-f-]+$/);
  const firstMatch = new URL(page.url()).pathname.match(/^\/papers\/([0-9a-f-]+)\/analysis\/([0-9a-f-]+)$/);
  expect(firstMatch).not.toBeNull();
  const [, paperId] = firstMatch!;
  const firstCard = page.getByRole('region', { name: 'Paper Card' });
  await firstCard.getByRole('button', { name: '验证证据' }).click();
  await expect(firstCard.getByRole('status')).toContainText('Gate 已通过');
  await page.getByRole('button', { name: '保存为最终版' }).click();
  await expect(firstCard.getByRole('status')).toContainText('Final 已安全保存');

  const firstPaper = await (await page.request.get(`/api/papers/${paperId}`)).json();
  const canonicalPath = firstPaper.data.paper.card_path as string;
  const canonicalFile = path.join(vaultPath, canonicalPath);
  await fs.writeFile(canonicalFile, '# 外部修改-取消后仍保留\n');

  await page.goto(`/reader/${paperId}`);
  await page.getByRole('button', { name: '重新生成概览' }).click();
  await expect(page).toHaveURL(/\/papers\/[0-9a-f-]+\/analysis\/[0-9a-f-]+$/);
  const secondCard = page.getByRole('region', { name: 'Paper Card' });
  await secondCard.getByRole('button', { name: '验证证据' }).click();
  await expect(secondCard.getByRole('status')).toContainText('Gate 已通过');
  await page.getByRole('button', { name: '保存为最终版' }).click();
  const conflictDialog = page.getByRole('dialog');
  await expect(conflictDialog).toBeVisible();
  await conflictDialog.getByRole('button', { name: '取消' }).click();
  await expect(conflictDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存为最终版' })).toBeVisible();
  await expect(fs.readFile(canonicalFile, 'utf8')).resolves.toBe('# 外部修改-取消后仍保留\n');

  await page.getByRole('button', { name: '保存为最终版' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '覆盖' }).click();
  await expect(secondCard.getByRole('status')).toContainText('Final 已安全保存');
  await expect(fs.readFile(canonicalFile, 'utf8')).resolves.not.toBe('# 外部修改-取消后仍保留\n');

  await fs.writeFile(canonicalFile, '# 外部修改-另存前仍保留\n');
  await page.goto(`/reader/${paperId}`);
  await page.getByRole('button', { name: '重新生成概览' }).click();
  await expect(page).toHaveURL(/\/papers\/[0-9a-f-]+\/analysis\/[0-9a-f-]+$/);
  const thirdCard = page.getByRole('region', { name: 'Paper Card' });
  await thirdCard.getByRole('button', { name: '验证证据' }).click();
  await expect(thirdCard.getByRole('status')).toContainText('Gate 已通过');
  await page.getByRole('button', { name: '保存为最终版' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '另存新文件' }).click();
  await expect(thirdCard.getByRole('status')).toContainText('Final 已安全保存');
  await expect(fs.readFile(canonicalFile, 'utf8')).resolves.toBe('# 外部修改-另存前仍保留\n');
  await expect(fs.readdir(path.join(vaultPath, 'Paper Cards'))).resolves.toHaveLength(2);
});

test('blocks layouts narrower than the frozen desktop minimum', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '窗口宽度不足' })).toBeVisible();
  await expect(page.getByText('1200px')).toBeVisible();
  await expect(page.getByText('1280px')).toBeVisible();
});

test('keeps the retired Folder and legacy Session entry points unreachable', async ({ page }) => {
  await page.setViewportSize({ width: 1460, height: 900 });
  await page.goto('/');

  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link')).toHaveCount(2);
  await expect(page.getByText('文件夹', { exact: true })).toHaveCount(0);

  for (const route of [
    '/api/chat',
    '/api/sessions',
    '/api/sessions/export',
    '/api/workspace/folders',
    '/api/workspace/tree',
    '/api/workspace/file?path=Papers/example.pdf',
    '/api/workspace/annotations?path=Papers/example.pdf',
    '/api/workspace/export?path=Papers/example.pdf',
  ]) {
    const response = await page.request.get(route);
    expect(response.status(), route).toBe(404);
  }
});
