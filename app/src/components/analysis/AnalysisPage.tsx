'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ClipboardCheck, ExternalLink, FilePenLine, History, Save, ShieldCheck } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AppShell } from '@/components/layout/AppShell';
import { AlertBanner } from '@/components/ui/AlertBanner';
import type { AnalysisRun, PaperAnalysis } from '@/domain/analysis-run';
import { isOverviewRun } from '@/domain/analysis-run';
import type { PaperDetail } from '@/domain/paper-library';
import { readSseData } from '@/lib/http/sse-client';
import { renderPaperAnalysisMarkdown } from '@/lib/markdown/paper-analysis-markdown';

interface AnalysisPageProps { paperId: string; runId: string }
interface ApiError { error?: { code?: string; message?: string; details?: Record<string, unknown> | null } }
interface ApiPayload<T> extends ApiError { data?: T }
interface FinalizeResult { run: AnalysisRun; paper: PaperDetail['paper']; committed: boolean; recovery_required: boolean }
interface ActiveAnalysisRun { analysis_run_id: string; paper_id: string; state: 'running' | 'finalizing' }
type MarkdownAction = 'create' | 'overwrite' | 'save_as';

function providerLabel(provider: AnalysisRun['provider']): string {
  return provider === 'codex' ? 'Codex' : 'API';
}

class ApiClientError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> | null) { super(message); this.name = 'ApiClientError'; }
}

const TEXT_SECTIONS: Array<{ key: keyof Pick<PaperAnalysis, 'background' | 'research_questions' | 'methods' | 'study_design' | 'user_notes'>; title: string }> = [
  { key: 'background', title: '研究背景' },
  { key: 'research_questions', title: '研究问题' },
  { key: 'methods', title: '方法' },
  { key: 'study_design', title: '研究设计' },
  { key: 'user_notes', title: '用户笔记' },
];

function message(error: unknown, fallback: string): string {
  const failure = error as Partial<{ message: string }>;
  return failure.message ?? fallback;
}

function editableAnalysis(analysis: PaperAnalysis) {
  return {
    metadata_candidate: analysis.metadata_candidate,
    background: analysis.background.map(({ block_id, text }) => ({ block_id, text })),
    research_questions: analysis.research_questions.map(({ block_id, text }) => ({ block_id, text })),
    sample: analysis.sample === null ? null : { block_id: analysis.sample.block_id, text: analysis.sample.text },
    methods: analysis.methods.map(({ block_id, text }) => ({ block_id, text })),
    study_design: analysis.study_design.map(({ block_id, text }) => ({ block_id, text })),
    findings: analysis.findings.map((finding) => ({
      finding_id: finding.finding_id,
      claim: finding.claim,
      evidence: finding.evidence.map((evidence) => ({ evidence_id: evidence.evidence_id, model_quote: evidence.model_quote, model_reported_page: evidence.model_reported_page })),
    })),
    user_notes: analysis.user_notes.map(({ block_id, text }) => ({ block_id, text })),
  };
}

