import { z } from 'zod';

import { paperMutationCoordinator, PaperMutationCoordinator } from '@/application/paper-mutation-coordinator';
import { AnalysisRun } from '@/domain/analysis-run';
import { RevisionSchema } from '@/domain/storage-types';
import { evaluateEvidenceGate } from '@/lib/evidence/finding-gate';
import { locateEvidence } from '@/lib/evidence/locate-quote';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { VaultContext } from '@/lib/storage/vault-path';

export const VerifyEvidenceRequestSchema = z.strictObject({
  expected_draft_revision: RevisionSchema,
});

export class EvidenceVerificationServiceError extends Error {
  constructor(
    readonly code: 'REQUEST_INVALID' | 'RUN_NOT_FOUND' | 'RUN_STATE_INVALID' | 'DRAFT_REVISION_CONFLICT',
    message: string,
    readonly status: 400 | 404 | 409,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EvidenceVerificationServiceError';
  }
}

export class EvidenceVerificationService {
  constructor(private readonly coordinator: PaperMutationCoordinator = paperMutationCoordinator) {}

  async verify(context: VaultContext, runId: string, value: unknown): Promise<AnalysisRun> {
    const request = VerifyEvidenceRequestSchema.safeParse(value);
    if (!request.success) {
      throw new EvidenceVerificationServiceError('REQUEST_INVALID', 'Evidence 验证请求不符合合同。', 400, { run_id: runId });
    }
    const runs = new AnalysisRunRepository(context);
    const source = await runs.findById(runId);
    if (!source) throw new EvidenceVerificationServiceError('RUN_NOT_FOUND', '未找到 AnalysisRun。', 404, { run_id: runId });
    return this.coordinator.runMutation(source.paper_id, async () => {
      const run = await runs.read(source.paper_id, source.analysis_run_id);
      if (run.state !== 'draft' || run.paper_analysis === null) {
        throw new EvidenceVerificationServiceError('RUN_STATE_INVALID', '当前 Run 不可验证 Evidence。', 409, { run_id: runId, state: run.state });
      }
      if (run.draft_revision !== request.data.expected_draft_revision) {
        throw new EvidenceVerificationServiceError('DRAFT_REVISION_CONFLICT', 'Draft 已被更新，请重新载入。', 409, {
          expected_revision: request.data.expected_draft_revision,
          actual_revision: run.draft_revision,
        });
      }
      const extraction = await new ExtractionRepository(context).read(run.paper_id);
      const paperAnalysis = {
        ...run.paper_analysis,
        findings: run.paper_analysis.findings.map((finding) => ({
          ...finding,
          evidence: finding.evidence.map((evidence) => locateEvidence(evidence, extraction)),
        })),
      };
      const next = {
        ...run,
        paper_analysis: paperAnalysis,
        draft_revision: run.draft_revision + 1,
        updated_at: new Date().toISOString(),
      };
      return runs.replace({ ...next, evidence_gate: evaluateEvidenceGate(next) });
    });
  }
}
