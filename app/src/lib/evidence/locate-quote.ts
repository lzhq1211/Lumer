import { Evidence } from '@/domain/analysis-run';
import { ExtractedPaper } from '@/domain/paper';

type NormalizationStep = Evidence['normalization_steps'][number];

interface NormalizedText {
  readonly text: string;
  readonly sourceIndexes: number[];
  readonly steps: NormalizationStep[];
}

const QUOTES: Record<string, string> = { '“': '"', '”': '"', '‘': "'", '’': "'" };
const DASHES = new Set(['–', '—', '−']);

function appendMapped(target: Array<{ char: string; sourceIndex: number }>, text: string, sourceIndex: number): void {
  for (const char of text) {
    for (let offset = 0; offset < char.length; offset += 1) target.push({ char: char[offset], sourceIndex });
  }
}

export function normalizeForEvidenceMatch(input: string): NormalizedText {
  let items: Array<{ char: string; sourceIndex: number }> = [];
  let sourceIndex = 0;
  let nfkcChanged = false;
  for (const char of input) {
    const normalized = char.normalize('NFKC');
    if (normalized !== char) nfkcChanged = true;
    appendMapped(items, normalized, sourceIndex);
    sourceIndex += char.length;
  }
  const steps: NormalizationStep[] = [];
  if (nfkcChanged) steps.push('nfkc');

  if (items.some((item) => item.char === '\u00ad')) {
    items = items.filter((item) => item.char !== '\u00ad');
    steps.push('remove_soft_hyphen');
  }

  let hyphenationChanged = false;
  const joined: typeof items = [];
  for (let index = 0; index < items.length; index += 1) {
    const current = items[index];
    const next = items[index + 1];
    if (current.char === '-' && next && /\p{L}/u.test(joined.at(-1)?.char ?? '')) {
      let cursor = index + 1;
      while (items[cursor]?.char === ' ' || items[cursor]?.char === '\t') cursor += 1;
      if (items[cursor]?.char === '\n' || items[cursor]?.char === '\r') {
        if (items[cursor]?.char === '\r' && items[cursor + 1]?.char === '\n') cursor += 1;
        cursor += 1;
        while (items[cursor]?.char === ' ' || items[cursor]?.char === '\t') cursor += 1;
        if (/\p{L}/u.test(items[cursor]?.char ?? '')) {
          hyphenationChanged = true;
          index = cursor - 1;
          continue;
        }
      }
    }
    joined.push(current);
  }
  items = joined;
  if (hyphenationChanged) steps.push('join_linebreak_hyphenation');

  let quotesChanged = false;
  let dashesChanged = false;
  items = items.map((item) => {
    if (QUOTES[item.char]) {
      quotesChanged = true;
      return { ...item, char: QUOTES[item.char] };
    }
    if (DASHES.has(item.char)) {
      dashesChanged = true;
      return { ...item, char: '-' };
    }
    return item;
  });
  if (quotesChanged) steps.push('normalize_quotes');
  if (dashesChanged) steps.push('normalize_dashes');

  let whitespaceChanged = false;
  const collapsed: typeof items = [];
  for (const item of items) {
    if (/\s/u.test(item.char)) {
      if (collapsed.at(-1)?.char === ' ') {
        whitespaceChanged = true;
        continue;
      }
      if (item.char !== ' ') whitespaceChanged = true;
      collapsed.push({ ...item, char: ' ' });
      continue;
    }
    collapsed.push(item);
  }
  items = collapsed;
  if (whitespaceChanged) steps.push('collapse_whitespace');
  return { text: items.map((item) => item.char).join(''), sourceIndexes: items.map((item) => item.sourceIndex), steps };
}

interface Match {
  readonly pageIndex: number;
  readonly start: number;
  readonly end: number;
  readonly sourceQuote: string;
  readonly steps: NormalizationStep[];
}

function allIndexes(text: string, quote: string): number[] {
  const indexes: number[] = [];
  let start = 0;
  while (start <= text.length - quote.length) {
    const index = text.indexOf(quote, start);
    if (index < 0) break;
    indexes.push(index);
    start = index + 1;
  }
  return indexes;
}

function exactMatches(extraction: ExtractedPaper, quote: string, pageIndexes: number[]): Match[] {
  return pageIndexes.flatMap((pageIndex) => {
    const page = extraction.pages[pageIndex];
    return allIndexes(page.text, quote).map((start) => ({
      pageIndex,
      start,
      end: start + quote.length,
      sourceQuote: page.text.slice(start, start + quote.length),
      steps: [],
    }));
  });
}

