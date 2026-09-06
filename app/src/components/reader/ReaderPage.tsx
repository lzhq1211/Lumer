'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  Languages,
  MessageSquareText,
  Minus,
  PenLine,
  Plus,
  Send,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AppShell } from '@/components/layout/AppShell';
import { AlertBanner } from '@/components/ui/AlertBanner';
import type {
  AnnotationRect,
  AnnotationMutationResult,
  AnnotationType,
  PdfAnnotation,
} from '@/domain/annotation';
import type { PaperDetail } from '@/domain/paper-library';
import {
  PageNavigationError,
  pageNavigationFromDisplayPageNumber,
  pageNavigationFromPdfPageIndex,
  parseDisplayPageNumber,
} from '@/lib/pdf/page-navigation';
import { readSseData } from '@/lib/http/sse-client';
import type { AnalyzeProvider, ChatProvider } from '@/types';

const PdfCanvas = dynamic(
  () => import('@/components/reader/PdfCanvas').then((module) => module.PdfCanvas),
  {
    ssr: false,
    loading: () => <div className="lumer-pdf-page-skeleton" aria-label="正在准备 PDF 阅读器" />,
  },
);

interface ReaderPageProps {
  paperId: string;
}

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

interface PaperDetailPayload extends ApiErrorPayload {
  data?: PaperDetail;
}

interface ApiPayload<T> extends ApiErrorPayload {
  data?: T;
}

interface ReaderError {
  readonly code: string;
  readonly message: string;
}

interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

const CHAT_PROVIDERS: ChatProvider[] = ['codex', 'openai_compatible'];

function chatProviderLabel(provider: ChatProvider): string {
  return provider === 'codex' ? 'Codex' : 'API';
}

function providerLabel(provider: AnalyzeProvider): string {
  return provider === 'codex' ? 'Codex' : 'API';
}

interface AnalyzeStreamEvent extends ApiErrorPayload {
  type?: 'stage' | 'completed' | 'failed' | 'cancelled';
  stage?: string | null;
  text?: string | null;
  analysis_run?: { analysis_run_id?: string; paper_id?: string } | null;
}

const MIN_ZOOM = 70;
const MAX_ZOOM = 160;
const ZOOM_STEP = 10;

function readerErrorCopy(error: ReaderError): string {
  if (error.code === 'PDF_REPLACED') {
    return '当前字节与 PaperRecord 中的托管哈希不一致。Lumer 未读取被替换的 PDF，也不会自动创建新论文。';
  }
  if (error.code === 'PDF_MISSING') {
    return '托管 PDF 已缺失。PaperRecord 保持不变，Lumer 不会猜测替代文件。';
  }
  return error.message;
}

function annotationErrorCopy(error: ReaderError): string {
  if (error.code === 'PAPER_RECORD_REVISION_CONFLICT') {
    return '论文记录已更新，已保留当前阅读位置；请重新选择标注后再试。';
  }
  if (error.code === 'PDF_REPLACED') {
    return '托管 PDF 已被外部替换，标注未写入。';
  }
  return error.message;
}

