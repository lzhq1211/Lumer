import path from 'node:path';

import {
  buildExecutableCandidates,
  resolveExecutable,
} from '@/lib/command-runtime';

export interface PythonCommand {
  readonly command: string;
  readonly argsPrefix: string[];
}

let resolvedCommand: Promise<PythonCommand> | null = null;

async function resolvePythonCommand(): Promise<PythonCommand> {
  const projectVenv = process.platform === 'win32'
    ? path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')
    : path.join(process.cwd(), '.venv', 'bin', 'python3');
  const candidates = buildExecutableCandidates(
    [process.env.LUMER_PYTHON_BIN, projectVenv],
    'python3',
    ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'],
  );
  const executable = await resolveExecutable(candidates);
  if (!executable) {
    throw new Error('未找到 Python 3；请配置 LUMER_PYTHON_BIN。');
  }
  return { command: executable, argsPrefix: [] };
}

export function getPythonCommand(): Promise<PythonCommand> {
  resolvedCommand ??= resolvePythonCommand();
  return resolvedCommand;
}

export function resetPythonCommandForTests(): void {
  resolvedCommand = null;
}