function normalizedMatches(extraction: ExtractedPaper, quote: string, pageIndexes: number[]): Match[] {
  const normalizedQuote = normalizeForEvidenceMatch(quote);
  return pageIndexes.flatMap((pageIndex) => {
    const page = extraction.pages[pageIndex];
    const normalizedPage = normalizeForEvidenceMatch(page.text);
    return allIndexes(normalizedPage.text, normalizedQuote.text).map((start) => {
      const end = start + normalizedQuote.text.length;
      const sourceStart = normalizedPage.sourceIndexes[start];
      const sourceEnd = normalizedPage.sourceIndexes[end - 1] + 1;
      const actualSteps: NormalizationStep[] = [
        'nfkc', 'remove_soft_hyphen', 'join_linebreak_hyphenation', 'normalize_quotes', 'normalize_dashes', 'collapse_whitespace',
      ].filter((step) => normalizedQuote.steps.includes(step as NormalizationStep) || normalizedPage.steps.includes(step as NormalizationStep)) as NormalizationStep[];
      return {
        pageIndex,
        start: sourceStart,
        end: sourceEnd,
        sourceQuote: page.text.slice(sourceStart, sourceEnd),
        steps: actualSteps,
      };
    });
  });
}

function unresolved(evidence: Evidence, reason: Evidence['failure_reason'], locatorStatus: Evidence['locator_status']): Evidence {
  return {
    ...evidence,
    source_quote: null,
    pdf_page_index: null,
    display_page_number: null,
    source_span_start: null,
    source_span_end: null,
    normalization_steps: [],
    locator_status: locatorStatus,
    verification_status: 'failed',
    content_hash: null,
    failure_reason: reason,
  };
}

function verified(evidence: Evidence, extraction: ExtractedPaper, match: Match, locatorStatus: 'exact' | 'normalized'): Evidence {
  return {
    ...evidence,
    source_quote: match.sourceQuote,
    pdf_page_index: match.pageIndex,
    display_page_number: match.pageIndex + 1,
    source_span_start: match.start,
    source_span_end: match.end,
    normalization_steps: match.steps,
    locator_status: locatorStatus,
    verification_status: 'verified',
    content_hash: extraction.content_hash,
    failure_reason: null,
  };
}

export function locateEvidence(evidence: Evidence, extraction: ExtractedPaper): Evidence {
  const reportedIndex = evidence.model_reported_page === null ? null : evidence.model_reported_page - 1;
  const hasValidReportedPage = reportedIndex !== null && reportedIndex >= 0 && reportedIndex < extraction.pages.length;
  const allPages = extraction.pages.map((page) => page.pdf_page_index);
  const firstPages = hasValidReportedPage ? [reportedIndex] : allPages;

  const firstExact = exactMatches(extraction, evidence.model_quote, firstPages);
  if (firstExact.length === 1) return verified(evidence, extraction, firstExact[0], 'exact');
  if (firstExact.length > 1) return unresolved(evidence, 'ambiguous_match', 'ambiguous');
  const firstNormalized = normalizedMatches(extraction, evidence.model_quote, firstPages);
  if (firstNormalized.length === 1) return verified(evidence, extraction, firstNormalized[0], 'normalized');
  if (firstNormalized.length > 1) return unresolved(evidence, 'ambiguous_match', 'ambiguous');
  if (hasValidReportedPage) {
    const fullExact = exactMatches(extraction, evidence.model_quote, allPages);
    if (fullExact.length === 1) return verified(evidence, extraction, fullExact[0], 'exact');
    if (fullExact.length > 1) return unresolved(evidence, 'ambiguous_match', 'ambiguous');
    const fullNormalized = normalizedMatches(extraction, evidence.model_quote, allPages);
    if (fullNormalized.length === 1) return verified(evidence, extraction, fullNormalized[0], 'normalized');
    if (fullNormalized.length > 1) return unresolved(evidence, 'ambiguous_match', 'ambiguous');
  }

  const crossPageText = extraction.pages.map((page) => page.text).join('');
  if (crossPageText.includes(evidence.model_quote)) return unresolved(evidence, 'cross_page_quote', 'not_found');
  return unresolved(evidence, reportedIndex !== null && !hasValidReportedPage ? 'page_out_of_range' : 'quote_not_found', 'not_found');
}
