import { z } from 'zod';

export const STORAGE_SCHEMA_VERSION = 1 as const;

export const SchemaVersionSchema = z.literal(STORAGE_SCHEMA_VERSION);
export const UuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  '必须是小写 canonical UUID。',
);
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, '必须是 64 位小写 SHA-256。');
export const UtcDateTimeSchema = z.string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
    '必须是以 Z 结尾的 RFC 3339 UTC 时间。',
  )
  .refine((value) => Number.isFinite(Date.parse(value)), '必须是有效 UTC 时间。');
export const RevisionSchema = z.number().int().min(1);
export const NonEmptyStringSchema = z.string().min(1).refine(
  (value) => value === value.trim(),
  '不得包含首尾空白。',
);
export const NullableNonEmptyStringSchema = NonEmptyStringSchema.nullable();

export function isVaultRelativePath(value: string): boolean {
  if (
    value.length === 0
    || value.includes('\0')
    || value.includes('\\')
    || value.startsWith('/')
    || value.endsWith('/')
  ) {
    return false;
  }

  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export const VaultRelativePathSchema = z.string().refine(
  isVaultRelativePath,
  '必须是无空段、`.`、`..`、NUL 或反斜杠的 Vault POSIX 相对路径。',
);

export function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: 'custom', path, message });
}

export function isSameOrAfter(candidate: string, baseline: string): boolean {
  return Date.parse(candidate) >= Date.parse(baseline);
}

export function hasUniqueValues(values: string[]): boolean {
  return new Set(values).size === values.length;
}
