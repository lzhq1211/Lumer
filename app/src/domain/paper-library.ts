import { z } from 'zod';

import { PaperRecord } from '@/domain/paper';
import { AnalysisProviderSchema, AnalysisRunStateSchema } from '@/domain/analysis-run';
import { addIssue, hasUniqueValues, RevisionSchema, UuidSchema, VaultRelativePathSchema } from '@/domain/storage-types';

const TrimmedNonEmptyStringSchema = z.string().trim().min(1);
const NullableTrimmedNonEmptyStringSchema = TrimmedNonEmptyStringSchema.nullable();

export const PaperStatusSchema = z.enum(['inbox', 'reading', 'read']);

export const PaperMetadataPatchSchema = z.strictObject({
  expected_record_revision: RevisionSchema,
  title: TrimmedNonEmptyStringSchema.optional(),
  authors: z.array(TrimmedNonEmptyStringSchema).optional(),
  year: z.number().int().nullable().optional(),
  journal: NullableTrimmedNonEmptyStringSchema.optional(),
  doi: NullableTrimmedNonEmptyStringSchema.optional(),
  tags: z.array(TrimmedNonEmptyStringSchema).optional(),
  status: PaperStatusSchema.optional(),
}).superRefine((value, context) => {
  if (Object.keys(value).length === 1) {
    addIssue(context, [], '至少提供一个要更新的 Metadata 字段。');
  }
  if (value.tags && !hasUniqueValues(value.tags)) {
    addIssue(context, ['tags'], '标签不得重复。');
  }
});

export const AcceptMetadataCandidateRequestSchema = z.strictObject({
  expected_draft_revision: RevisionSchema,
  expected_paper_record_revision: RevisionSchema,
});

export const DeletePaperRequestSchema = z.strictObject({
  expected_record_revision: RevisionSchema,
  confirmed_paper_id: UuidSchema,
});

export interface PaperSummary {
  readonly paper: PaperRecord;
  readonly has_current_final: boolean;
  readonly latest_analysis: LatestAnalysisSummary | null;
}

export interface LatestAnalysisSummary {
  readonly analysis_run_id: string;
  readonly state: Extract<z.infer<typeof AnalysisRunStateSchema>, 'preview' | 'draft' | 'finalizing' | 'finalized'>;
  readonly provider: z.infer<typeof AnalysisProviderSchema>;
  readonly model: string;
  readonly updated_at: string;
}

export interface PaperDetail {
  readonly paper: PaperRecord;
  readonly extraction_available: boolean;
  readonly current_final: CurrentFinalSummary | null;
}

export interface CurrentFinalSummary {
  readonly analysis_run_id: string;
  readonly state: Extract<z.infer<typeof AnalysisRunStateSchema>, 'finalizing' | 'finalized'>;
  readonly finalized_at: string | null;
  readonly provider: z.infer<typeof AnalysisProviderSchema>;
  readonly model: string;
}

export interface PaperListQuery {
  readonly search: string | null;
  readonly status: z.infer<typeof PaperStatusSchema> | null;
  readonly tag: string | null;
}

export type PaperMetadataPatch = z.infer<typeof PaperMetadataPatchSchema>;
export type AcceptMetadataCandidateRequest = z.infer<typeof AcceptMetadataCandidateRequestSchema>;
export type DeletePaperRequest = z.infer<typeof DeletePaperRequestSchema>;

export const DeletePaperResultSchema = z.strictObject({
  paper_id: UuidSchema,
  deleted_managed_paths: z.array(VaultRelativePathSchema),
});
export type DeletePaperResult = z.infer<typeof DeletePaperResultSchema>;
