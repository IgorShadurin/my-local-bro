import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { truncateText } from '../util/text.js';
import type { ToolRunContext, ToolRuntime } from './types.js';

export interface CodexToolConfig {
  command: string;
  model: string;
  reasoning: 'low' | 'medium' | 'high' | 'xhigh';
  workspace: string;
  timeoutMs: number;
  shell: string;
  sourceZshrc: boolean;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  finalMessage: string;
}

function promptArg(args: Record<string, unknown>, context: ToolRunContext | undefined): string {
  const explicit = args.prompt;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const request = context?.requestText?.trim();
  if (request) return request;
  throw new Error('prompt must be a non-empty string');
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function boundedAppend(current: string, chunk: Buffer, maxLength: number): string {
  const next = current + chunk.toString('utf8');
  return next.length <= maxLength ? next : next.slice(next.length - maxLength);
}

function buildCommand(config: CodexToolConfig, outputFile: string): string {
  const command = [
    shellQuote(config.command),
    'exec',
    '-m', shellQuote(config.model),
    '-c', shellQuote(`model_reasoning_effort="${config.reasoning}"`),
    '-C', shellQuote(expandHome(config.workspace)),
    '--skip-git-repo-check',
    '-o', shellQuote(outputFile),
    '-',
  ].join(' ');
  if (!config.sourceZshrc) return command;
  return `source ~/.zshrc >/dev/null 2>&1; ${command}`;
}

async function runCodex(prompt: string, config: CodexToolConfig, signal: AbortSignal | undefined): Promise<RunResult> {
  const workspace = expandHome(config.workspace);
  await mkdir(workspace, { recursive: true });
  const tempDir = await mkdtemp(join(tmpdir(), 'my-local-bro-codex-'));
  const outputFile = join(tempDir, 'last-message.txt');
  const child = spawn(config.shell, ['-lc', buildCommand({ ...config, workspace }, outputFile)], {
    cwd: workspace,
    detached: true,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let aborted = false;
  const maxOutput = 64 * 1024;

  const terminate = (forceAfterMs = 2_000): void => {
    if (!child.pid || child.killed) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    setTimeout(() => {
      if (child.killed) return;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, forceAfterMs).unref();
  };

  const timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, config.timeoutMs);

  const onAbort = (): void => {
    aborted = true;
    terminate(500);
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  child.stdout?.on('data', (chunk: Buffer) => {
    stdout = boundedAppend(stdout, chunk, maxOutput);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = boundedAppend(stderr, chunk, maxOutput);
  });

  child.stdin?.end(prompt);

  try {
    const result = await new Promise<RunResult>((resolveResult, reject) => {
      child.on('error', reject);
      child.on('close', async (exitCode, closeSignal) => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        try {
          const finalMessage = await readFile(outputFile, 'utf8').catch(() => '');
          resolveResult({ stdout, stderr, exitCode, signal: closeSignal, finalMessage: finalMessage.trim() });
        } catch (error) {
          reject(error);
        }
      });
    });

    if (aborted) throw new Error('codex was stopped');
    if (timedOut) throw new Error(`codex timed out after ${Math.round(config.timeoutMs / 1000)} seconds`);
    if (result.exitCode !== 0) {
      throw new Error(formatFailure(result));
    }
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
    await rm(tempDir, { recursive: true, force: true });
  }
}

function formatFailure(result: RunResult): string {
  const details = [
    `codex exited with ${result.exitCode ?? result.signal ?? 'unknown status'}`,
    result.finalMessage,
    result.stdout,
    result.stderr,
  ].filter(Boolean).join('\n');
  return truncateText(details, 2000);
}

export function createCodexTool(config: CodexToolConfig): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'codex',
        description: 'Run codex-proxy in the local Codex workspace for implementation, repository work, or coding tasks that should be delegated to Codex CLI. This can take minutes and can be stopped with /stop or /stopall.',
        parameters: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', description: 'The complete implementation or coding task prompt to pass to Codex.' },
          },
        },
      },
    },
    resultMode: 'direct',
    async run(args, context) {
      const prompt = promptArg(args, context);
      const result = await runCodex(prompt, config, context?.signal);
      const output = result.finalMessage || result.stdout.trim() || result.stderr.trim() || 'Codex finished without output.';
      return truncateText(output, 8000);
    },
  };
}
