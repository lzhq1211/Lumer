import { createHash } from 'node:crypto';

import { isOverviewRun, type AnalysisRun } from '@/domain/analysis-run';
import { renderPaperAnalysisMarkdown } from '@/lib/markdown/paper-analysis-markdown';

export const PAPER_CARD_RENDERER_VERSION = 'paper-card-v2';
export const OVERVIEW_RENDERER_VERSION = 'paper-overview-v1';

function renderPaperCardMarkdown(run: AnalysisRun, requireVerifiedEvidence: boolean): string {
  if (run.paper_analysis === null) throw new Error('PaperAnalysis is required to render a Paper Card.');
  const frontMatter = [
    '---',
    `renderer_version: ${PAPER_CARD_RENDERER_VERSION}`,
    `analysis_run_id: ${run.analysis_run_id}`,
    `provider: ${run.provider}`,
    `model: ${run.model}`,
    '---',
    '',
  ].join('\n');
  return `${frontMatter}${renderPaperAnalysisMarkdown(run.paper_analysis, { requireVerifiedEvidence })}`;
}

export function renderPaperCard(run: AnalysisRun): string {
  if (isOverviewRun(run)) {
    if (!run.raw_model_output?.trim()) throw new Error('Overview text is required.');
    return [
      '---',
      `renderer_version: ${OVERVIEW_RENDERER_VERSION}`,
      'result_kind: overview',
      'confirmation: user',
      'evidence_verified: false',
      `analysis_run_id: ${run.analysis_run_id}`,
      `paper_id: ${run.paper_id}`,
      `provider: ${run.provider}`,
      `model: ${JSON.stringify(run.model)}`,
      `created_at: ${run.created_at}`,
      '---',
      '',
      run.raw_model_output,
    ].join('\n');
  }
  return renderPaperCardMarkdown(run, true);
}

export function renderPaperCardPreview(run: AnalysisRun): string {
  if (run.paper_analysis === null) throw new Error('PaperAnalysis is required to render a Paper Card.');
  return renderPaperAnalysisMarkdown(run.paper_analysis, { includeLegacySections: false });
}

export function markdownHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}
