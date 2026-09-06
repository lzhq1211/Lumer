import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildExecutableCandidates, finalizeResolvedCommand, resolveExecutable } from '@/lib/command-runtime';
import { codexPaperAnalysisOutputJsonSchema } from '@/lib/ai-providers/codex-analysis-contract';
import {
  ProviderStreamEvent,
  ProviderTaskAdapter,
  ProviderTaskRequest,
} from '@/lib/ai-providers/task-contract';

interface CodexExecResult {
  readonly provider_session_id: string;
  readonly model: string;
  readonly final_text: string;
}

const CODEX_ANALYZE_TIMEOUT_MS = 5 * 60 * 1000;

export class CodexExecutionTimeoutError extends Error {
  constructor() {
    super('Codex Analyze 超过 5 分钟，已停止。');
    this.name = 'CodexExecutionTimeoutError';
  }
}

export class CodexExecutionAbortedError extends Error {
  constructor() {
    super('Codex Analyze 已取消。');
    this.name = 'CodexExecutionAbortedError';
  }
}

export type CodexAnalyzeExecutor = (request: ProviderTaskRequest, signal?: AbortSignal) => Promise<CodexExecResult>;

function codexExecutableCandidates(): string[] {
  const homeDirectory = os.homedir();
  return buildExecutableCandidates([process.env.CODEX_BIN], 'codex', [
    path.join(homeDirectory, '.npm-global', 'bin', 'codex'),
    path.join(homeDirectory, '.local', 'bin', 'codex'),
    path.join(homeDirectory, '.codex', 'bin', 'codex'),
    path.join('/Applications/ChatGPT.app/Contents/Resources', 'codex'),
    path.join('/opt/homebrew/bin', 'codex'),
    path.join('/usr/local/bin', 'codex'),
  ]);
}

async function resolveCodexCommand() {
  const executable = await resolveExecutable(codexExecutableCandidates());
  if (!executable) throw new Error('未检测到 Codex CLI。');
  return finalizeResolvedCommand(executable);
}

export async function getCodexCliAvailability(): Promise<{ installed: boolean; authenticated: boolean }> {
  let command;
  try {
    command = await resolveCodexCommand();
  } catch {
    return { installed: false, authenticated: false };
  }
  const child = spawn(command.command, [...command.argsPrefix, 'login', 'status'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { output += chunk; });
  child.stderr.on('data', (chunk: string) => { output += chunk; });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  }).catch(() => null);
  return { installed: true, authenticated: exitCode === 0 && /logged in/i.test(output) };
}

function analysisOutputSchemaPath(): string {
  return path.join(os.tmpdir(), `lumer-codex-analysis-schema-${randomUUID()}.json`);
}

export function outputSchemaForTask(taskKind: ProviderTaskRequest['task_kind']) {
  return taskKind === 'analyze' || taskKind === 'schema_repair'
    ? codexPaperAnalysisOutputJsonSchema
    : null;
}

function parseCodexEvents(output: string, fallbackModel: string, fallbackSessionId: string | null): CodexExecResult {
  let providerSessionId: string | null = fallbackSessionId;
  let model = fallbackModel;
  let finalText: string | null = null;

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') providerSessionId = event.thread_id;
    if (event.type === 'turn.completed' && typeof event.model === 'string' && event.model.trim()) model = event.model;
    if (event.type !== 'item.completed' || !event.item || typeof event.item !== 'object') continue;
    const item = event.item as Record<string, unknown>;
    if (item.type === 'agent_message' && typeof item.text === 'string') finalText = item.text;
  }

  if (!providerSessionId) throw new Error('Codex 未返回可续接的 Session ID。');
  if (!finalText?.trim()) throw new Error('Codex 未返回最终文本。');
  return { provider_session_id: providerSessionId, model, final_text: finalText.trim() };
}

export async function executeCodexAnalyze(request: ProviderTaskRequest, signal?: AbortSignal): Promise<CodexExecResult> {
  const command = await resolveCodexCommand();
  const outputSchema = outputSchemaForTask(request.task_kind);
  const schemaPath = outputSchema ? analysisOutputSchemaPath() : null;
  if (schemaPath) await fs.writeFile(schemaPath, `${JSON.stringify(outputSchema)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    const args = request.task_kind === 'schema_repair'
      ? [
          ...command.argsPrefix,
          'exec', 'resume', '--json', '--skip-git-repo-check',
          ...(schemaPath ? ['--output-schema', schemaPath] : []),
          ...(request.model ? ['--model', request.model] : []),
          request.provider_session_id!, '-',
        ]
      : [
          ...command.argsPrefix,
          'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check',
          ...(schemaPath ? ['--output-schema', schemaPath] : []),
          ...(request.model ? ['--model', request.model] : []),
          '-',
        ];
    const child = spawn(command.command, args, { cwd: os.tmpdir(), signal, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.stdin.end(`${request.system_prompt}\n\n${request.user_input}`);
    const timeoutMs = request.task_kind === 'chat' ? null : CODEX_ANALYZE_TIMEOUT_MS;
    let timedOut = false;
    const timeout = timeoutMs === null ? null : setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', (error) => {
        if (signal?.aborted || timedOut) resolve(null);
        else reject(error);
      });
      child.once('close', resolve);
    }).finally(() => { if (timeout) clearTimeout(timeout); });
    if (signal?.aborted) throw new CodexExecutionAbortedError();
    if (timedOut) throw new CodexExecutionTimeoutError();
    if (exitCode !== 0) throw new Error(`Codex Analyze 失败（exit ${exitCode ?? 'unknown'}）。${stderr.trim() ? ` ${stderr.trim().slice(0, 300)}` : ''}`);
    return parseCodexEvents(stdout, request.model ?? 'unknown', request.provider_session_id);
  } finally {
    if (schemaPath) await fs.rm(schemaPath, { force: true });
  }
}

export class CodexAnalyzeAdapter implements ProviderTaskAdapter {
  constructor(private readonly execute: CodexAnalyzeExecutor = executeCodexAnalyze) {}

  async *run(request: ProviderTaskRequest, signal?: AbortSignal): AsyncIterable<ProviderStreamEvent> {
    try {
      const result = await this.execute(request, signal);
      yield {
        type: 'session', provider: 'codex', provider_session_id: result.provider_session_id,
        model: result.model, text: null, error_code: null,
      };
      yield {
        type: 'completed', provider: 'codex', provider_session_id: result.provider_session_id,
        model: result.model, text: result.final_text, error_code: null,
      };
    } catch (error) {
      yield {
        type: 'failed', provider: 'codex', provider_session_id: null,
        model: null, text: null,
        error_code: error instanceof CodexExecutionTimeoutError
          ? 'codex_timeout'
          : error instanceof CodexExecutionAbortedError
            ? 'codex_cancelled'
            : 'codex_exec_failed',
      };
    }
  }
}
