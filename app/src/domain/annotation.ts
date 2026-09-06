import { z } from 'zod';

import { addIssue, NonEmptyStringSchema, RevisionSchema } from '@/domain/storage-types';
import type { PaperRecord } from '@/domain/paper';

const NormalizedCoordinateSchema = z.number().finite().min(0).max(1);

export const AnnotationRectSchema = z.strictObject({
  x: NormalizedCoordinateSchema,
  y: NormalizedCoordinateSchema,
  width: NormalizedCoordinateSchema.refine((value) => value > 0, 'width 必须大于 0。'),
  height: NormalizedCoordinateSchema.refine((value) => value > 0, 'height 必须大于 0。'),
}).superRefine((value, context) => {
  if (value.x + value.width > 1) {
    addIssue(context, ['width'], 'x + width 不得超过 1。');
  }
  if (value.y + value.height > 1) {
    addIssue(context, ['height'], 'y + height 不得超过 1。');
  }
});

export const AnnotationTypeSchema = z.enum(['important', 'unknown']);

export const PdfAnnotationSchema = z.strictObject({
  annotation_id: NonEmptyStringSchema,
  pdf_page_index: z.number().int().min(0),
  display_page_number: z.number().int().min(1),
  type: AnnotationTypeSchema,
  text: z.string().trim().min(1),
  note: z.string(),
  rects: z.array(AnnotationRectSchema).min(1),
}).superRefine((value, context) => {
  if (value.display_page_number !== value.pdf_page_index + 1) {
    addIssue(context, ['display_page_number'], '显示页码必须等于物理页索引加 1。');
  }
});

export const CreateAnnotationRequestSchema = z.strictObject({
  expected_record_revision: RevisionSchema,
  pdf_page_index: z.number().int().min(0),
  type: AnnotationTypeSchema,
  text: z.string().trim().min(1),
  note: z.string(),
  rects: z.array(AnnotationRectSchema).min(1),
});

export const UpdateAnnotationRequestSchema = z.strictObject({
  expected_record_revision: RevisionSchema,
  type: AnnotationTypeSchema.optional(),
  text: z.string().trim().min(1).optional(),
  note: z.string().optional(),
}).superRefine((value, context) => {
  if (Object.keys(value).length === 1) {
    addIssue(context, [], '至少提供一个要更新的 Annotation 字段。');
  }
});

export const DeleteAnnotationRequestSchema = z.strictObject({
  expected_record_revision: RevisionSchema,
});

export type AnnotationRect = z.infer<typeof AnnotationRectSchema>;
export type AnnotationType = z.infer<typeof AnnotationTypeSchema>;
export type PdfAnnotation = z.infer<typeof PdfAnnotationSchema>;
export type CreateAnnotationRequest = z.infer<typeof CreateAnnotationRequestSchema>;
export type UpdateAnnotationRequest = z.infer<typeof UpdateAnnotationRequestSchema>;
export type DeleteAnnotationRequest = z.infer<typeof DeleteAnnotationRequestSchema>;

export interface AnnotationMutationResult {
  readonly annotation: PdfAnnotation | null;
  readonly deleted: boolean;
  readonly paper: PaperRecord;
}
