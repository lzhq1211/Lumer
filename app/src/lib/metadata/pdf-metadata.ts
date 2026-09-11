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

function metadataText(metadata: PdfDocumentMetadata | null): string {
  return metadata
    ? [metadata.title, metadata.author, metadata.subject, metadata.keywords].filter(Boolean).join('\n')
    : '';
}

export function identifyYear(metadata: PdfDocumentMetadata | null, pages: readonly { text: string }[]): number | null {
  const match = `${metadataText(metadata)}\n${pages.slice(0, 2).map((page) => page.text).join('\n')}`.match(YEAR_PATTERN);
  return match ? Number(match[1]) : null;
}

export function identifyJournal(metadata: PdfDocumentMetadata | null, pages: readonly { text: string }[]): string | null {
  const subject = metadata?.subject?.trim();
  if (subject && JOURNAL_MARKER.test(subject)) return subject;
  const lines = pages.slice(0, 2).flatMap((page) => page.text.split(/\r?\n/u));
  const candidate = lines
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => !/^REVIEWED BY|^EDITED BY|^PUBLISHED|^RECEIVED|^ACCEPTED/iu.test(line))
    .find((line) => line.length >= 3 && line.length <= 180 && (CITATION_JOURNAL.test(line) || JOURNAL_MARKER.test(line)));
  if (!candidate) return null;
  const frontiers = candidate.match(/\b(Frontiers in [A-Z][A-Za-z]+)\b/u);
  if (frontiers) return frontiers[1];
  const frontCitation = candidate.match(/^(Front\.\s+[A-Z][\w. -]+?)(?:\s+\d{1,3}[:;].*)/u);
  return frontCitation?.[1]?.trim() || candidate;
}
