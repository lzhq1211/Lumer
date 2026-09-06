import path from 'node:path';

import { UuidSchema } from '@/domain/storage-types';

const INVALID_FILE_CHARACTERS = /[\u0000-\u001f/\\:*?"<>|]+/g;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function safeFileStem(value: string): string {
  const sanitized = value
    .replace(INVALID_FILE_CHARACTERS, '-')
    .replace(/\s+/gu, ' ')
    .replace(/^[ .]+|[ .]+$/g, '');

  if (sanitized.length === 0 || WINDOWS_RESERVED_NAME.test(sanitized)) {
    return 'untitled';
  }
  return sanitized;
}

export function paperIdShort(paperId: string): string {
  return UuidSchema.parse(paperId).replaceAll('-', '').slice(0, 8);
}

export function managedPdfRelativePath(originalFileName: string, paperId: string): string {
  const originalStem = path.parse(originalFileName).name;
  return `Papers/${safeFileStem(originalStem)}--${paperIdShort(paperId)}.pdf`;
}

export function paperCardRelativePath(title: string, paperId: string): string {
  return `Paper Cards/${safeFileStem(title)}--${paperIdShort(paperId)}.md`;
}
