# Chat Context Limits v1

**日期**：2026-09-05  
**状态**：已批准，供 7B 实现使用  
**可执行 Source of Truth**：`app/src/lib/ai-providers/chat-context-limits.v1.json`

## 冻结值

- `max_estimated_tokens=250,000` 是一次 Chat 请求的总上下文硬上限。
- 总量包含 system prompt、当前问题、有限的同 Provider 应用历史和本地确定性选择的 Extraction 正文片段。
- 估算公式为 `ceil(UTF-8 bytes / 3)`；它是本地一致性估算，不是任一外部模型 tokenizer 的声明。
- 该值与 2C PDF 导入支持上限中的 `250,000 estimated tokens` 分离，不代表 Codex 或 HTTP Provider 已稳定接受 250,000 tokens。

## 执行边界

- `PaperChatContextBuilder` 必须在本地完成页/自然段选择、历史裁剪、页码标记和总量计算。
- 超过总预算时返回 `CHAT_CONTEXT_LIMIT_EXCEEDED`（HTTP 413），不得发送正文、调用 Provider 或 fallback。
- 不为正文、历史或单段分别再分配一个 250,000 上限；三者共享同一个总预算。
- 论文正文和应用历史都视为不可信输入，必须放入明确的 untrusted 分隔区；当前问题保持为控制输入。

## 已知 Spike 证据

同一真实 PDF 的历史探针中，4,533-token 单段 Codex 与 HTTP 各有一次成功；HTTP 同尺寸重复请求超时，8,000-token 重复测试不稳定，24,000-token 请求在观测窗口内超时。因此本值是用户批准的应用侧硬上限和防止盲传全文的合同，不是外部 Provider 容量证明；后续 Live Smoke 仍需独立报告真实 Provider 结果。
