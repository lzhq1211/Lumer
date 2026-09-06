'use client';

import {
  Archive,
  BookOpen,
  CheckCircle2,
  FilePlus2,
  FileText,
  Inbox,
  LoaderCircle,
  Pencil,
  Search,
  Settings,
  Tags,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PaperMetadataEditor } from '@/components/library/PaperMetadataEditor';
import { AlertBanner } from '@/components/ui/AlertBanner';
import type { PaperRecord } from '@/domain/paper';
import type { PaperSummary } from '@/domain/paper-library';
import type { SettingsView } from '@/lib/config/lumer-config';

interface LibraryPageProps {
  view: 'library' | 'tag';
}

interface SettingsResponse {
  data?: SettingsView;
  error?: { message?: string };
}

interface PapersResponse {
  data?: PaperSummary[];
  error?: { message?: string };
}

interface ImportResponse {
  data?: { paper: PaperRecord; duplicate: boolean };
  error?: { message?: string };
}

interface DeleteResponse {
  data?: { paper_id: string; deleted_managed_paths: string[] };
  error?: { message?: string };
}

type StatusFilter = 'all' | PaperRecord['status'];

function latestAnalysisTitle(state: NonNullable<PaperSummary['latest_analysis']>['state']): string {
  if (state === 'preview') return '打开最新概览';
  if (state === 'draft') return '打开最新 Draft';
  if (state === 'finalizing') return '打开正在恢复的 Final';
  return '打开最新 Final';
}

const statusLabels: Record<PaperRecord['status'], string> = {
  inbox: '收件箱',
  reading: '阅读中',
  read: '已读',
};

