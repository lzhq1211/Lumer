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

  it('从常见出版社页眉提取干净的期刊名', () => {
    expect(identifyJournal(null, [{ text: 'PLOS Biology | https://doi.org/10.1371/journal.pbio.3002193' }])).toBe('PLOS Biology');
    expect(identifyJournal(null, [{ text: 'PLOS COMPUTATIONAL BIOLOGY\nRESEARCH ARTICLE\n论文标题' }])).toBe('PLOS COMPUTATIONAL BIOLOGY');
    expect(identifyJournal(null, [{ text: 'Applied Neuropsychology: Child\nISSN: 2162-2965 (Print)' }])).toBe('Applied Neuropsychology: Child');
    expect(identifyJournal(null, [{ text: 'and Adults. Brain Sci. 2022, 12, 550. 正文' }])).toBe('Brain Sci.');
    expect(identifyJournal(null, [{ text: 'Behavior Research Methods (2026) 58:32\n论文标题' }])).toBe('Behavior Research Methods');
    expect(identifyJournal(null, [{ text: 'Early Human Development 198 (2024) 106110\n论文标题' }])).toBe('Early Human Development');
  });

  it('拒绝把 DOI、ISSN 和网页说明当成期刊名', () => {
    expect(identifyJournal(null, [{ text: 'https://doi.org/10.1371/journal.pbio.3002193 ence E/I.' }])).toBeNull();
    expect(identifyJournal(null, [{ text: 'journal homepage: www.elsevier.com/locate/earlhumdev' }])).toBeNull();
  });
});
