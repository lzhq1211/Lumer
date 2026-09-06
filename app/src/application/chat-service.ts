import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { PaperMutationCoordinator, paperMutationCoordinator } from '@/application/paper-mutation-coordinator';
import { ProviderAvailabilityStatus, requireAvailableProvider } from '@/application/provider-availability';
import { buildPaperChatContext } from '@/application/paper-chat-context-builder';
import { getProviderStatus } from '@/application/provider-status-service';
import { ChatProviderSchema, ChatSession, ChatSessionStore } from '@/domain/chat-session';
import type { ChatProvider } from '@/types';
import { UuidSchema } from '@/domain/storage-types';
import { CodexAnalyzeAdapter } from '@/lib/ai-providers/codex-analyze-adapter';
import { OpenAICompatibleAdapter } from '@/lib/ai-providers/openai-compatible-adapter';
import { collectProviderTask } from '@/lib/ai-providers/task-contract';
import { AnalysisRunRepository } from '@/lib/storage/analysis-run-repository';
import { ChatSessionRepository } from '@/lib/storage/chat-session-repository';
import { ExtractionRepository } from '@/lib/storage/extraction-repository';
import { PaperRepository } from '@/lib/storage/paper-repository';
import { VaultContext } from '@/lib/storage/vault-path';

export const ChatRequestSchema = z.strictObject({
  provider: ChatProviderSchema,
  message: z.string().trim().min(1),
  selected_text: z.string().trim().min(1).nullable(),
  intent: z.enum(['free_chat', 'explain_selection', 'translate_selection']),
}).superRefine((value, context) => {
  if (value.intent !== 'free_chat' && value.selected_text === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ['selected_text'], message: '解释或翻译必须包含选中文本。' });
});

type ChatErrorCode = 'PAPER_NOT_FOUND' | 'PAPER_CARD_REQUIRED' | 'CHAT_ALREADY_ACTIVE' | 'SESSION_WRITE_FAILED' | 'DATA_INTEGRITY_ERROR';
type ChatErrorStatus = 404 | 409 | 500;

export class ChatServiceError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    message: string,
    readonly status: ChatErrorStatus,
    readonly retryable = false,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = 'ChatServiceError';
  }
}

const activeChatPapers = new Set<string>();

function questionFor(value: z.infer<typeof ChatRequestSchema>): string {
  const instruction = value.intent === 'translate_selection'
    ? '请将选中的论文片段翻译为简体中文。'
    : value.intent === 'explain_selection'
      ? '请用简体中文解释选中的论文片段。'
      : '请用简体中文回答用户问题。';
  return `${instruction}\n\n用户问题：${value.message}`;
}

export class ChatService {
  constructor(
    private readonly codexAdapter: CodexAnalyzeAdapter = new CodexAnalyzeAdapter(),
    private readonly coordinator: PaperMutationCoordinator = paperMutationCoordinator,
    private readonly providerStatus: (provider: ChatProvider) => Promise<ProviderAvailabilityStatus> = (provider) => getProviderStatus(provider),
    private readonly openAICompatibleAdapter: OpenAICompatibleAdapter = new OpenAICompatibleAdapter(),
  ) {}

  private async loadPaperChatSource(context: VaultContext, paperId: string) {
    const papers = new PaperRepository(context);
    if (!await papers.exists(paperId)) throw new ChatServiceError('PAPER_NOT_FOUND', '未找到该论文。', 404, false, { paper_id: paperId });
    const paper = await papers.read(paperId);
    if (paper.current_final_run_id === null) throw new ChatServiceError('PAPER_CARD_REQUIRED', '请先完成并保存 Final Paper Card。', 409, false, { paper_id: paperId });

    const run = await new AnalysisRunRepository(context).findById(paper.current_final_run_id);
    if (!run || run.paper_id !== paperId || run.state !== 'finalized' || run.source_sha256 !== paper.source_sha256) {
      throw new ChatServiceError('PAPER_CARD_REQUIRED', '请先完成并保存 Final Paper Card。', 409, false, { paper_id: paperId });
    }

    const extractions = new ExtractionRepository(context);
    let extraction;
    try {
      if (!await extractions.exists(paperId)) throw new Error('missing extraction');
      extraction = await extractions.read(paperId);
    } catch {
      throw new ChatServiceError('DATA_INTEGRITY_ERROR', '论文正文提取结果不可用，未发送正文。', 500, false, { object_kind: 'extracted_paper', paper_id: paperId });
    }
    if (extraction.paper_id !== paperId || extraction.source_sha256 !== paper.source_sha256 || extraction.content_hash !== run.content_hash) {
      throw new ChatServiceError('DATA_INTEGRITY_ERROR', '论文正文身份校验失败，未发送正文。', 500, false, { object_kind: 'extracted_paper', paper_id: paperId });
    }
    return extraction;
  }

