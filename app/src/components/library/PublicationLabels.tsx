'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

import { ZOTERO_STYLE_PUBLICATION_DEFAULT_COLOR, ZOTERO_STYLE_PUBLICATION_RANK_COLORS } from '@/domain/publication-label';

export function PublicationLabels({ paperId, journal }: { paperId: string; journal: string | null }) {
  const [labels, setLabels] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/papers/${paperId}/publication-labels`, { cache: 'no-store' }).then((response) => response.json()).then((payload: { data?: { labels: Record<string, string> } }) => {
      if (!cancelled && payload.data) setLabels(payload.data.labels);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [journal, paperId]);
  if (!labels || Object.keys(labels).length === 0) return null;
  const items: Array<[string, string]> = [
    labels.sciUp || labels.sciBase ? ['中科院', labels.sciUp || labels.sciBase] : null,
    labels.sci ? ['SCI', labels.sci] : null,
    labels.sciif ? ['IF', labels.sciif] : null,
  ].filter((item): item is [string, string] => item !== null);
  if (items.length === 0) return null;
  return <span className="lumer-publication-labels" aria-label="期刊标签">{items.map(([label, value], index) => <span className="lumer-publication-label" key={label} style={{ '--publication-label-color': ZOTERO_STYLE_PUBLICATION_RANK_COLORS[index] ?? ZOTERO_STYLE_PUBLICATION_DEFAULT_COLOR } as CSSProperties}>{`${label} ${value}`}</span>)}</span>;
}