export function ReaderPage({ paperId }: ReaderPageProps) {
  const [detail, setDetail] = useState<PaperDetail | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [error, setError] = useState<ReaderError | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [zoom, setZoom] = useState(100);
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [annotationMode, setAnnotationMode] = useState<AnnotationType | null>(null);
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [annotationError, setAnnotationError] = useState<ReaderError | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<PdfAnnotation | null>(null);
  const [annotationType, setAnnotationType] = useState<AnnotationType>('important');
  const [annotationNote, setAnnotationNote] = useState('');
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState<ReaderError | null>(null);
  const [activeRun, setActiveRun] = useState<{ analysis_run_id: string; paper_id: string; state: 'running' | 'finalizing' } | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<ReaderError | null>(null);
  const [chatProvider, setChatProvider] = useState<ChatProvider>('codex');
  const [chatProviderReady, setChatProviderReady] = useState(false);
  const [chatMessagesByProvider, setChatMessagesByProvider] = useState<Record<ChatProvider, ChatMessage[]>>({ codex: [], openai_compatible: [] });
  const [analyzeProvider, setAnalyzeProvider] = useState<AnalyzeProvider>('codex');
  const objectUrlRef = useRef<string | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const router = useRouter();

  useEffect(() => () => { analysisAbortRef.current?.abort(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setDetail(null);
    setFileUrl(null);
    setPageCount(null);
    setPageNumber(1);
    setAnnotations([]);
    setAnnotationMode(null);
    setAnnotationError(null);
    setSelectedAnnotation(null);
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const detailResponse = await fetch(`/api/papers/${encodeURIComponent(paperId)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const detailPayload = await detailResponse.json() as PaperDetailPayload;
        if (!detailResponse.ok || !detailPayload.data) {
          throw {
            code: detailPayload.error?.code ?? 'INTERNAL_ERROR',
            message: detailPayload.error?.message ?? '论文记录无法读取。',
          } satisfies ReaderError;
        }
        setDetail(detailPayload.data);

        const pdfResponse = await fetch(`/api/papers/${encodeURIComponent(paperId)}/pdf`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!pdfResponse.ok) {
          const pdfPayload = await pdfResponse.json() as ApiErrorPayload;
          throw {
            code: pdfPayload.error?.code ?? 'INTERNAL_ERROR',
            message: pdfPayload.error?.message ?? 'PDF 无法读取。',
          } satisfies ReaderError;
        }
        const nextUrl = URL.createObjectURL(await pdfResponse.blob());
        if (controller.signal.aborted) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = nextUrl;
        setFileUrl(nextUrl);

        const annotationResponse = await fetch(`/api/papers/${encodeURIComponent(paperId)}/annotations`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const annotationPayload = await annotationResponse.json() as ApiPayload<PdfAnnotation[]>;
        if (!annotationResponse.ok || !annotationPayload.data) {
          setAnnotationError({
            code: annotationPayload.error?.code ?? 'INTERNAL_ERROR',
            message: annotationPayload.error?.message ?? 'Annotation 无法读取。',
          });
        } else {
          setAnnotations(annotationPayload.data);
        }
      } catch (reason) {
        if (controller.signal.aborted) return;
        const nextError = reason as Partial<ReaderError>;
        setError({
          code: nextError.code ?? 'INTERNAL_ERROR',
          message: nextError.message ?? '阅读器无法打开该论文。',
        });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => {
      controller.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [paperId]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/settings', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ data?: { config?: { default_analyze_provider?: AnalyzeProvider | null; default_chat_provider?: ChatProvider | null } | null } }> : null)
      .then((payload) => {
        if (!cancelled) {
          setAnalyzeProvider(payload?.data?.config?.default_analyze_provider ?? 'codex');
          setChatProvider(payload?.data?.config?.default_chat_provider ?? 'codex');
          setChatProviderReady(true);
        }
      })
      .catch(() => { if (!cancelled) setChatProviderReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    const loadActive = async () => {
      try {
        const response = await fetch('/api/analysis-runs/active', { cache: 'no-store' });
        const payload = await response.json() as ApiPayload<{ analysis_run_id: string; paper_id: string; state: 'running' | 'finalizing' } | null>;
        if (!disposed && response.ok) setActiveRun(payload.data ?? null);
      } catch { /* 下一次轮询重试。 */ }
    };
    void loadActive();
    const interval = window.setInterval(() => { void loadActive(); }, 1200);
    return () => { disposed = true; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!detail?.current_final || !chatProviderReady) {
      setChatMessagesByProvider({ codex: [], openai_compatible: [] });
      return;
    }
    let cancelled = false;
    setChatError(null);
    void fetch(`/api/papers/${encodeURIComponent(paperId)}/chat?provider=${chatProvider}`, { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ data: { messages: ChatMessage[] } | null }> : null)
      .then((payload) => { if (!cancelled) setChatMessagesByProvider((current) => ({ ...current, [chatProvider]: payload?.data?.messages ?? [] })); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [paperId, chatProvider, chatProviderReady, detail?.current_final]);

  const title = detail?.paper.title ?? '论文阅读器';
  const authors = detail?.paper.authors.length
    ? detail.paper.authors.join(', ')
    : detail?.paper.original_file_name ?? '正在读取论文上下文';
  const readerReady = fileUrl !== null && error === null && pageCount !== null;

  function readerPageHref(displayPageNumber: number): string {
    const url = new URL(window.location.href);
    if (displayPageNumber === 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(displayPageNumber));
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function navigateToDisplayPage(displayPageNumber: number): void {
    if (pageCount === null) return;
    const navigation = pageNavigationFromDisplayPageNumber(displayPageNumber, pageCount);
    window.location.assign(readerPageHref(navigation.display_page_number));
  }

  function restorePageFromUrl(nextPageCount: number): void {
    const requestedPage = parseDisplayPageNumber(new URLSearchParams(window.location.search).get('page'));
    let navigation;
    try {
      navigation = requestedPage === null
        ? pageNavigationFromPdfPageIndex(0, nextPageCount)
        : pageNavigationFromDisplayPageNumber(requestedPage, nextPageCount);
    } catch (reason) {
      if (!(reason instanceof PageNavigationError)) throw reason;
      window.location.replace(readerPageHref(1));
      return;
    }
    setPageNumber(navigation.display_page_number);
  }

  function selectAnnotation(annotation: PdfAnnotation): void {
    setSelectedAnnotation(annotation);
    setAnnotationType(annotation.type);
    setAnnotationNote(annotation.note);
    setAnnotationMode(null);
  }

  function applyMutation(result: AnnotationMutationResult): void {
    setDetail((current) => current ? { ...current, paper: result.paper } : current);
    setAnnotations((current) => {
      if (result.deleted || result.annotation === null) {
        return selectedAnnotation
          ? current.filter((annotation) => annotation.annotation_id !== selectedAnnotation.annotation_id)
          : current;
      }
      const existing = current.some((item) => item.annotation_id === result.annotation!.annotation_id);
      return existing
        ? current.map((item) => item.annotation_id === result.annotation!.annotation_id ? result.annotation! : item)
        : [...current, result.annotation!];
    });
  }

  async function requestAnnotation<T>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as ApiPayload<T>;
    if (!response.ok || !payload.data) {
      throw {
        code: payload.error?.code ?? 'INTERNAL_ERROR',
        message: payload.error?.message ?? 'Annotation 写入失败。',
      } satisfies ReaderError;
    }
    return payload.data;
  }

  async function createAnnotation(selection: { text: string; rects: AnnotationRect[] }): Promise<void> {
    if (!detail || !annotationMode || annotationBusy || pageCount === null) return;
    setAnnotationBusy(true);
    setAnnotationError(null);
    try {
      const result = await requestAnnotation<AnnotationMutationResult>(
        `/api/papers/${encodeURIComponent(paperId)}/annotations`,
        'POST',
        {
          expected_record_revision: detail.paper.record_revision,
          pdf_page_index: pageNavigationFromDisplayPageNumber(pageNumber, pageCount).pdf_page_index,
          type: annotationMode,
          text: selection.text,
          note: '',
          rects: selection.rects,
        },
      );
      applyMutation(result);
      if (result.annotation) selectAnnotation(result.annotation);
      setAnnotationMode(null);
    } catch (reason) {
      const failure = reason as Partial<ReaderError>;
      setAnnotationError({
        code: failure.code ?? 'INTERNAL_ERROR',
        message: failure.message ?? 'Annotation 创建失败。',
      });
    } finally {
      setAnnotationBusy(false);
    }
  }

  async function saveSelectedAnnotation(): Promise<void> {
    if (!detail || !selectedAnnotation || annotationBusy) return;
    setAnnotationBusy(true);
    setAnnotationError(null);
    try {
      const result = await requestAnnotation<AnnotationMutationResult>(
        `/api/papers/${encodeURIComponent(paperId)}/annotations/${encodeURIComponent(selectedAnnotation.annotation_id)}`,
        'PATCH',
        {
          expected_record_revision: detail.paper.record_revision,
          type: annotationType,
          note: annotationNote,
        },
      );
      applyMutation(result);
      if (result.annotation) selectAnnotation(result.annotation);
    } catch (reason) {
      const failure = reason as Partial<ReaderError>;
      setAnnotationError({ code: failure.code ?? 'INTERNAL_ERROR', message: failure.message ?? 'Memo 保存失败。' });
    } finally {
      setAnnotationBusy(false);
    }
  }

  async function deleteSelectedAnnotation(): Promise<void> {
    if (!detail || !selectedAnnotation || annotationBusy) return;
    setAnnotationBusy(true);
    setAnnotationError(null);
    try {
      const result = await requestAnnotation<AnnotationMutationResult>(
        `/api/papers/${encodeURIComponent(paperId)}/annotations/${encodeURIComponent(selectedAnnotation.annotation_id)}`,
        'DELETE',
        { expected_record_revision: detail.paper.record_revision },
      );
      applyMutation(result);
      setSelectedAnnotation(null);
      setAnnotationNote('');
    } catch (reason) {
      const failure = reason as Partial<ReaderError>;
      setAnnotationError({ code: failure.code ?? 'INTERNAL_ERROR', message: failure.message ?? 'Annotation 删除失败。' });
    } finally {
      setAnnotationBusy(false);
    }
  }

  async function startAnalysis(): Promise<void> {
    if (!detail || !detail.extraction_available || analysisBusy || activeRun !== null) return;
    const selectedProvider = analyzeProvider;
    const selectedProviderLabel = providerLabel(selectedProvider);
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setAnalysisBusy(true);
    setAnalysisError(null);
    try {
      const response = await fetch('/api/analysis-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paper_id: paperId, provider: selectedProvider }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json() as ApiErrorPayload;
        throw { code: payload.error?.code ?? 'INTERNAL_ERROR', message: payload.error?.message ?? `${selectedProviderLabel} 概览未能生成。` } satisfies ReaderError;
      }
      const stream = response.body;
      if (!stream) throw { code: 'INTERNAL_ERROR', message: `${selectedProviderLabel} 概览未建立事件流。` } satisfies ReaderError;
      let runId: string | undefined;
      for await (const event of readSseData<AnalyzeStreamEvent>(stream)) {
        if (event.type === 'stage') {
          continue;
        }
        if (event.type === 'failed') {
          if (event.error?.code === 'PROVIDER_PROTOCOL_ERROR' || event.error?.code === 'PROVIDER_OUTPUT_INVALID') {
            const historyResponse = await fetch(`/api/analysis-runs?paper_id=${encodeURIComponent(paperId)}`, { cache: 'no-store' });
            const historyPayload = await historyResponse.json() as ApiPayload<Array<{ analysis_run_id: string; state: string; updated_at: string }>>;
            const failedRun = historyPayload.data
              ?.filter((candidate) => candidate.state === 'failed')
              .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
            if (historyResponse.ok && failedRun) {
              runId = failedRun.analysis_run_id;
              continue;
            }
          }
          throw { code: event.error?.code ?? 'INTERNAL_ERROR', message: event.error?.message ?? `${selectedProviderLabel} 概览未能生成。` } satisfies ReaderError;
        }
        if (event.type === 'cancelled') {
          throw { code: 'ANALYSIS_CANCELLED', message: `${selectedProviderLabel} 概览已取消。` } satisfies ReaderError;
        }
        if (event.type === 'completed') runId = event.analysis_run?.analysis_run_id;
      }
      if (!runId) throw { code: 'INTERNAL_ERROR', message: `${selectedProviderLabel} 概览未返回可见结果。` } satisfies ReaderError;
      router.push(`/papers/${encodeURIComponent(paperId)}/analysis/${encodeURIComponent(runId)}`);
    } catch (reason) {
      if (controller.signal.aborted) return;
      const failure = reason as Partial<ReaderError>;
      setAnalysisError({ code: failure.code ?? 'INTERNAL_ERROR', message: failure.message ?? `${selectedProviderLabel} 概览未能启动。` });
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
      setAnalysisBusy(false);
    }
  }

  async function cancelAnalysis(): Promise<void> {
    if (!activeRun || activeRun.paper_id !== paperId) return;
    setAnalysisError(null);
    try {
      const response = await fetch(`/api/analysis-runs/${encodeURIComponent(activeRun.analysis_run_id)}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const payload = await response.json() as ApiPayload<{ analysis_run_id: string }>;
      if (!response.ok || !payload.data) throw { code: payload.error?.code ?? 'INTERNAL_ERROR', message: payload.error?.message ?? '取消分析失败。' } satisfies ReaderError;
      analysisAbortRef.current?.abort();
      setActiveRun(null);
      router.push(`/papers/${encodeURIComponent(paperId)}/analysis/${encodeURIComponent(payload.data.analysis_run_id)}`);
    } catch (reason) {
      const failure = reason as Partial<ReaderError>;
      setAnalysisError({ code: failure.code ?? 'INTERNAL_ERROR', message: failure.message ?? '取消分析失败。' });
    }
  }

  async function sendChat(): Promise<void> {
    const message = chatInput.trim();
    if (!message || chatBusy) return;
    setChatBusy(true); setChatError(null);
    try {
      const response = await fetch(`/api/papers/${encodeURIComponent(paperId)}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: chatProvider, message, selected_text: null, intent: 'free_chat' }) });
      if (!response.ok) {
        const payload = await response.json() as ApiPayload<never>;
        throw { code: payload.error?.code ?? 'CHAT_FAILED', message: payload.error?.message ?? `${chatProviderLabel(chatProvider)} 自由对话未能完成。` } satisfies ReaderError;
      }
      if (!response.body) throw { code: 'CHAT_FAILED', message: `${chatProviderLabel(chatProvider)} 自由对话未能完成。` } satisfies ReaderError;
      let payload: { type?: string; text?: string; error?: { message?: string } } = {};
      for await (const event of readSseData<typeof payload>(response.body)) payload = event;
      if (payload.type !== 'completed' || !payload.text) throw { code: 'CHAT_FAILED', message: payload.error?.message ?? `${chatProviderLabel(chatProvider)} 自由对话未能完成。` } satisfies ReaderError;
      setChatMessagesByProvider((current) => ({ ...current, [chatProvider]: [...current[chatProvider], { role: 'user', content: message }, { role: 'assistant', content: payload.text! }] }));
      setChatInput('');
    } catch (error) {
      setChatError(error instanceof Error ? { code: 'CHAT_FAILED', message: error.message } : error as ReaderError);
    } finally { setChatBusy(false); }
  }

  const chatMessages = chatMessagesByProvider[chatProvider];

  const controls = (
    <div className="lumer-reader-controls" aria-label="PDF 阅读控件">
      <button aria-label="上一页" className="lumer-icon-button" disabled={!readerReady || pageNumber <= 1} onClick={() => navigateToDisplayPage(pageNumber - 1)} type="button">
        <ChevronLeft aria-hidden="true" size={16} />
      </button>
      <span aria-live="polite" className="lumer-page-indicator">{pageCount ? `${pageNumber} / ${pageCount}` : '— / —'}</span>
      <button aria-label="下一页" className="lumer-icon-button" disabled={!readerReady || pageNumber >= (pageCount ?? 0)} onClick={() => navigateToDisplayPage(pageNumber + 1)} type="button">
        <ChevronRight aria-hidden="true" size={16} />
      </button>
      <span className="lumer-reader-control-divider" aria-hidden="true" />
      <button aria-label="缩小 PDF" className="lumer-icon-button" disabled={!readerReady || zoom <= MIN_ZOOM} onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))} type="button">
        <Minus aria-hidden="true" size={16} />
      </button>
      <span className="lumer-zoom-indicator">{zoom}%</span>
      <button aria-label="放大 PDF" className="lumer-icon-button" disabled={!readerReady || zoom >= MAX_ZOOM} onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))} type="button">
        <Plus aria-hidden="true" size={16} />
      </button>
    </div>
  );

  return (
    <AppShell
      activeNav={null}
      backHref="/"
      backLabel="返回文献库"
      subtitle={authors}
      title={title}
      topbarActions={controls}
      vortexTheme
    >
      <div className="lumer-reader-layout">
        <section className="lumer-reader-workspace" aria-label="PDF 阅读区">
          {loading ? (
            <div className="lumer-pdf-loading" aria-label="正在加载论文">
              <div className="lumer-pdf-page-skeleton" />
            </div>
          ) : error ? (
            <div className="lumer-reader-error">
              <AlertBanner tone="danger" title="无法打开托管 PDF">
                {readerErrorCopy(error)}
              </AlertBanner>
              <Link className="lumer-button lumer-button-secondary" href="/">返回文献库</Link>
            </div>
          ) : fileUrl ? (
            <PdfCanvas
              annotationBusy={annotationBusy}
              annotationMode={annotationMode}
              annotations={annotations}
              fileUrl={fileUrl}
              pageCount={pageCount}
              pageNumber={pageNumber}
              selectedAnnotationId={selectedAnnotation?.annotation_id ?? null}
              zoom={zoom}
              onDocumentLoaded={(nextPageCount) => {
                setPageCount(nextPageCount);
                restorePageFromUrl(nextPageCount);
              }}
              onLoadError={() => setError({ code: 'PDF_CORRUPT', message: 'PDF 渲染失败。' })}
              onAnnotationSelect={selectAnnotation}
              onSelection={(selection) => { void createAnnotation(selection); }}
            />
          ) : null}
        </section>

        <aside className="lumer-reader-ai-panel" aria-label="AI 助手">
          <div className="lumer-reader-panel-heading">
            <div>
              <p className="lumer-eyebrow">PAPER CONTEXT</p>
              <h2>AI 助手</h2>
            </div>
            <span className="lumer-status-badge lumer-status-neutral">阅读模式</span>
          </div>

          {loading ? (
            <div className="lumer-reader-panel-skeleton" aria-label="正在读取 AI 面板" />
          ) : (
            <>
              <section className="lumer-reader-annotations" aria-labelledby="annotation-heading">
                <div className="lumer-reader-annotation-heading">
                  <div>
                    <p className="lumer-eyebrow">ANNOTATIONS</p>
                    <h3 id="annotation-heading">标注与 Memo</h3>
                  </div>
                  <span aria-live="polite" className="lumer-annotation-count">{annotations.length}</span>
                </div>

                {annotationError ? (
                  <AlertBanner tone="danger" title="标注未完成">
                    {annotationErrorCopy(annotationError)}
                  </AlertBanner>
                ) : null}

                <div className="lumer-annotation-mode-buttons" aria-label="新建标注类型">
                  <button
                    aria-pressed={annotationMode === 'important'}
                    className={`lumer-button lumer-button-secondary${annotationMode === 'important' ? ' is-active' : ''}`}
                    disabled={!readerReady || annotationBusy}
                    onClick={() => setAnnotationMode((current) => current === 'important' ? null : 'important')}
                    type="button"
                  >
                    <PenLine aria-hidden="true" size={14} />重要标注
                  </button>
                  <button
                    aria-pressed={annotationMode === 'unknown'}
                    className={`lumer-button lumer-button-secondary${annotationMode === 'unknown' ? ' is-active' : ''}`}
                    disabled={!readerReady || annotationBusy}
                    onClick={() => setAnnotationMode((current) => current === 'unknown' ? null : 'unknown')}
                    type="button"
                  >
                    <PenLine aria-hidden="true" size={14} />存疑标注
                  </button>
                </div>
                <p className="lumer-annotation-hint">
                  {annotationMode
                    ? '已进入标注模式：在当前页用鼠标或键盘选择正文，松开即可保存。'
                    : '选择一种标注类型后，在 PDF 正文中选中文本；也可点击已保存标注编辑 Memo。'}
                </p>

                {selectedAnnotation ? (
                  <div className="lumer-annotation-editor">
                    <div className="lumer-annotation-editor-meta">
                      <span>第 {selectedAnnotation.display_page_number} 页</span>
                      <button className="lumer-text-button" onClick={() => setSelectedAnnotation(null)} type="button">收起</button>
                    </div>
                    <blockquote>{selectedAnnotation.text}</blockquote>
                    <label htmlFor="annotation-type">标注类型</label>
                    <select
                      id="annotation-type"
                      onChange={(event) => setAnnotationType(event.target.value as AnnotationType)}
                      value={annotationType}
                    >
                      <option value="important">重要标注</option>
                      <option value="unknown">存疑标注</option>
                    </select>
                    <label htmlFor="annotation-memo">Memo</label>
                    <textarea
                      id="annotation-memo"
                      onChange={(event) => setAnnotationNote(event.target.value)}
                      placeholder="为这条标注写下你的想法（可选）"
                      value={annotationNote}
                    />
                    <div className="lumer-annotation-editor-actions">
                      <button className="lumer-button lumer-button-primary" disabled={annotationBusy} onClick={() => { void saveSelectedAnnotation(); }} type="button">
                        <Save aria-hidden="true" size={14} />保存 Memo
                      </button>
                      <button className="lumer-button lumer-button-danger" disabled={annotationBusy} onClick={() => { void deleteSelectedAnnotation(); }} type="button">
                        <Trash2 aria-hidden="true" size={14} />删除
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <div className="lumer-reader-analysis-card">
                <Bot aria-hidden="true" size={19} />
                <div><strong>生成论文概览</strong></div>
                {analysisError ? <div className="lumer-reader-analysis-error" role="alert">{analysisError.message}</div> : null}
                {detail?.current_final ? (
                  <Link className="lumer-button lumer-button-secondary" href={`/papers/${paperId}/analysis/${detail.current_final.analysis_run_id}`}>{detail.paper.markdown_sync_status === 'synced' ? '查看已生成 Paper Card' : '查看当前 Final'}</Link>
                ) : null}
                {analyzeProvider === 'openai_compatible' && <p className="lumer-analysis-data-warning">启动后，论文正文将发送到配置的 API 服务。</p>}
                {activeRun?.paper_id === paperId && activeRun.state === 'running' ? <button className="lumer-button lumer-button-secondary" onClick={() => { void cancelAnalysis(); }} type="button">取消分析</button> : <button aria-busy={analysisBusy} className="lumer-button lumer-button-primary" disabled={!detail?.extraction_available || analysisBusy || activeRun !== null} onClick={() => { void startAnalysis(); }} type="button">
                  {analysisBusy ? '正在生成概览…' : detail?.current_final ? '重新生成概览' : '生成概览'}
                </button>}
              </div>

              <div className="lumer-reader-quick-actions" aria-label="选文快捷操作">
                <button className="lumer-button lumer-button-secondary" disabled type="button"><FileSearch aria-hidden="true" size={15} />解释选文</button>
                <button className="lumer-button lumer-button-secondary" disabled type="button"><Languages aria-hidden="true" size={15} />翻译</button>
              </div>

              {detail?.current_final ? (
                <section aria-label="论文自由对话" className="lumer-reader-chat">
                  {chatMessages.length > 0 ? (
                    <div aria-live="polite" aria-label={`${chatProviderLabel(chatProvider)} 对话历史`} className="lumer-reader-chat-history" role="log">
                      {chatMessages.map((item, index) => <p className={`is-${item.role}`} key={`${item.role}-${index}`}><b>{item.role === 'user' ? '你' : chatProviderLabel(chatProvider)}</b><span>{item.content}</span></p>)}
                    </div>
                  ) : null}
                  {chatError ? <div className="lumer-reader-chat-error" role="alert">{chatError.message}</div> : null}
                  <div className="lumer-reader-chat-composer">
                    <div className="lumer-reader-chat-provider">
                      <MessageSquareText aria-hidden="true" size={16} />
                      <label htmlFor="reader-chat-provider">Provider</label>
                      <select aria-label="Chat Provider" disabled={chatBusy} id="reader-chat-provider" onChange={(event) => setChatProvider(event.target.value as ChatProvider)} value={chatProvider}>
                        {CHAT_PROVIDERS.map((provider) => <option key={provider} value={provider}>{chatProviderLabel(provider)}</option>)}
                      </select>
                    </div>
                    <textarea aria-label={`向 ${chatProviderLabel(chatProvider)} 提问`} disabled={chatBusy || !detail.extraction_available} onChange={(event) => { setChatInput(event.target.value); setChatError(null); }} onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        void sendChat();
                      }
                    }} placeholder="随心输入" value={chatInput} />
                    <button aria-label={`发送到 ${chatProviderLabel(chatProvider)}`} className="lumer-reader-chat-send" disabled={chatBusy || !chatInput.trim() || !detail.extraction_available} onClick={() => { void sendChat(); }} title="发送" type="button">
                      <Send aria-hidden="true" size={16} />
                    </button>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
