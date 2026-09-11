import { NextRequest } from 'next/server';

import { EasyScholarError, fetchEasyScholarLabels } from '@/lib/easyscholar/easyscholar-client';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { identifyJournal } from '@/lib/metadata/pdf-metadata';
import { createVaultContext } from '@/lib/storage/vault-path';
import { LumerConfigRepository } from '@/lib/config/lumer-config-repository';
import { apiError, apiSuccess } from '@/lib/http/api-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ paperId: string }> }) {
  try {
    const { paperId } = await context.params;
    const config = await new LumerConfigRepository().read();
    if (!config?.easyscholar_secret_key) throw new EasyScholarError('未配置 EasyScholar SecretKey。', 'NOT_CONFIGURED');
    if (!config.vault_path) throw new EasyScholarError('Vault 尚未配置。', 'REQUEST_FAILED');
    const vault = await createVaultContext(config.vault_path);
    const paper = await new PaperRepository(vault).read(paperId);
    let journal = paper.journal;
    if (!journal || /^REVIEWED BY|^EDITED BY/iu.test(journal)) {
      const extraction = await new ExtractionRepository(vault).read(paperId);
      journal = identifyJournal(null, extraction.pages);
    }
    return apiSuccess({ labels: await fetchEasyScholarLabels(journal ?? '', config.easyscholar_secret_key) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
