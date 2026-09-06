import { z } from 'zod';

import {
  AcceptMetadataCandidateRequestSchema,
  PaperDetail,
  PaperListQuery,
  PaperMetadataPatch,
  PaperMetadataPatchSchema,
  PaperStatusSchema,
  LatestAnalysisSummary,
  PaperSummary,
} from '@/domain/paper-library';
import type { AnalysisRun } from '@/domain/analysis-run';
import type { PaperRecord } from '@/domain/paper';
import { UuidSchema } from '@/domain/storage-types';
import {
  paperMutationCoordinator,
  PaperMutationCoordinator,
} from '@/application/paper-mutation-coordinator';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { VaultContext } from '@/lib/storage/vault-path';

export type PaperLibraryErrorCode =
  | 'REQUEST_INVALID'
  | 'PAPER_NOT_FOUND'
  | 'PAPER_RECORD_REVISION_CONFLICT'
  | 'RUN_NOT_FOUND'
  | 'RUN_STATE_INVALID'
  | 'DRAFT_REVISION_CONFLICT'
  | 'METADATA_CANDIDATE_EMPTY'
  | 'DATA_INTEGRITY_ERROR';

export class PaperLibraryServiceError extends Error {
  constructor(
    readonly code: PaperLibraryErrorCode,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly details: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = 'PaperLibraryServiceError';
  }
}

function invalidRequest(error: z.ZodError): PaperLibraryServiceError {
  return new PaperLibraryServiceError(
    'REQUEST_INVALID',
    '请求字段不符合 Paper Metadata 合同。',
    400,
    false,
    {
      fields: [...new Set(error.issues.map((issue) => String(issue.path[0] ?? 'request')))],
    },
  );
}

function parsePaperId(paperId: string): string {
  const result = UuidSchema.safeParse(paperId);
  if (!result.success) throw invalidRequest(result.error);
  return result.data;
}

