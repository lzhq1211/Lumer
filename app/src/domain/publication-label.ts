import { z } from 'zod';

export const PublicationLabelRecordSchema = z.record(z.string(), z.string().trim().min(1));
export type PublicationLabelRecord = z.infer<typeof PublicationLabelRecordSchema>;

export const ZOTERO_STYLE_PUBLICATION_RANK_COLORS = ['#6574D9', '#2AA6A4', '#C59A32'] as const;
export const ZOTERO_STYLE_PUBLICATION_DEFAULT_COLOR = '#86dad1';
