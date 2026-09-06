'use client';

import { Save, X } from 'lucide-react';
import { FormEvent, useState } from 'react';

import { AlertBanner } from '@/components/ui/AlertBanner';
import type { PaperRecord } from '@/domain/paper';

interface PaperMetadataEditorProps {
  paper: PaperRecord;
  onClose: () => void;
  onSaved: (paper: PaperRecord) => void;
}

interface PaperMutationResponse {
  data?: PaperRecord;
  error?: { message?: string };
}

export function PaperMetadataEditor({ paper, onClose, onSaved }: PaperMetadataEditorProps) {
  const [title, setTitle] = useState(paper.title);
  const [authors, setAuthors] = useState(paper.authors.join(', '));
  const [year, setYear] = useState(paper.year === null ? '' : String(paper.year));
  const [journal, setJournal] = useState(paper.journal ?? '');
  const [doi, setDoi] = useState(paper.doi ?? '');
  const [tags, setTags] = useState(paper.tags.join(', '));
  const [status, setStatus] = useState<PaperRecord['status']>(paper.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const parsedYear = year.trim() === '' ? null : Number(year);
    if (parsedYear !== null && !Number.isInteger(parsedYear)) {
      setError('年份必须是整数或留空。');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/papers/${paper.paper_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_record_revision: paper.record_revision,
          title,
          authors: authors.split(',').map((value) => value.trim()).filter(Boolean),
          year: parsedYear,
          journal: journal.trim() || null,
          doi: doi.trim() || null,
          tags: tags.split(',').map((value) => value.trim()).filter(Boolean),
          status,
        }),
      });
      const payload = await response.json() as PaperMutationResponse;
      if (!response.ok || !payload.data) {
        throw new Error(payload.error?.message || '保存 Metadata 失败。');
      }
      onSaved(payload.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存 Metadata 失败。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lumer-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section aria-labelledby="paper-metadata-title" aria-modal="true" className="lumer-metadata-dialog" role="dialog">
        <div className="lumer-dialog-heading">
          <div>
            <p className="lumer-eyebrow">PAPER METADATA</p>
            <h2 id="paper-metadata-title">查看 / 编辑论文</h2>
            <p title={paper.original_file_name}>{paper.original_file_name}</p>
          </div>
          <button aria-label="关闭 Metadata 编辑" className="lumer-icon-button" disabled={saving} onClick={onClose} type="button">
            <X aria-hidden="true" size={17} />
          </button>
        </div>

        {error ? <AlertBanner tone="danger" title="保存失败">{error}</AlertBanner> : null}

        <form className="lumer-metadata-form" onSubmit={save}>
          <label className="lumer-field">
            <span>标题</span>
            <input onChange={(event) => setTitle(event.target.value)} required value={title} />
          </label>
          <label className="lumer-field">
            <span>作者（逗号分隔）</span>
            <input onChange={(event) => setAuthors(event.target.value)} value={authors} />
          </label>
          <div className="lumer-metadata-grid">
            <label className="lumer-field">
              <span>年份</span>
              <input inputMode="numeric" onChange={(event) => setYear(event.target.value)} value={year} />
            </label>
            <label className="lumer-field">
              <span>状态</span>
              <select onChange={(event) => setStatus(event.target.value as PaperRecord['status'])} value={status}>
                <option value="inbox">收件箱</option>
                <option value="reading">阅读中</option>
                <option value="read">已读</option>
              </select>
            </label>
          </div>
          <label className="lumer-field">
            <span>期刊</span>
            <input onChange={(event) => setJournal(event.target.value)} value={journal} />
          </label>
          <label className="lumer-field">
            <span>DOI</span>
            <input onChange={(event) => setDoi(event.target.value)} value={doi} />
          </label>
          <label className="lumer-field">
            <span>标签（逗号分隔）</span>
            <input onChange={(event) => setTags(event.target.value)} value={tags} />
          </label>

          <div className="lumer-dialog-actions">
            <button className="lumer-button lumer-button-ghost" disabled={saving} onClick={onClose} type="button">取消</button>
            <button className="lumer-button lumer-button-primary" disabled={saving || title.trim() === ''} type="submit">
              <Save aria-hidden="true" size={15} />
              {saving ? '正在保存…' : '保存 Metadata'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
