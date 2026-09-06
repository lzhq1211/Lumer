import { analyzeCoordinator } from '@/application/analyze-coordinator';
import { getConfiguredVaultAccess } from '@/application/vault-access';
import { apiError, apiSuccess } from '@/lib/http/api-response';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { context } = await getConfiguredVaultAccess();
    return apiSuccess(await analyzeCoordinator.getActiveRun(new AnalysisRunRepository(context)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) { return apiError(error); }
}
