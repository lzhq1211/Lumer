import { z } from 'zod';

import {
  AnnotationOperationSchema,
  ExtractedPaperSchema,
  ImportOperationSchema,
  PaperRecordSchema,
} from '@/domain/paper';
import { AnalysisRunSchema } from '@/domain/analysis-run';
import { ChatSessionStoreSchema } from '@/domain/chat-session';
import { STORAGE_SCHEMA_VERSION } from '@/domain/storage-types';

const storageSchemas = {
  paper_record: PaperRecordSchema,
  extracted_paper: ExtractedPaperSchema,
  import_operation: ImportOperationSchema,
  annotation_operation: AnnotationOperationSchema,
  analysis_run: AnalysisRunSchema,
  chat_session: ChatSessionStoreSchema,
} as const;

export type StorageObjectKind = keyof typeof storageSchemas;
export type StorageObjectByKind = {
  [Kind in StorageObjectKind]: z.infer<(typeof storageSchemas)[Kind]>;
};

export class StorageSchemaError extends Error {
  constructor(
    readonly code: 'SCHEMA_VERSION_UNSUPPORTED' | 'DATA_INTEGRITY_ERROR',
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'StorageSchemaError';
  }
}

function readSchemaVersion(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return (value as Record<string, unknown>).schema_version;
}

function migrateLegacyAnalysisRun(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const run = value as Record<string, unknown>;
  if (typeof run.paper_analysis !== 'object' || run.paper_analysis === null || Array.isArray(run.paper_analysis)) return value;
  const paperAnalysis = { ...(run.paper_analysis as Record<string, unknown>) };
  delete paperAnalysis.author_interpretation;
  delete paperAnalysis.limitations;
  return { ...run, paper_analysis: paperAnalysis };
}

function migrateLegacyChatSession(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const store = value as Record<string, unknown>;
  if (typeof store.sessions !== 'object' || store.sessions === null || Array.isArray(store.sessions)) return value;
  const sessions = store.sessions as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(sessions, 'openai_compatible')) return value;
  return { ...store, sessions: { ...sessions, openai_compatible: null } };
}

export function migrateStorageObject<Kind extends StorageObjectKind>(
  kind: Kind,
  value: unknown,
): StorageObjectByKind[Kind] {
  const schemaVersion = readSchemaVersion(value);
  if (schemaVersion !== STORAGE_SCHEMA_VERSION) {
    throw new StorageSchemaError(
      'SCHEMA_VERSION_UNSUPPORTED',
      '存储对象的 schema_version 不受支持。',
      { schema_version: schemaVersion, supported_versions: [STORAGE_SCHEMA_VERSION] },
    );
  }

  const migrated = kind === 'analysis_run'
    ? migrateLegacyAnalysisRun(value)
    : kind === 'chat_session' ? migrateLegacyChatSession(value) : value;
  const result = storageSchemas[kind].safeParse(migrated);
  if (!result.success) {
    throw new StorageSchemaError(
      'DATA_INTEGRITY_ERROR',
      '存储对象不符合严格 Schema。',
      {
        object_kind: kind,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    );
  }

  return result.data as StorageObjectByKind[Kind];
}
