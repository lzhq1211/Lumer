import { describe, expect, it } from 'vitest';

import { identifyAuthors, identifyDoi, identifyJournal, identifyYear } from '@/lib/metadata/pdf-metadata';

describe('PDF metadata identification', () => {
  it('从 PDF 元数据优先识别并规范化 DOI', () => {
    expect(identifyDoi({ title: 'doi: 10.1234/ABC.1.', author: null, subject: null, keywords: null }, [])).toBe('10.1234/abc.1');
  });

  it('在前两页文本中识别 DOI，并保留元数据作者列表', () => {
    expect(identifyDoi(null, [{ text: 'References omitted' }, { text: 'https://doi.org/10.5678/example-2).' }])).toBe('10.5678/example-2');
    expect(identifyAuthors({ title: null, author: 'Ada Lovelace; Alan Turing', subject: null, keywords: null })).toEqual(['Ada Lovelace', 'Alan Turing']);
  });

  it('从元数据或首页明确行识别年份和期刊', () => {
    const pages = [{ text: 'Journal of Safe Science\nPublished 2024\n正文' }];
    expect(identifyYear(null, pages)).toBe(2024);
    expect(identifyJournal(null, pages)).toBe('Journal of Safe Science');
    expect(identifyJournal({ title: null, author: null, subject: 'Proceedings of Testing', keywords: null }, [])).toBe('Proceedings of Testing');
    expect(identifyJournal(null, [{ text: 'Front. Neurosci. 17:1059186. diagnosing sleep disorders' }])).toBe('Front. Neurosci.');
  });
});
