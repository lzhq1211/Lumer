import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createVaultContext, initializeVaultLayout } from '@/lib/storage/vault-path';

const appRoot = process.cwd();
const temporaryRoots: string[] = [];

async function exists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(appRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('2F Folder domain removal', () => {
  it('keeps retired Folder, Tree, and legacy Session entry points absent', async () => {
    const retiredPaths = [
      'src/app/api/chat/route.ts',
      'src/app/api/sessions/route.ts',
      'src/app/api/sessions/export/route.ts',
      'src/app/api/workspace/folders/route.ts',
      'src/app/api/workspace/tree/route.ts',
      'src/app/api/workspace/file/route.ts',
      'src/app/api/workspace/annotations/route.ts',
      'src/app/api/workspace/export/route.ts',
      'src/components/tree/TreeExplorer.tsx',
      'src/components/tree/TreeItem.tsx',
      'src/components/workspace/ChatPanel.tsx',
      'src/components/workspace/FolderView.tsx',
      'src/lib/lumer-sessions.ts',
      'src/lib/workspace-store.ts',
      'src/lib/workspace-tree.ts',
      'src/lib/pdf-annotations.ts',
      'src/lib/highlight-utils.ts',
    ];

    await expect(Promise.all(retiredPaths.map(exists))).resolves.toEqual(
      retiredPaths.map(() => false),
    );
  });

  it('does not expose Folder storage fields or legacy route references', async () => {
    const productionFiles = [
      'src/lib/ai-providers/index.ts',
      'src/lib/ai-providers/types.ts',
      'src/components/library/LibraryPage.tsx',
      'src/components/layout/GlobalRail.tsx',
    ];
    const source = (await Promise.all(
      productionFiles.map((relativePath) => fs.readFile(path.join(appRoot, relativePath), 'utf8')),
    )).join('\n');

    for (const retiredContract of [
      'folderPath',
      "'folder' | 'pdf'",
      '/api/workspace/folders',
      '/api/workspace/tree',
      '/api/sessions',
      '/api/chat',
      '.lumer/sessions.json',
    ]) {
      expect(source).not.toContain(retiredContract);
    }
  });

  it('initializes only the frozen Repository directories in a real temporary Vault', async () => {
    const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'lumer-2f-vault-'));
    temporaryRoots.push(vaultPath);
    const context = await createVaultContext(vaultPath);

    await initializeVaultLayout(context);

    await expect(fs.readdir(vaultPath).then((entries) => entries.sort())).resolves.toEqual(['.lumer', 'Paper Cards', 'Papers']);
    await expect(fs.readdir(path.join(vaultPath, '.lumer')).then((entries) => entries.sort())).resolves.toEqual([
      'analyses',
      'extractions',
      'operations',
      'papers',
      'sessions',
    ]);
    await expect(fs.readdir(path.join(vaultPath, '.lumer/operations')).then((entries) => entries.sort())).resolves.toEqual([
      'annotations',
      'imports',
    ]);
  });
});