function matchesSearch(summary: PaperSummary, search: string): boolean {
  const needle = search.toLocaleLowerCase();
  const { paper } = summary;
  return [paper.title, ...paper.authors, paper.doi ?? '']
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

const PRIMARY_ANALYSIS_STATES = ['preview', 'draft', 'finalized'] as const;
type PrimaryAnalysisState = (typeof PRIMARY_ANALYSIS_STATES)[number];

function compareLatestAnalysis(left: AnalysisRun, right: AnalysisRun): number {
  return right.updated_at.localeCompare(left.updated_at)
    || right.analysis_run_id.localeCompare(left.analysis_run_id);
}

function isPrimaryAnalysisState(state: AnalysisRun['state']): state is PrimaryAnalysisState {
  return (PRIMARY_ANALYSIS_STATES as readonly string[]).includes(state);
}

function summarizeLatestAnalysis(run: AnalysisRun): LatestAnalysisSummary {
  return {
    analysis_run_id: run.analysis_run_id,
    state: run.state as LatestAnalysisSummary['state'],
    provider: run.provider,
    model: run.model,
    updated_at: run.updated_at,
  } as const;
}

export function selectLatestAnalysisByPaperId(
  papers: readonly PaperRecord[],
  runs: readonly AnalysisRun[],
): ReadonlyMap<string, LatestAnalysisSummary | null> {
  const runsByPaperId = new Map<string, AnalysisRun[]>();
  for (const run of runs) {
    const paperRuns = runsByPaperId.get(run.paper_id) ?? [];
    paperRuns.push(run);
    runsByPaperId.set(run.paper_id, paperRuns);
  }

  return new Map(papers.map((paper): readonly [string, LatestAnalysisSummary | null] => {
    const paperRuns = runsByPaperId.get(paper.paper_id) ?? [];
    const primaryCandidates = paperRuns.filter((run) => isPrimaryAnalysisState(run.state));
    const candidates = primaryCandidates.length > 0
      ? primaryCandidates
      : paperRuns.filter((run) => (
        run.state === 'finalizing'
        && run.analysis_run_id === paper.current_final_run_id
      ));
    const latest = [...candidates].sort(compareLatestAnalysis)[0];
    return [paper.paper_id, latest ? summarizeLatestAnalysis(latest) : null];
  }));
}

export class PaperLibraryService {
  constructor(
    private readonly coordinator: PaperMutationCoordinator = paperMutationCoordinator,
  ) {}

  async list(context: VaultContext, query: PaperListQuery): Promise<PaperSummary[]> {
    const records = await new PaperRepository(context).list();
    const latestAnalysisByPaperId = selectLatestAnalysisByPaperId(
      records,
      await new AnalysisRunRepository(context).listAll(),
    );
    return records
      .map((paper) => ({
        paper,
        has_current_final: paper.current_final_run_id !== null,
        latest_analysis: latestAnalysisByPaperId.get(paper.paper_id) ?? null,
      }))
      .filter((summary) => query.search === null || matchesSearch(summary, query.search))
      .filter((summary) => query.status === null || summary.paper.status === query.status)
      .filter((summary) => query.tag === null || summary.paper.tags.includes(query.tag))
      .sort((left, right) => (
        right.paper.updated_at.localeCompare(left.paper.updated_at)
        || left.paper.paper_id.localeCompare(right.paper.paper_id)
      ));
  }

  async detail(context: VaultContext, rawPaperId: string): Promise<PaperDetail> {
    const paperId = parsePaperId(rawPaperId);
    const papers = new PaperRepository(context);
    if (!await papers.exists(paperId)) {
      throw new PaperLibraryServiceError(
        'PAPER_NOT_FOUND',
        '未找到该论文。',
        404,
        false,
        { paper_id: paperId },
      );
    }
    const paper = await papers.read(paperId);
    const currentRun = paper.current_final_run_id === null
      ? null
      : await new AnalysisRunRepository(context).findById(paper.current_final_run_id);
    if (currentRun !== null && (currentRun.paper_id !== paperId || !['finalizing', 'finalized'].includes(currentRun.state))) {
      throw new PaperLibraryServiceError('DATA_INTEGRITY_ERROR', '当前 Final 指针与 AnalysisRun 不一致。', 500, false, { object_kind: 'paper_record', paper_id: paperId });
    }
    if (paper.current_final_run_id !== null && currentRun === null) {
      throw new PaperLibraryServiceError('DATA_INTEGRITY_ERROR', '当前 Final 指针找不到对应 AnalysisRun。', 500, false, { object_kind: 'paper_record', paper_id: paperId });
    }
    return {
      paper,
      extraction_available: await new ExtractionRepository(context).exists(paperId),
      current_final: currentRun === null ? null : {
        analysis_run_id: currentRun.analysis_run_id,
        state: currentRun.state as 'finalizing' | 'finalized',
        finalized_at: currentRun.finalized_at,
        provider: currentRun.provider,
        model: currentRun.model,
      },
    };
  }

  async updateMetadata(
    context: VaultContext,
    rawPaperId: string,
    value: unknown,
  ) {
    const paperId = parsePaperId(rawPaperId);
    const parsed = PaperMetadataPatchSchema.safeParse(value);
    if (!parsed.success) throw invalidRequest(parsed.error);

    return this.coordinator.runMutation(paperId, () => this.updateMetadataInMutation(context, paperId, parsed.data));
  }

  async acceptMetadataCandidate(
    context: VaultContext,
    rawRunId: string,
    value: unknown,
  ) {
    const runId = UuidSchema.safeParse(rawRunId);
    const request = AcceptMetadataCandidateRequestSchema.safeParse(value);
    if (!runId.success) {
      throw new PaperLibraryServiceError('REQUEST_INVALID', 'Metadata Candidate 请求不符合合同。', 400, false, {
        fields: ['run_id'],
      });
    }
    if (!request.success) {
      throw new PaperLibraryServiceError('REQUEST_INVALID', 'Metadata Candidate 请求不符合合同。', 400, false, {
        fields: [...new Set(request.error.issues.map((issue) => String(issue.path[0] ?? 'request')))],
      });
    }

    const runs = new AnalysisRunRepository(context);
    const initial = await runs.findById(runId.data);
    if (!initial) {
      throw new PaperLibraryServiceError('RUN_NOT_FOUND', '未找到 AnalysisRun。', 404, false, { run_id: runId.data });
    }

    return this.coordinator.runMutation(initial.paper_id, async () => {
      const run = await runs.read(initial.paper_id, runId.data);
      if (!['draft', 'finalized'].includes(run.state) || run.paper_analysis === null) {
        throw new PaperLibraryServiceError('RUN_STATE_INVALID', '当前 Run 不可接受 Metadata Candidate。', 409, false, {
          run_id: run.analysis_run_id,
          state: run.state,
          action: 'accept_metadata_candidate',
        });
      }
      if (run.draft_revision !== request.data.expected_draft_revision) {
        throw new PaperLibraryServiceError('DRAFT_REVISION_CONFLICT', 'Metadata Candidate 已被更新，请重新载入。', 409, true, {
          expected_revision: request.data.expected_draft_revision,
          actual_revision: run.draft_revision,
        });
      }

      const candidate = metadataCandidateFields(run.paper_analysis.metadata_candidate);
      if (Object.keys(candidate).length === 0) {
        throw new PaperLibraryServiceError('METADATA_CANDIDATE_EMPTY', '当前 Run 没有可接受的 Metadata Candidate。', 422, false, { run_id: run.analysis_run_id });
      }
      return this.updateMetadataInMutation(context, run.paper_id, {
        expected_record_revision: request.data.expected_paper_record_revision,
        ...candidate,
      });
    });
  }

  private async updateMetadataInMutation(
    context: VaultContext,
    paperId: string,
    patchRequest: PaperMetadataPatch,
  ) {
    const papers = new PaperRepository(context);
    if (!await papers.exists(paperId)) {
      throw new PaperLibraryServiceError('PAPER_NOT_FOUND', '未找到该论文。', 404, false, { paper_id: paperId });
    }
    const current = await papers.read(paperId);
    if (current.record_revision !== patchRequest.expected_record_revision) {
      throw new PaperLibraryServiceError('PAPER_RECORD_REVISION_CONFLICT', '论文记录已被其他操作更新，请重新载入。', 409, true, {
        expected_revision: patchRequest.expected_record_revision,
        actual_revision: current.record_revision,
      });
    }

    return papers.replace({
      ...current,
      ...metadataFields(patchRequest),
      record_revision: current.record_revision + 1,
      updated_at: new Date().toISOString(),
    });
  }
}

function metadataFields(patch: PaperMetadataPatch): Omit<PaperMetadataPatch, 'expected_record_revision'> {
  const { expected_record_revision: _expectedRecordRevision, ...fields } = patch;
  void _expectedRecordRevision;
  return fields;
}

function metadataCandidateFields(candidate: { title: string | null; authors: string[]; year: number | null; journal: string | null; doi: string | null }): Omit<PaperMetadataPatch, 'expected_record_revision'> {
  const title = candidate.title?.trim() || null;
  const authors = candidate.authors.map((author) => author.trim()).filter(Boolean);
  const journal = candidate.journal?.trim() || null;
  const doi = candidate.doi?.trim() || null;
  return {
    ...(title === null ? {} : { title }),
    ...(authors.length === 0 ? {} : { authors }),
    ...(candidate.year === null ? {} : { year: candidate.year }),
    ...(journal === null ? {} : { journal }),
    ...(doi === null ? {} : { doi }),
  };
}

export function parsePaperListQuery(searchParams: URLSearchParams): PaperListQuery {
  const allowed = new Set(['search', 'status', 'tag']);
  const unknown = [...searchParams.keys()].filter((key) => !allowed.has(key));
  const duplicate = [...allowed].filter((key) => searchParams.getAll(key).length > 1);
  if (unknown.length > 0 || duplicate.length > 0) {
    throw new PaperLibraryServiceError(
      'REQUEST_INVALID',
      '论文查询包含未知或重复参数。',
      400,
      false,
      { fields: [...unknown, ...duplicate] },
    );
  }

  const rawStatus = searchParams.get('status');
  const status = rawStatus === null ? null : PaperStatusSchema.safeParse(rawStatus);
  if (status !== null && !status.success) throw invalidRequest(status.error);
  const search = searchParams.get('search')?.trim() || null;
  const tag = searchParams.get('tag')?.trim() || null;
  return { search, status: status === null ? null : status.data, tag };
}
