import { z } from 'zod';

import { NonEmptyStringSchema, RevisionSchema, SchemaVersionSchema, UtcDateTimeSchema, UuidSchema } from '@/domain/storage-types';

export const ChatMessageSchema = z.strictObject({
  message_id: UuidSchema,
  role: z.enum(['user', 'assistant']),
  content: NonEmptyStringSchema,
  created_at: UtcDateTimeSchema,
});

export const ChatProviderSchema = z.enum(['codex', 'openai_compatible']);

const ChatSessionFields = {
  session_id: UuidSchema,
  provider_session_id: NonEmptyStringSchema,
  model: NonEmptyStringSchema,
  messages: z.array(ChatMessageSchema),
  created_at: UtcDateTimeSchema,
  updated_at: UtcDateTimeSchema,
} as const;

export const CodexChatSessionSchema = z.strictObject({
  ...ChatSessionFields,
  provider: z.literal('codex'),
});

export const OpenAICompatibleChatSessionSchema = z.strictObject({
  ...ChatSessionFields,
  provider: z.literal('openai_compatible'),
});

export const ChatSessionSchema = z.discriminatedUnion('provider', [
  CodexChatSessionSchema,
  OpenAICompatibleChatSessionSchema,
]);

export const ChatSessionStoreSchema = z.strictObject({
  schema_version: SchemaVersionSchema,
  paper_id: UuidSchema,
  session_revision: RevisionSchema,
  sessions: z.strictObject({
    codex: CodexChatSessionSchema.nullable(),
    openai_compatible: OpenAICompatibleChatSessionSchema.nullable(),
  }),
});

export type ChatSession = z.infer<typeof ChatSessionSchema>;
export type ChatSessionStore = z.infer<typeof ChatSessionStoreSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
