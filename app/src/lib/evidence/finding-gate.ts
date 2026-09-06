import { AnalysisRun, EvidenceGate, PaperAnalysis } from '@/domain/analysis-run';

function gateForAnalysis(analysis: PaperAnalysis, contentHash: string, checkedAt: string): EvidenceGate {
  const findingResults = analysis.findings.map((finding) => {
    const reasons: EvidenceGate['finding_results'][number]['reasons'] = [];
    if (finding.evidence.length === 0 || !finding.evidence.some((evidence) => evidence.verification_status === 'verified')) {
      reasons.push('no_verified_evidence');
    }
    if (finding.evidence.some((evidence) => evidence.verification_status !== 'verified')) {
      reasons.push('unverified_evidence');
    }
    if (finding.evidence.some((evidence) => evidence.content_hash !== contentHash)) {
      reasons.push('content_hash_mismatch');
    }
    return { finding_id: finding.finding_id, status: reasons.length === 0 ? 'passed' as const : 'failed' as const, reasons };
  });
  if (findingResults.length === 0) {
    return {
      status: 'failed',
      content_hash: contentHash,
      checked_at: checkedAt,
      finding_results: [{ finding_id: '00000000-0000-4000-8000-000000000000', status: 'failed', reasons: ['missing_finding'] }],
    };
  }
  return {
    status: findingResults.every((result) => result.status === 'passed') ? 'passed' : 'failed',
    content_hash: contentHash,
    checked_at: checkedAt,
    finding_results: findingResults,
  };
}

export function evaluateEvidenceGate(run: AnalysisRun, checkedAt = new Date().toISOString()): EvidenceGate {
  if (run.paper_analysis === null) {
    return {
      status: 'failed',
      content_hash: run.content_hash,
      checked_at: checkedAt,
      finding_results: [{ finding_id: '00000000-0000-4000-8000-000000000000', status: 'failed', reasons: ['missing_finding'] }],
    };
  }
  return gateForAnalysis(run.paper_analysis, run.content_hash, checkedAt);
}
