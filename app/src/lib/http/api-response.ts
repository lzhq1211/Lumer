import { NextResponse } from 'next/server';

import { SettingsServiceError } from '@/application/settings-service';
import { ProviderConfigServiceError } from '@/application/provider-config-service';
import { ImportRecoveryError } from '@/application/import-recovery-service';
import { PaperLibraryServiceError } from '@/application/paper-library-service';
import { PaperLifecycleServiceError } from '@/application/paper-lifecycle-service';
import { PaperOperationBusyError } from '@/application/paper-operation-coordinator';
import { ReaderServiceError } from '@/application/reader-service';
import { AnnotationServiceError } from '@/application/annotation-service';
import { AnnotationRecoveryError } from '@/application/annotation-recovery-service';
import { AnalyzeCoordinatorError } from '@/application/analyze-coordinator';
import { MockAnalysisServiceError } from '@/application/mock-analysis-service';
import { CodexAnalysisServiceError } from '@/application/codex-analysis-service';
import { ChatServiceError } from '@/application/chat-service';
import { PaperChatContextError } from '@/application/paper-chat-context-builder';
import { DraftServiceError } from '@/application/draft-service';
import { FinalizationServiceError } from '@/application/finalization-service';
import { MarkdownSyncServiceError } from '@/application/markdown-sync-service';
import { EvidenceVerificationServiceError } from '@/application/evidence-verification-service';
import { AnalysisRunControlServiceError } from '@/application/analysis-run-control-service';
import { ProviderAvailabilityError } from '@/application/provider-availability';
import { VaultOperationCoordinatorError } from '@/application/vault-operation-coordinator';
import { ProviderTaskContractError } from '@/lib/ai-providers/task-contract';
import { PdfSupportError } from '@/lib/pdf/pdf-support-check';
import { StorageSchemaError } from '@/lib/storage/schema-registry';

export class ApiRequestError extends Error {
  constructor(
    readonly code: 'REQUEST_INVALID' | 'ORIGIN_FORBIDDEN',
    message: string,
    readonly status: 400 | 403,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    stage: null;
    details: Record<string, unknown> | null;
  };
}

export function apiSuccess<T>(data: T, init?: ResponseInit): NextResponse<{ data: T }> {
  return NextResponse.json({ data }, init);
}

export function apiError(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ProviderAvailabilityError) {
    const status = error.code === 'PROVIDER_NOT_CONFIGURED'
      ? 422
      : error.code === 'PROVIDER_NOT_AUTHENTICATED' ? 401 : 503;
    return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.code === 'PROVIDER_UNAVAILABLE', stage: null, details: { provider: error.provider } } }, { status });
  }
  if (error instanceof ProviderTaskContractError) {
    const status = error.code === 'PROVIDER_OUTPUT_INVALID' ? 422 : 502;
    return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.code === 'PROVIDER_PROTOCOL_ERROR', stage: null, details: error.details } }, { status });
  }
  if (error instanceof EvidenceVerificationServiceError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.code === 'DRAFT_REVISION_CONFLICT', stage: null, details: error.details } }, { status: error.status });
  }
  if (error instanceof FinalizationServiceError) return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.code.includes('CONFLICT') || error.code === 'FINAL_COMMIT_FAILED', stage: null, details: error.details } }, { status: error.status });
  if (error instanceof MarkdownSyncServiceError) return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.code.includes('CONFLICT') || error.code === 'MARKDOWN_WRITE_FAILED', stage: null, details: error.details } }, { status: error.status });
  if (error instanceof AnalysisRunControlServiceError) return NextResponse.json({ error: { code: error.code, message: error.message, retryable: false, stage: null, details: error.details } }, { status: error.status });
  if (error instanceof DraftServiceError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.code === 'DRAFT_REVISION_CONFLICT', stage: null, details: error.details } }, { status: error.status });
  }
  if (error instanceof AnalyzeCoordinatorError) {
    return NextResponse.json(
      {
        error: {
          code: 'ANALYZE_ALREADY_ACTIVE',
          message: error.message,
          retryable: true,
          stage: null,
          details: {
            active_run_id: error.activeRun.analysis_run_id,
            active_paper_id: error.activeRun.paper_id,
          },
        },
      },
      { status: 409 },
    );
  }

  if (error instanceof MockAnalysisServiceError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          stage: null,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof CodexAnalysisServiceError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          stage: null,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }
  if (error instanceof PaperChatContextError) return NextResponse.json({ error: { code: error.code, message: error.message, retryable: false, stage: null, details: { limit: error.limit, actual: error.actual } } }, { status: error.status });
  if (error instanceof ChatServiceError) return NextResponse.json({ error: { code: error.code, message: error.message, retryable: error.retryable, stage: null, details: error.details } }, { status: error.status });

  if (error instanceof AnnotationServiceError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          stage: null,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof AnnotationRecoveryError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          stage: null,
          details: { object_kind: 'annotation_operation', paper_id: error.paperId },
        },
      },
      { status: 500 },
    );
  }

  if (error instanceof ReaderServiceError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          stage: null,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof PaperLibraryServiceError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          stage: null,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof PaperLifecycleServiceError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, retryable: error.retryable, stage: null, details: error.details } },
      { status: error.status },
    );
  }

  if (error instanceof PaperOperationBusyError) {
    return NextResponse.json(
      { error: { code: 'PAPER_BUSY', message: error.message, retryable: true, stage: null, details: { paper_id: error.paperId } } },
      { status: 409 },
    );
  }

  if (error instanceof ApiRequestError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          stage: null,
          details: null,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof PdfSupportError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          stage: null,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof ImportRecoveryError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          stage: null,
          details: { object_kind: 'import_operation', paper_id: error.paperId },
        },
      },
      { status: 500 },
    );
  }

  if (error instanceof StorageSchemaError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: false,
          stage: null,
          details: error.code === 'SCHEMA_VERSION_UNSUPPORTED'
            ? error.details
            : { object_kind: error.details.object_kind ?? 'storage_object' },
        },
      },
      { status: error.code === 'SCHEMA_VERSION_UNSUPPORTED' ? 409 : 500 },
    );
  }

  if (error instanceof VaultOperationCoordinatorError) {
    const status = error.code === 'VAULT_NOT_CONFIGURED'
      || error.code === 'VAULT_BUSY'
      || error.code === 'VAULT_ALREADY_OPEN'
      ? 409
      : 503;
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.code !== 'VAULT_NOT_CONFIGURED',
          stage: null,
          details: error.code === 'VAULT_BUSY'
            ? { active_operation_kinds: error.activeOperationKinds }
            : null,
        },
      },
      { status },
    );
  }

  if (error instanceof SettingsServiceError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          stage: null,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }
  if (error instanceof ProviderConfigServiceError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, retryable: error.retryable, stage: null, details: error.details } },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: '内部错误。请重试。',
        retryable: true,
        stage: null,
        details: null,
      },
    },
    { status: 500 },
  );
}