  async get(context: VaultContext, paperId: string, provider: ChatProvider = 'codex'): Promise<ChatSession | null> {
    UuidSchema.parse(paperId);
    await this.loadPaperChatSource(context, paperId);
    const store = await new ChatSessionRepository(context).read(paperId);
    return store?.sessions[provider] ?? null;
  }

  async send(context: VaultContext, paperId: string, value: unknown): Promise<ChatSession> {
    const request = ChatRequestSchema.parse(value);
    UuidSchema.parse(paperId);
    if (activeChatPapers.has(paperId)) {
      throw new ChatServiceError('CHAT_ALREADY_ACTIVE', '该论文已有进行中的 Chat 请求。', 409, true, { paper_id: paperId, provider: 'codex' });
    }
    activeChatPapers.add(paperId);
    try {
      return await this.coordinator.runMutation(paperId, async () => {
        const extraction = await this.loadPaperChatSource(context, paperId);
        requireAvailableProvider(await this.providerStatus(request.provider), request.provider);
        const repository = new ChatSessionRepository(context);
        const previous = await repository.read(paperId);
        const existing = previous?.sessions[request.provider] ?? null;
        const chatContext = buildPaperChatContext({
          extraction,
          message: questionFor(request),
          selected_text: request.selected_text,
          history: existing?.messages ?? [],
        });
        const adapter = request.provider === 'codex' ? this.codexAdapter : this.openAICompatibleAdapter;
        const result = await collectProviderTask(adapter, {
          provider: request.provider,
          task_kind: 'chat',
          session_mode: request.provider === 'codex' && existing ? 'resume' : 'new',
          provider_session_id: request.provider === 'codex' ? existing?.provider_session_id ?? null : null,
          model: request.provider === 'codex' ? existing?.model ?? null : null,
          system_prompt: chatContext.system_prompt,
          user_input: chatContext.user_input,
        });
        const now = new Date().toISOString();
        const session: ChatSession = {
          session_id: existing?.session_id ?? randomUUID(),
          provider: request.provider,
          provider_session_id: result.result.provider_session_id,
          model: result.result.model,
          messages: [
            ...(existing?.messages ?? []),
            { message_id: randomUUID(), role: 'user', content: request.message, created_at: now },
            { message_id: randomUUID(), role: 'assistant', content: result.result.final_text, created_at: now },
          ],
          created_at: existing?.created_at ?? now,
          updated_at: now,
        };
        const store: ChatSessionStore = {
          schema_version: 1,
          paper_id: paperId,
          session_revision: (previous?.session_revision ?? 0) + 1,
          sessions: {
            codex: request.provider === 'codex' ? session as Extract<ChatSession, { provider: 'codex' }> : previous?.sessions.codex ?? null,
            openai_compatible: request.provider === 'openai_compatible' ? session as Extract<ChatSession, { provider: 'openai_compatible' }> : previous?.sessions.openai_compatible ?? null,
          },
        };
        try {
          await repository.write(store);
        } catch {
          throw new ChatServiceError('SESSION_WRITE_FAILED', 'Chat 已完成，但 Session 保存失败。', 500, true, { paper_id: paperId, provider: 'codex' });
        }
        return session;
      });
    } finally {
      activeChatPapers.delete(paperId);
    }
  }
}