export function LibraryPage({ view }: LibraryPageProps) {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [papersLoading, setPapersLoading] = useState(false);
  const [papersError, setPapersError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [editingPaper, setEditingPaper] = useState<PaperRecord | null>(null);
  const [deletingPaper, setDeletingPaper] = useState<PaperRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResponse['data'] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPapers = useCallback(async () => {
    setPapersLoading(true);
    setPapersError(null);
    try {
      const response = await fetch('/api/papers', { cache: 'no-store' });
      const payload = await response.json() as PapersResponse;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || '文献库无法读取。');
      }
      setPapers(payload.data);
    } catch (error) {
      setPapersError(error instanceof Error ? error.message : '文献库无法读取。');
    } finally {
      setPapersLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadSettings = async () => {
      try {
        const response = await fetch('/api/settings', { cache: 'no-store' });
        const payload = await response.json() as SettingsResponse;
        if (!response.ok || !payload.data) {
          throw new Error(payload.error?.message || 'Settings unavailable');
        }
        if (cancelled) return;
        setSettings(payload.data);
        if (payload.data.vault_status === 'valid') await loadPapers();
      } catch {
        if (!cancelled) setSettingsError(true);
      }
    };
    void loadSettings();
    return () => { cancelled = true; };
  }, [loadPapers]);

  useEffect(() => {
    setStatusFilter('all');
    setTagFilter(null);
  }, [view]);

  const importPdf = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const response = await fetch('/api/papers/import', { method: 'POST', body: formData });
      const payload = await response.json() as ImportResponse;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || '导入失败。');
      }
      setImportResult(payload.data);
      await loadPapers();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '导入失败。');
    } finally {
      setImporting(false);
    }
  };

  const counts = useMemo(() => ({
    inbox: papers.filter((summary) => summary.paper.status === 'inbox').length,
    reading: papers.filter((summary) => summary.paper.status === 'reading').length,
    read: papers.filter((summary) => summary.paper.status === 'read').length,
  }), [papers]);

  const tags = useMemo(() => {
    const tagCounts = new Map<string, number>();
    papers.forEach(({ paper }) => paper.tags.forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }));
    return [...tagCounts.entries()].sort((left, right) => (
      right[1] - left[1] || left[0].localeCompare(right[0])
    ));
  }, [papers]);

  const visiblePapers = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return papers.filter(({ paper }) => {
      const matchesText = needle === '' || [paper.title, ...paper.authors, paper.doi ?? '']
        .some((value) => value.toLocaleLowerCase().includes(needle));
      const matchesStatus = view === 'tag'
        || statusFilter === 'all'
        || paper.status === statusFilter;
      const matchesTag = view === 'library' || tagFilter === null || paper.tags.includes(tagFilter);
      return matchesText && matchesStatus && matchesTag;
    });
  }, [papers, search, statusFilter, tagFilter, view]);

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setTagFilter(null);
  };

  const savePaper = (paper: PaperRecord) => {
    setPapers((current) => current
      .map((summary) => summary.paper.paper_id === paper.paper_id ? { ...summary, paper } : summary)
      .sort((left, right) => right.paper.updated_at.localeCompare(left.paper.updated_at)));
    setEditingPaper(null);
  };

  const deletePaper = async () => {
    if (!deletingPaper) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/papers/${deletingPaper.paper_id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_record_revision: deletingPaper.record_revision,
          confirmed_paper_id: deletingPaper.paper_id,
        }),
      });
      const payload = await response.json() as DeleteResponse;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || '永久删除失败。');
      }
      setDeletingPaper(null);
      await loadPapers();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '永久删除失败。');
    } finally {
      setDeleting(false);
    }
  };

  const title = view === 'tag' ? '标签' : '文献库';
  const description = view === 'tag'
    ? '在当前文献库中按标签筛选。'
    : '所有论文都由已配置的 Obsidian Vault 管理。';

  return (
    <div className="lumer-library-layout">
      <aside className="lumer-library-secondary" aria-label={view === 'tag' ? '标签筛选' : '文献库筛选'}>
        <div className="lumer-secondary-heading">
          <span>{view === 'tag' ? '标签视图' : '文献状态'}</span>
          <small>{view === 'tag' ? 'TAG' : 'LIBRARY'}</small>
        </div>
        {view === 'tag' ? (
          tags.length === 0 ? (
            <div className="lumer-empty-filter">
              <Tags aria-hidden="true" size={18} strokeWidth={1.75} />
              <span>还没有标签。</span>
            </div>
          ) : (
            <nav className="lumer-secondary-nav" aria-label="标签">
              <button className={tagFilter === null ? 'is-selected' : ''} onClick={() => setTagFilter(null)} type="button">
                <Tags aria-hidden="true" size={16} />全部标签 <span>{papers.length}</span>
              </button>
              {tags.map(([tag, count]) => (
                <button className={tagFilter === tag ? 'is-selected' : ''} key={tag} onClick={() => setTagFilter(tag)} type="button">
                  <span aria-hidden="true">#</span><span>{tag}</span><span>{count}</span>
                </button>
              ))}
            </nav>
          )
        ) : (
          <nav className="lumer-secondary-nav" aria-label="文献状态">
            <button className={statusFilter === 'all' ? 'is-selected' : ''} onClick={() => setStatusFilter('all')} type="button"><Tags aria-hidden="true" size={16} />全部 <span>{papers.length}</span></button>
            <button className={statusFilter === 'inbox' ? 'is-selected' : ''} onClick={() => setStatusFilter('inbox')} type="button"><Inbox aria-hidden="true" size={16} />收件箱 <span>{counts.inbox}</span></button>
            <button className={statusFilter === 'reading' ? 'is-selected' : ''} onClick={() => setStatusFilter('reading')} type="button"><BookOpen aria-hidden="true" size={16} />阅读中 <span>{counts.reading}</span></button>
            <button className={statusFilter === 'read' ? 'is-selected' : ''} onClick={() => setStatusFilter('read')} type="button"><Archive aria-hidden="true" size={16} />已读 <span>{counts.read}</span></button>
          </nav>
        )}
      </aside>

      <section className="lumer-library-main">
        <div className="lumer-page-heading">
          <div>
            <p className="lumer-eyebrow">LUMER RESEARCH DESK</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <input ref={fileInputRef} className="sr-only" accept="application/pdf,.pdf" aria-label="选择要导入的 PDF" onChange={importPdf} type="file" />
          <button className="lumer-button lumer-button-primary" disabled={settings?.vault_status !== 'valid' || importing || papersLoading} onClick={() => fileInputRef.current?.click()} type="button">
            {importing ? <LoaderCircle aria-hidden="true" className="lumer-spin" size={16} /> : <FilePlus2 aria-hidden="true" size={16} />}
            {importing ? '正在导入…' : '导入 PDF'}
          </button>
        </div>

        <label className="lumer-search-field">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">搜索论文</span>
          <input disabled={papers.length === 0 || papersLoading} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、作者或 DOI" value={search} />
        </label>

        <div className="lumer-library-banners">
          {importError ? <AlertBanner tone="danger" title="PDF 导入失败">{importError}</AlertBanner> : null}
          {importResult ? (
            <AlertBanner tone="success" title={importResult.duplicate ? '已找到相同论文' : '导入完成'}>
              {importResult.paper.title}：{importResult.duplicate ? '未重复写入。' : '已写入文献库。'}
            </AlertBanner>
          ) : null}
        </div>

        {settingsError ? (
          <div className="lumer-library-state"><AlertBanner tone="danger" title="设置状态无法读取">请进入设置检查本地配置文件。</AlertBanner></div>
        ) : settings === null ? (
          <div className="lumer-library-state"><div className="lumer-skeleton-card" aria-label="正在读取设置" /></div>
        ) : settings.vault_status === 'unconfigured' ? (
          <div className="lumer-library-state"><div className="lumer-onboarding-card">
            <span className="lumer-onboarding-icon"><Settings aria-hidden="true" size={22} /></span>
            <p className="lumer-eyebrow">FIRST STEP</p>
            <h2>先连接 Obsidian Vault</h2>
            <p>Lumer 不使用临时目录作为业务数据根。请手工输入一个可读写的 Vault 绝对路径。</p>
            <Link className="lumer-button lumer-button-primary" href="/settings">打开设置</Link>
          </div></div>
        ) : settings.vault_status !== 'valid' ? (
          <div className="lumer-library-state"><AlertBanner tone="danger" title="Vault 当前不可用">不会回退到临时目录。<Link href="/settings">前往设置修复</Link>。</AlertBanner></div>
        ) : papersError ? (
          <div className="lumer-library-state"><AlertBanner tone="danger" title="文献库无法读取">{papersError}</AlertBanner></div>
        ) : papersLoading ? (
          <div className="lumer-paper-table lumer-paper-table-loading" aria-label="正在读取文献库">{Array.from({ length: 6 }, (_, index) => <div className="lumer-paper-row-skeleton" key={index} />)}</div>
        ) : papers.length === 0 ? (
          <div className="lumer-library-state"><div className="lumer-onboarding-card is-connected">
            <span className="lumer-onboarding-icon"><BookOpen aria-hidden="true" size={22} /></span>
            <p className="lumer-eyebrow">LIBRARY READY</p>
            <h2>还没有论文</h2>
            <p>导入第一篇受支持的 PDF，Lumer 会按原始字节 SHA-256 去重。</p>
            <button className="lumer-button lumer-button-primary" onClick={() => fileInputRef.current?.click()} type="button">导入第一篇 PDF</button>
          </div></div>
        ) : visiblePapers.length === 0 ? (
          <div className="lumer-library-state"><div className="lumer-onboarding-card">
            <span className="lumer-onboarding-icon"><Search aria-hidden="true" size={22} /></span>
            <p className="lumer-eyebrow">NO RESULT</p>
            <h2>没有符合条件的论文</h2>
            <p>当前共 {papers.length} 篇论文，搜索和筛选条件均保留。</p>
            <button className="lumer-button lumer-button-secondary" onClick={clearFilters} type="button">清除筛选</button>
          </div></div>
        ) : (
          <div className="lumer-paper-list-section">
            <div className="lumer-paper-list-heading">
              <div><h2>{tagFilter ? `标签：${tagFilter}` : statusFilter === 'all' ? '全部论文' : statusLabels[statusFilter]}</h2><p>显示 {visiblePapers.length} / {papers.length} 篇 · {counts.reading} 篇阅读中</p></div>
            </div>
            <div className="lumer-paper-table" role="table" aria-label="论文列表">
              <div className="lumer-paper-table-header" role="row">
                <span role="columnheader">论文</span><span role="columnheader">标签</span><span role="columnheader">年份</span><span role="columnheader">状态</span><span role="columnheader">Final</span><span role="columnheader">操作</span>
              </div>
              {visiblePapers.map(({ paper, has_current_final: hasCurrentFinal, latest_analysis: latestAnalysis }) => (
                <div className="lumer-paper-row" key={paper.paper_id} role="row">
                  <div className="lumer-paper-identity" role="cell"><Link aria-label={`打开 ${paper.title}`} href={`/reader/${paper.paper_id}`}><strong title={paper.title}>{paper.title}</strong><span title={paper.authors.join(', ')}>{paper.authors.length ? paper.authors.join(', ') : '未填写作者'}</span></Link></div>
                  <div className="lumer-paper-tags" role="cell">{paper.tags.length ? paper.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>) : <small>—</small>}</div>
                  <span role="cell">{paper.year ?? '—'}</span>
                  <span className={`lumer-paper-status is-${paper.status}`} role="cell">{statusLabels[paper.status]}</span>
                  <span className={hasCurrentFinal ? 'lumer-status-badge lumer-status-success' : 'lumer-status-badge lumer-status-neutral'} role="cell">{hasCurrentFinal ? <><CheckCircle2 aria-hidden="true" size={12} />已有</> : '未有'}</span>
                  <div className="lumer-paper-row-actions" role="cell">
                    {latestAnalysis ? <Link aria-label={`查看解析 ${paper.title}`} className="lumer-button lumer-button-ghost lumer-row-action" href={`/papers/${encodeURIComponent(paper.paper_id)}/analysis/${encodeURIComponent(latestAnalysis.analysis_run_id)}`} title={latestAnalysisTitle(latestAnalysis.state)}><FileText aria-hidden="true" size={14} />查看解析</Link> : <button aria-label={`查看解析 ${paper.title}`} className="lumer-button lumer-button-ghost lumer-row-action" disabled title="尚未生成解析" type="button"><FileText aria-hidden="true" size={14} />查看解析</button>}
                    <Link aria-label={`阅读 ${paper.title}`} className="lumer-button lumer-button-ghost lumer-row-action" href={`/reader/${paper.paper_id}`}><BookOpen aria-hidden="true" size={14} />阅读</Link>
                    <button aria-label={`查看或编辑 ${paper.title}`} className="lumer-button lumer-button-ghost lumer-row-action" onClick={() => setEditingPaper(paper)} type="button"><Pencil aria-hidden="true" size={14} />编辑</button>
                    <button aria-label={`删除 ${paper.title}`} className="lumer-button lumer-button-ghost lumer-row-action" onClick={() => { setDeleteError(null); setDeletingPaper(paper); }} type="button"><Trash2 aria-hidden="true" size={14} />删除</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {editingPaper ? <PaperMetadataEditor paper={editingPaper} onClose={() => setEditingPaper(null)} onSaved={savePaper} /> : null}
      {deletingPaper ? <div className="lumer-dialog-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) setDeletingPaper(null);
      }}>
        <section aria-labelledby="delete-paper-title" aria-modal="true" className="lumer-dialog-card" role="dialog">
          <p className="lumer-eyebrow">PERMANENT DELETE</p>
          <h2 id="delete-paper-title">永久删除这篇论文？</h2>
          <p title={deletingPaper.title}>{deletingPaper.title}</p>
          <p>确认后将永久删除受管 PDF、提取文本、AnalysisRun、Chat Session、当前受管 Paper Card 与相关 journal；另存后已退出管理的旧 Markdown 会保留。此操作没有废纸篓、撤销或恢复。</p>
          {deleteError ? <AlertBanner tone="danger" title="删除失败">{deleteError}</AlertBanner> : null}
          <div className="lumer-dialog-actions">
            <button className="lumer-button lumer-button-ghost" disabled={deleting} onClick={() => setDeletingPaper(null)} type="button">取消</button>
            <button autoFocus className="lumer-button lumer-button-danger" disabled={deleting} onClick={() => { void deletePaper(); }} type="button"><Trash2 aria-hidden="true" size={15} />{deleting ? '正在永久删除…' : '确认永久删除'}</button>
          </div>
        </section>
      </div> : null}
    </div>
  );
}
