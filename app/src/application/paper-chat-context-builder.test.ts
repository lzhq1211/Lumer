import { describe, expect, it } from 'vitest';

import {
  buildPaperChatContext,
  estimateChatTokens,
  MAX_CHAT_CONTEXT_ESTIMATED_TOKENS,
  PaperChatContextError,
} from '@/application/paper-chat-context-builder';
import type { ExtractedPaper } from '@/domain/paper';

const PAPER_ID = '123e4567-e89b-42d3-a456-426614174000';
const SOURCE_SHA256 = 'a'.repeat(64);
const CONTENT_HASH = 'b'.repeat(64);

function extraction(pages: Array<{ text: string }>): ExtractedPaper {
  return {
    schema_version: 1,
    extraction_version: 'fixture-v1',
    paper_id: PAPER_ID,
    source_sha256: SOURCE_SHA256,
    content_hash: CONTENT_HASH,
    page_count: pages.length,
    extracted_char_count: pages.reduce((total, page) => total + page.text.length, 0),
    pages: pages.map((page, index) => ({ pdf_page_index: index, display_page_number: index + 1, text: page.text })),
    created_at: '2026-09-05T00:00:00.000Z',
  };
}

describe('PaperChatContextBuilder', () => {
  it('以固定顺序生成页码正文、有限历史和问题，并对相同输入保持确定性', () => {
    const input = {
      extraction: extraction([{ text: '论文标题\n\nEEG methods report alpha power.' }, { text: 'Unrelated background.' }]),
      message: '请解释 EEG methods。',
      selected_text: null,
      history: [{ role: 'user' as const, content: '上一问' }, { role: 'assistant' as const, content: '上一答' }],
    };
    const first = buildPaperChatContext(input);
    const second = buildPaperChatContext(input);

    expect(first).toEqual(second);
    expect(first.user_input).toContain('<untrusted_paper_text>');
    expect(first.user_input).toContain('[physical_page=1]');
    expect(first.user_input).toContain('<untrusted_chat_history>');
    expect(first.user_input).toContain('<question>');
    expect(first.estimated_tokens).toBe(estimateChatTokens(`${first.system_prompt}\n\n${first.user_input}`));
  });

  it('在总预算内裁剪正文和历史，不为任一单独部分绕过 250,000 上限', () => {
    const result = buildPaperChatContext({
      extraction: extraction(Array.from({ length: 80 }, () => ({ text: 'EEG result '.repeat(1200) }))),
      message: '请总结 EEG result。',
      selected_text: null,
      history: Array.from({ length: 20 }, (_, index) => ({ role: 'assistant' as const, content: `历史 ${index} ${'context '.repeat(1000)}` })),
    });

    expect(result.estimated_tokens).toBeLessThanOrEqual(MAX_CHAT_CONTEXT_ESTIMATED_TOKENS);
    expect(result.selected_paragraph_count).toBeGreaterThan(0);
    expect(result.history_message_count).toBeLessThanOrEqual(12);
  });

  it('当前问题本身超过总预算时本地拒绝且不生成上下文', () => {
    expect(() => buildPaperChatContext({
      extraction: extraction([{ text: 'small' }]),
      message: 'x'.repeat(800000),
      selected_text: null,
      history: [],
    })).toThrow(PaperChatContextError);
  });
});
