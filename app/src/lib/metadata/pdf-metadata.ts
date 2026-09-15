export interface PdfDocumentMetadata {
  readonly title: string | null;
  readonly author: string | null;
  readonly subject: string | null;
  readonly keywords: string | null;
}

const DOI_PATTERN = /\b10\.\d{4,9}\/[\-._;()/:A-Z0-9]+/i;

function cleanDoi(value: string): string | null {
  const match = value.match(DOI_PATTERN);
  if (!match) return null;
  return match[0]
    .replace(/[.,;:]+$/u, '')
    .replace(/[)\]}]+$/u, '')
    .trim()
    .toLowerCase();
}

export function identifyDoi(metadata: PdfDocumentMetadata | null, pages: readonly { text: string }[]): string | null {
  const metadataText = metadata
    ? [metadata.title, metadata.author, metadata.subject, metadata.keywords].filter(Boolean).join('\n')
    : '';
  return cleanDoi(metadataText) ?? cleanDoi(pages.slice(0, 2).map((page) => page.text).join('\n'));
}

export function identifyAuthors(metadata: PdfDocumentMetadata | null): string[] {
  const author = metadata?.author?.trim();
  if (!author) return [];
  return author.split(/\s*;\s*/u).map((value) => value.trim()).filter(Boolean);
}

const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/u;
const JOURNAL_MARKER = /(journal|proceedings|transactions|review|letters|conference|期刊|学报|会议)/iu;
const CITATION_JOURNAL = /^(Front\.\s+[A-Z][\w. -]+|[A-Z][A-Za-z.& -]{2,}\s+\d{1,3}[:;])/u;
const JOURNAL_HEADER_PATTERNS = [
  /^(.{3,120}?[A-Za-z\u3400-\u9fff])\s+\((?:19|20)\d{2}\)\s+\d{1,4}(?::\d{1,4})?/u,
  /^(.{3,120}?[A-Za-z\u3400-\u9fff])\s+\d{1,4}\s+\((?:19|20)\d{2}\)/u,
  /^(.{3,120}?)\s+(?:19|20)\d{2},\s+\d{1,4},\s+\d{1,4}\b/u,
  /^(Front\.\s+[A-Z][\w. -]+?)\s+\d{1,4}[:;]/u,
];
const JOURNAL_PIPE_HEADER = /^([^|]{3,120}?)\s+\|\s+(?:https?:\/\/|doi\b)/iu;
const NON_JOURNAL_LINE = /^(?:ARTICLE|ORIGINAL MANUSCRIPT|RESEARCH ARTICLE|CONTENTS LISTS|ABSTRACT|KEYWORDS|ISSN\b|JOURNAL HOMEPAGE\b)/iu;

function metadataText(metadata: PdfDocumentMetadata | null): string {
  return metadata
    ? [metadata.title, metadata.author, metadata.subject, metadata.keywords].filter(Boolean).join('\n')
    : '';
}

function compactLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function extractJournalHeader(value: string): string | null {
  const compact = compactLine(value);
  const pipeMatch = compact.match(JOURNAL_PIPE_HEADER);
  if (pipeMatch?.[1]) return compactLine(pipeMatch[1]);
  for (const pattern of JOURNAL_HEADER_PATTERNS) {
    const match = compact.match(pattern);
    if (match?.[1]) {
      const header = compactLine(match[1]);
      const lastSentence = header.lastIndexOf('. ');
      return compactLine(lastSentence > 0 && !/^Front\./u.test(header) ? header.slice(lastSentence + 2) : header);
    }
  }
  return null;
}

function isPlausibleJournalName(value: string): boolean {
  const compact = compactLine(value);
  if (
    compact.length < 3
    || compact.length > 120
    || DOI_PATTERN.test(compact)
    || /https?:\/\/|www\.|\bISSN\b|journal homepage/iu.test(compact)
    || NON_JOURNAL_LINE.test(compact)
    || compact.split(/\s+/u).length > 16
  ) return false;
  return /[A-Za-z\u3400-\u9fff]/u.test(compact);
}

function cleanJournalCandidate(value: string): string | null {
  const compact = compactLine(value);
  const header = extractJournalHeader(compact);
  const candidate = header || compact;
  return isPlausibleJournalName(candidate) ? candidate : null;
}

export function isLikelyJournalName(value: string | null): boolean {
  if (!value) return false;
  const compact = compactLine(value);
  return cleanJournalCandidate(compact) === compact;
}

export function identifyYear(metadata: PdfDocumentMetadata | null, pages: readonly { text: string }[]): number | null {
  const match = `${metadataText(metadata)}\n${pages.slice(0, 2).map((page) => page.text).join('\n')}`.match(YEAR_PATTERN);
  return match ? Number(match[1]) : null;
}

export function identifyJournal(metadata: PdfDocumentMetadata | null, pages: readonly { text: string }[]): string | null {
  const subject = metadata?.subject?.trim();
  if (subject && JOURNAL_MARKER.test(subject)) {
    const subjectCandidate = cleanJournalCandidate(subject);
    if (subjectCandidate) return subjectCandidate;
  }

  const lines = pages
    .slice(0, 2)
    .flatMap((page) => page.text.split(/\r?\n/u))
    .map(compactLine)
    .filter((line) => line.length >= 3 && !/^REVIEWED BY|^EDITED BY|^PUBLISHED|^RECEIVED|^ACCEPTED/iu.test(line));

  // Many publishers put the journal name immediately before ISSN or journal homepage.
  const publicationInfoIndex = lines.findIndex((line) => /^(?:ISSN\b|JOURNAL HOMEPAGE\b)/iu.test(line));
  if (publicationInfoIndex > 0) {
    const preceding = cleanJournalCandidate(lines[publicationInfoIndex - 1]);
    if (preceding) return preceding;
  }

  // Prefer volume/year headers such as “Behavior Research Methods (2026) 58:32”.
  for (const line of lines) {
    const header = extractJournalHeader(line);
    if (header && isPlausibleJournalName(header)) return header;
  }

  // Standalone all-caps publisher headers cover PLOS and similar layouts.
  for (const line of lines) {
    if (line === line.toUpperCase() && /[A-Z]/u.test(line) && !NON_JOURNAL_LINE.test(line)) {
      const candidate = cleanJournalCandidate(line);
      if (candidate) return candidate;
    }
  }

  const candidate = lines.find((line) => {
    if (!isPlausibleJournalName(line)) return false;
    return CITATION_JOURNAL.test(line) || JOURNAL_MARKER.test(line);
  });
  return candidate ? cleanJournalCandidate(candidate) : null;
}