export function AnalysisPage({ paperId, runId }: AnalysisPageProps) {
  const router = useRouter();
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [history, setHistory] = useState<AnalysisRun[]>([]);
  const [paper, setPaper] = useState<PaperDetail | null>(null);
  const [editing, setEditing] = useState<ReturnType<typeof editableAnalysis> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'verify' | 'finalize' | 'derive' | 'sync' | 'accept_metadata' | 'retry' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markdownConflict, setMarkdownConflict] = useState<{ operation: 'finalize' | 'sync'; actualHash: string | null | undefined } | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveAnalysisRun | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runResponse, historyResponse, paperResponse] = await Promise.all([
        fetch(`/api/analysis-runs/${encodeURIComponent(runId)}`, { cache: 'no-store' }),
        fetch(`/api/analysis-runs?paper_id=${encodeURIComponent(paperId)}`, { cache: 'no-store' }),
        fetch(`/api/papers/${encodeURIComponent(paperId)}`, { cache: 'no-store' }),
      ]);
      const [runPayload, historyPayload, paperPayload] = await Promise.all([
        runResponse.json() as Promise<ApiPayload<AnalysisRun>>,
        historyResponse.json() as Promise<ApiPayload<AnalysisRun[]>>,
        paperResponse.json() as Promise<ApiPayload<PaperDetail>>,
      ]);
      if (!runResponse.ok || !runPayload.data) throw new Error(runPayload.error?.message ?? 'AnalysisRun 无法读取。');
      if (!historyResponse.ok || !historyPayload.data) throw new Error(historyPayload.error?.message ?? 'Analysis 历史无法读取。');
      if (!paperResponse.ok || !paperPayload.data) throw new Error(paperPayload.error?.message ?? '论文记录无法读取。');
      setRun(runPayload.data);
      setHistory([...historyPayload.data].sort((left, right) => right.updated_at.localeCompare(left.updated_at)));
      setPaper(paperPayload.data);
      setEditing(runPayload.data.paper_analysis ? editableAnalysis(runPayload.data.paper_analysis) : null);
    } catch (reason) {
      setError(message(reason, 'Analysis 页面无法读取。'));
    } finally { setLoading(false); }
  }, [paperId, runId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let disposed = false;
    const loadActive = async () => {
      try {
        const response = await fetch('/api/analysis-runs/active', { cache: 'no-store' });
        const payload = await response.json() as ApiPayload<ActiveAnalysisRun | null>;
        if (!disposed && response.ok) setActiveRun(payload.data ?? null);
      } catch { /* 下一次轮询重试。 */ }
    };
    void loadActive();
    const interval = window.setInterval(() => { void loadActive(); }, 1200);
    return () => { disposed = true; window.clearInterval(interval); };
  }, []);
  useEffect(() => {
    if (!markdownConflict) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && busy === null) setMarkdownConflict(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [busy, markdownConflict]);

  const readOnly = run?.state === 'preview' || run?.state === 'finalized' || run?.state === 'finalizing';
  const finalizationBlocked = activeRun !== null && activeRun.analysis_run_id !== run?.analysis_run_id;
  const gatePassed = run?.state === 'draft' && run.evidence_gate.status === 'passed';
  const overview = run !== null && isOverviewRun(run);
  const canSyncOverview = overview && run?.state === 'preview' && Boolean(run.raw_model_output?.trim());
  const currentFinalPaper = paper !== null && paper.paper.current_final_run_id === run?.analysis_run_id ? paper.paper : null;
  const hasMetadataCandidate = run?.paper_analysis !== null && run?.paper_analysis !== undefined && (() => {
    const candidate = run.paper_analysis.metadata_candidate;
    return candidate.title?.trim() || candidate.authors.some((author) => author.trim()) || candidate.year !== null || candidate.journal?.trim() || candidate.doi?.trim();
  })();
  const statusCopy = useMemo(() => {
    if (!run) return '正在读取';
    if (run.state === 'preview') return `${providerLabel(run.provider)} 概览已生成`;
    if (run.state === 'finalized') return 'Final 已冻结';
    if (run.state === 'finalizing') return '已提交，正在恢复';
    if (run.state === 'cancelled') return '分析已取消';
    if (run.state === 'interrupted') return '分析已中断';
    if (run.state === 'failed') return '分析失败';
    if (run.evidence_gate.status === 'passed') return 'Evidence Gate 已通过';
    if (run.evidence_gate.status === 'pending') return '待验证 Evidence';
    return 'Evidence 未通过';
  }, [run]);
  const detailedMarkdown = run?.paper_analysis
    ? renderPaperAnalysisMarkdown(run.paper_analysis, { includeLegacySections: false })
    : null;

  async function request<T>(url: string, method: 'PATCH' | 'POST', body: Record<string, unknown>): Promise<T> {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json() as ApiPayload<T>;
    if (!response.ok || !payload.data) throw new ApiClientError(payload.error?.code ?? 'INTERNAL_ERROR', payload.error?.message ?? '请求未完成。', payload.error?.details ?? null);
    return payload.data;
  }

  async function saveDraft(): Promise<void> {
    if (!run || !editing || readOnly) return;
    setBusy('save'); setError(null); setNotice(null);
    try {
      const next = await request<AnalysisRun>(`/api/analysis-runs/${run.analysis_run_id}`, 'PATCH', { expected_draft_revision: run.draft_revision, paper_analysis: editing });
      setRun(next); setEditing(editableAnalysis(next.paper_analysis!)); setNotice('Draft 已保存；受影响的 Evidence 已回到待验证状态。');
    } catch (reason) { setError(message(reason, 'Draft 保存失败。')); } finally { setBusy(null); }
  }

  async function acceptMetadataCandidate(): Promise<void> {
    if (!run || !paper || !run.paper_analysis) return;
    setBusy('accept_metadata'); setError(null); setNotice(null);
    try {
      const next = await request<PaperDetail['paper']>(`/api/analysis-runs/${run.analysis_run_id}/accept-metadata`, 'POST', {
        expected_draft_revision: run.draft_revision,
        expected_paper_record_revision: paper.paper.record_revision,
      });
      setPaper((current) => current ? { ...current, paper: next } : current);
      setNotice('Metadata Candidate 已接受并更新论文记录。');
    } catch (reason) { setError(message(reason, '接受 Metadata Candidate 失败。')); } finally { setBusy(null); }
  }

  async function verify(): Promise<void> {
    if (!run || readOnly) return;
    setBusy('verify'); setError(null); setNotice(null);
    try {
      const next = await request<AnalysisRun>(`/api/analysis-runs/${run.analysis_run_id}/verify`, 'POST', { expected_draft_revision: run.draft_revision });
      setRun(next); setEditing(editableAnalysis(next.paper_analysis!)); setNotice(next.evidence_gate.status === 'passed' ? 'Evidence 已验证，Gate 已通过。' : 'Evidence 验证完成；请修正失败项后重新验证。');
    } catch (reason) { setError(message(reason, 'Evidence 验证失败。')); } finally { setBusy(null); }
  }

  function openMarkdownConflict(operation: 'finalize' | 'sync', reason: unknown): void {
    const failure = reason as Partial<ApiClientError>;
    if (failure.code !== 'MARKDOWN_CONFLICT') return;
    const actual = failure.details?.actual_markdown_hash;
    setMarkdownConflict({ operation, actualHash: typeof actual === 'string' || actual === null ? actual : undefined });
  }

  async function finalize(markdownAction: MarkdownAction = paper?.paper.card_path ? 'overwrite' : 'create', expectedHash: string | null = markdownAction === 'overwrite' ? paper?.paper.markdown_hash ?? null : null): Promise<void> {
    if (!run || !paper || (!gatePassed && !canSyncOverview) || finalizationBlocked) return;
    setBusy('finalize'); setError(null); setNotice(null);
    try {
      const result = await request<FinalizeResult>(`/api/analysis-runs/${run.analysis_run_id}/finalize`, 'POST', {
        expected_draft_revision: run.draft_revision,
        expected_paper_record_revision: paper.paper.record_revision,
        markdown_action: markdownAction,
        expected_markdown_hash: expectedHash,
      });
      setRun(result.run); setPaper((current) => current ? { ...current, paper: result.paper, current_final: { analysis_run_id: result.run.analysis_run_id, state: 'finalized', finalized_at: result.run.finalized_at, provider: result.run.provider, model: result.run.model } } : current);
      setNotice(result.paper.markdown_sync_status === 'synced' ? '最终版已保存，Markdown 已同步到 Obsidian Vault。' : '最终版已保存；Markdown 尚未同步，请重试同步。');
      await load();
    } catch (reason) { openMarkdownConflict('finalize', reason); if (!(reason instanceof ApiClientError && reason.code === 'MARKDOWN_CONFLICT')) setError(message(reason, 'Final 保存失败。')); } finally { setBusy(null); }
  }

  async function syncMarkdown(markdownAction: MarkdownAction, expectedHash: string | null): Promise<void> {
    if (!run || !paper || paper.paper.current_final_run_id !== run.analysis_run_id) return;
    setBusy('sync'); setError(null); setNotice(null);
    try {
      const next = await request<PaperDetail['paper']>(`/api/analysis-runs/${run.analysis_run_id}/sync-markdown`, 'POST', {
        expected_paper_record_revision: paper.paper.record_revision,
        markdown_action: markdownAction,
        expected_markdown_hash: expectedHash,
      });
      setPaper((current) => current ? { ...current, paper: next } : current);
      setNotice(next.markdown_sync_status === 'synced' ? 'Markdown 已同步。' : '最终版已安全保存；Markdown 仍需处理。');
      await load();
    } catch (reason) { openMarkdownConflict('sync', reason); if (!(reason instanceof ApiClientError && reason.code === 'MARKDOWN_CONFLICT')) setError(message(reason, 'Markdown 同步失败。')); } finally { setBusy(null); }
  }

  async function deriveDraft(): Promise<void> {
    if (!run || run.state !== 'finalized') return;
    setBusy('derive'); setError(null);
    try {
      const next = await request<AnalysisRun>(`/api/analysis-runs/${run.analysis_run_id}/derive-draft`, 'POST', {});
      router.push(`/papers/${encodeURIComponent(paperId)}/analysis/${next.analysis_run_id}`);
    } catch (reason) { setError(message(reason, '无法创建派生 Draft。')); } finally { setBusy(null); }
  }

  async function retryRun(): Promise<void> {
    if (!run || !['failed', 'cancelled', 'interrupted'].includes(run.state)) return;
    setBusy('retry'); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/analysis-runs/${run.analysis_run_id}/retry`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: run.provider }),
      });
      const stream = response.body;
      if (!response.ok || !stream) throw new Error('Retry 请求未能建立事件流。');
      let nextRunId: string | null = null;
      for await (const event of readSseData<{ type?: string; analysis_run?: { analysis_run_id?: string } | null; error?: { message?: string } | null }>(stream)) {
        if (event.type === 'failed') {
          const historyResponse = await fetch(`/api/analysis-runs?paper_id=${encodeURIComponent(paperId)}`, { cache: 'no-store' });
          const historyPayload = await historyResponse.json() as ApiPayload<AnalysisRun[]>;
          const failedRetry = historyPayload.data
            ?.filter((candidate) => candidate.state === 'failed' && candidate.retry_of_run_id === run.analysis_run_id)
            .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
          if (historyResponse.ok && failedRetry) {
            nextRunId = failedRetry.analysis_run_id;
            continue;
          }
          throw new Error(event.error?.message ?? 'Retry 未能创建新的 Run。');
        }
        if (event.type === 'completed') nextRunId = event.analysis_run?.analysis_run_id ?? null;
      }
      if (!nextRunId) throw new Error('Retry 未返回新的 Run。');
      router.push(`/papers/${encodeURIComponent(paperId)}/analysis/${encodeURIComponent(nextRunId)}`);
    } catch (reason) { setError(message(reason, 'Retry 未能创建新的 Run。')); } finally { setBusy(null); }
  }

  function updateText(key: (typeof TEXT_SECTIONS)[number]['key'], index: number, text: string): void {
    setEditing((current) => current ? { ...current, [key]: current[key].map((block, blockIndex) => blockIndex === index ? { ...block, text } : block) } : current);
  }

  function updateFinding(index: number, field: 'claim' | 'model_quote', value: string): void {
    setEditing((current) => current ? {
      ...current,
      findings: current.findings.map((finding, findingIndex) => findingIndex !== index ? finding : field === 'claim'
        ? { ...finding, claim: value }
        : { ...finding, evidence: finding.evidence.map((evidence, evidenceIndex) => evidenceIndex === 0 ? { ...evidence, model_quote: value } : evidence) }),
    } : current);
  }

  function chooseMarkdownAction(action: 'overwrite' | 'save_as'): void {
    if (!markdownConflict) return;
    const operation = markdownConflict.operation;
    const overwriteAction: MarkdownAction = markdownConflict.actualHash === null ? 'create' : 'overwrite';
    const expectedHash = overwriteAction === 'overwrite' ? markdownConflict.actualHash ?? null : null;
    setMarkdownConflict(null);
    if (action === 'save_as') {
      if (operation === 'finalize') void finalize('save_as', null);
      else void syncMarkdown('save_as', null);
      return;
    }
    if (operation === 'finalize') void finalize(overwriteAction, expectedHash);
    else void syncMarkdown(overwriteAction, expectedHash);
  }

  return (
    <AppShell activeNav={null} backHref={`/reader/${paperId}`} backLabel="返回阅读器" subtitle={run ? `${providerLabel(run.provider)} · ${run.model}` : '读取中'} title={paper?.paper.title ?? '论文分析'} vortexTheme>
      <div className="lumer-analysis-layout" aria-busy={loading}>
        <section className="lumer-analysis-main" aria-label={overview ? `${run ? providerLabel(run.provider) : '论文'} 概览` : 'Paper Card'}>
          <header className="lumer-analysis-heading">
            <div><p className="lumer-eyebrow">{overview ? `${run ? providerLabel(run.provider).toUpperCase() : 'OVERVIEW'} OVERVIEW` : 'PAPER CARD'}</p><h1>{overview ? run?.state === 'finalized' ? '最终版论文概览' : `${run ? providerLabel(run.provider) : '论文'} 概览` : readOnly ? '最终版 Paper Card' : 'Draft Paper Card'}</h1><span>{statusCopy}</span></div>
            <span className={`lumer-status-badge ${run?.state === 'preview' || gatePassed || run?.state === 'finalized' ? 'lumer-status-success' : ['failed', 'cancelled', 'interrupted'].includes(run?.state ?? '') || run?.evidence_gate.status === 'failed' ? 'lumer-status-danger' : 'lumer-status-warning'}`}>{statusCopy}</span>
          </header>
          {error ? <AlertBanner tone="danger" title="操作未完成">{error}</AlertBanner> : null}
          {notice ? <AlertBanner tone="success" title="状态已更新">{notice}</AlertBanner> : null}
          {finalizationBlocked ? <AlertBanner tone="warning" title="已有论文正在分析">当前 Run 不能保存为 Final；请等待活动 Analyze 或 Final 完成。</AlertBanner> : null}
          {run?.state === 'cancelled' || run?.state === 'interrupted' || run?.state === 'failed' ? <AlertBanner tone="warning" title={run.state === 'cancelled' ? '分析已取消' : run.state === 'interrupted' ? '分析已中断' : '分析失败'}>
            {run.failure_message ?? '当前 Run 未生成结果；可以创建新的 Retry Run。'}
          </AlertBanner> : null}
          {currentFinalPaper !== null && currentFinalPaper.markdown_sync_status !== 'synced' && currentFinalPaper.markdown_sync_status !== 'not_generated' ? <AlertBanner tone={currentFinalPaper.markdown_sync_status === 'conflict' ? 'danger' : 'warning'} title={currentFinalPaper.markdown_sync_status === 'conflict' ? 'Markdown 存在外部冲突' : 'Markdown 尚未同步'}>
            最终版已安全保存。{currentFinalPaper.markdown_sync_error ?? 'Markdown 正在等待同步。'}
            <button className="lumer-button lumer-button-secondary" disabled={busy !== null} onClick={() => {
              const context = currentFinalPaper.markdown_sync_context;
              if (!context) return;
              void syncMarkdown(context.markdown_action, context.expected_markdown_hash);
            }} type="button">{currentFinalPaper.markdown_sync_status === 'conflict' ? '处理冲突' : '重试同步'}</button>
          </AlertBanner> : null}
          {loading ? <div className="lumer-analysis-skeleton" aria-label="正在加载 Paper Card" /> : null}
          {canSyncOverview ? <div className="lumer-analysis-actions"><button aria-busy={busy === 'finalize'} className="lumer-button lumer-button-primary" disabled={busy !== null || finalizationBlocked} onClick={() => { void finalize(); }} type="button"><Save aria-hidden="true" size={15} />{busy === 'finalize' ? '正在同步…' : '同步到 Obsidian'}</button><p>保存当前完整概览为最终版，并同步到你的 Obsidian Vault。</p></div> : null}
          {!loading && overview && run?.raw_model_output ? <article aria-label={`${providerLabel(run.provider)} 概览正文`} className="lumer-analysis-preview">
            <p className="lumer-eyebrow">RESPONSE</p>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.raw_model_output}</ReactMarkdown>
          </article> : null}
          {!loading && run?.paper_analysis && editing ? <div className="lumer-analysis-card">
            <section className="lumer-metadata-candidate" aria-label="Metadata Candidate">
              <div><p className="lumer-eyebrow">METADATA CANDIDATE</p><h2>Analyze 提出的论文信息</h2><p>尚未写入论文记录；只有接受后才会更新。</p></div>
              <dl>
                <div><dt>标题</dt><dd>{run.paper_analysis.metadata_candidate.title || '未提供'}</dd></div>
                <div><dt>作者</dt><dd>{run.paper_analysis.metadata_candidate.authors.length > 0 ? run.paper_analysis.metadata_candidate.authors.join(', ') : '未提供'}</dd></div>
                <div><dt>年份</dt><dd>{run.paper_analysis.metadata_candidate.year ?? '未提供'}</dd></div>
                <div><dt>期刊</dt><dd>{run.paper_analysis.metadata_candidate.journal || '未提供'}</dd></div>
                <div><dt>DOI</dt><dd>{run.paper_analysis.metadata_candidate.doi || '未提供'}</dd></div>
              </dl>
              <button aria-busy={busy === 'accept_metadata'} className="lumer-button lumer-button-secondary" disabled={busy !== null || !hasMetadataCandidate} onClick={() => { void acceptMetadataCandidate(); }} type="button">{busy === 'accept_metadata' ? '正在接受…' : hasMetadataCandidate ? '接受候选并更新 Metadata' : '没有可接受的候选信息'}</button>
            </section>
            {TEXT_SECTIONS.map(({ key, title }) => <section key={key}><h2>{title}</h2>{editing[key].length === 0 ? <p className="lumer-analysis-empty">暂无内容</p> : editing[key].map((block, index) => <textarea aria-label={`${title} ${index + 1}`} disabled={readOnly || busy !== null} key={block.block_id ?? index} onChange={(event) => updateText(key, index, event.target.value)} value={block.text} />)}</section>)}
            <section><h2>核心发现</h2>{editing.findings.map((finding, index) => <div className="lumer-analysis-finding" key={finding.finding_id ?? index}><label>Finding {index + 1}<textarea aria-label={`Finding ${index + 1}`} disabled={readOnly || busy !== null} onChange={(event) => updateFinding(index, 'claim', event.target.value)} value={finding.claim} /></label><label>Evidence quote<textarea aria-label={`Evidence quote ${index + 1}`} disabled={readOnly || busy !== null} onChange={(event) => updateFinding(index, 'model_quote', event.target.value)} value={finding.evidence[0]?.model_quote ?? ''} /></label></div>)}</section>
          </div> : null}
          {!loading && detailedMarkdown ? <article aria-label="完整论文精读" className="lumer-analysis-deep-reading">
            <div className="lumer-analysis-deep-reading-heading"><div><p className="lumer-eyebrow">DEEP READING</p><h2>完整论文精读</h2></div><span>Markdown</span></div>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{detailedMarkdown}</ReactMarkdown>
          </article> : null}
          {!loading && run?.state === 'draft' ? <footer className="lumer-analysis-actions">
            <button aria-busy={busy === 'save'} className="lumer-button lumer-button-secondary" disabled={busy !== null} onClick={() => { void saveDraft(); }} type="button"><Save aria-hidden="true" size={15} />{busy === 'save' ? '正在保存…' : '保存 Draft'}</button>
            <button aria-busy={busy === 'verify'} className="lumer-button lumer-button-secondary" disabled={busy !== null} onClick={() => { void verify(); }} type="button"><ClipboardCheck aria-hidden="true" size={15} />{busy === 'verify' ? '正在验证…' : '验证证据'}</button>
            {gatePassed ? <button aria-busy={busy === 'finalize'} className="lumer-button lumer-button-primary" disabled={busy !== null || finalizationBlocked} onClick={() => { void finalize(); }} type="button"><ShieldCheck aria-hidden="true" size={15} />{busy === 'finalize' ? '正在提交…' : '保存为最终版'}</button> : null}
          </footer> : null}
          {currentFinalPaper?.markdown_sync_status === 'synced' ? <p role="status">已同步到 Obsidian：{currentFinalPaper.card_path}</p> : null}
          {run?.state === 'finalized' && !overview ? <footer className="lumer-analysis-actions"><button aria-busy={busy === 'derive'} className="lumer-button lumer-button-primary" disabled={busy !== null} onClick={() => { void deriveDraft(); }} type="button"><FilePenLine aria-hidden="true" size={15} />{busy === 'derive' ? '正在复制…' : '复制为新草稿'}</button></footer> : null}
          {run && ['failed', 'cancelled', 'interrupted'].includes(run.state) ? <footer className="lumer-analysis-actions"><button aria-busy={busy === 'retry'} className="lumer-button lumer-button-primary" disabled={busy !== null} onClick={() => { void retryRun(); }} type="button">{busy === 'retry' ? '正在创建 Retry…' : '创建新的 Retry Run'}</button></footer> : null}
        </section>
        <aside className="lumer-evidence-panel" aria-label="Evidence 与历史">
          {overview ? <section><div className="lumer-evidence-heading"><div><p className="lumer-eyebrow">STATUS</p><h2>概览结果</h2></div></div><p className="lumer-analysis-empty">{run?.state === 'finalized' ? '完整概览已保存为用户确认的最终版。' : '点击“同步到 Obsidian”保存完整概览及版本。'} 概览未进行逐条证据验证。</p></section> : <section><div className="lumer-evidence-heading"><div><p className="lumer-eyebrow">EVIDENCE</p><h2>Evidence Gate</h2></div><span>{run?.evidence_gate.finding_results.filter((item) => item.status === 'passed').length ?? 0}/{run?.evidence_gate.finding_results.length ?? 0}</span></div>
            {run?.paper_analysis?.findings.map((finding, index) => <article className="lumer-evidence-finding" key={finding.finding_id}><strong>Finding {index + 1}</strong>{finding.evidence.map((evidence) => <div className={`lumer-evidence-item is-${evidence.verification_status}`} key={evidence.evidence_id}><span>{evidence.verification_status === 'verified' ? <CheckCircle2 aria-hidden="true" size={14} /> : <ClipboardCheck aria-hidden="true" size={14} />}{evidence.verification_status === 'verified' ? '已验证' : evidence.verification_status === 'failed' ? '未通过' : '待验证'}</span><blockquote>{evidence.source_quote ?? evidence.model_quote}</blockquote><small>{evidence.display_page_number ? `第 ${evidence.display_page_number} 页 · 字符 ${evidence.source_span_start}–${evidence.source_span_end}` : evidence.failure_reason ?? '尚未定位'}</small>{evidence.display_page_number ? <Link href={`/reader/${paperId}?page=${evidence.display_page_number}`}><ExternalLink aria-hidden="true" size={13} />回到原文</Link> : null}</div>)}</article>)}</section>}
          <section className="lumer-analysis-history"><div className="lumer-evidence-heading"><div><p className="lumer-eyebrow">HISTORY</p><h2>版本历史</h2></div><History aria-hidden="true" size={17} /></div>{history.map((item) => <Link aria-current={item.analysis_run_id === runId ? 'page' : undefined} className={item.analysis_run_id === runId ? 'is-current' : ''} href={`/papers/${paperId}/analysis/${item.analysis_run_id}`} key={item.analysis_run_id}><span>{item.state === 'finalized' ? 'Final' : item.state === 'preview' ? '概览' : 'Draft'}</span><small>{new Date(item.updated_at).toLocaleString('zh-CN', { hour12: false })}</small></Link>)}</section>
        </aside>
      </div>
      {markdownConflict ? <div aria-labelledby="markdown-conflict-title" aria-modal="true" className="lumer-dialog-backdrop" role="dialog">
        <div className="lumer-dialog-card">
          <p className="lumer-eyebrow">MARKDOWN CONFLICT</p><h2 id="markdown-conflict-title">Paper Card 已被外部修改</h2>
          <p>取消不会写入或提交 Final。覆盖将替换当前 Paper Card；另存新文件会保留旧文件并切换受管路径。</p>
          <div className="lumer-dialog-actions"><button autoFocus className="lumer-button lumer-button-secondary" disabled={busy !== null} onClick={() => setMarkdownConflict(null)} type="button">取消</button><button className="lumer-button lumer-button-secondary" disabled={busy !== null} onClick={() => chooseMarkdownAction('overwrite')} type="button">覆盖</button><button className="lumer-button lumer-button-primary" disabled={busy !== null} onClick={() => chooseMarkdownAction('save_as')} type="button">另存新文件</button></div>
        </div>
      </div> : null}
    </AppShell>
  );
}
