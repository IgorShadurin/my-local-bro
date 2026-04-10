import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { truncateText } from '../util/text.js';
import type { ToolRuntime } from './types.js';

const execFileAsync = promisify(execFile);
const BLOCKED_COMMANDS = new Set(['bash', 'sh', 'zsh', 'fish', 'csh', 'tcsh', 'pwsh', 'powershell']);

interface ExecFileError extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function arrayArg(args: Record<string, unknown>): string[] {
  const value = args.args;
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('args must be an array of strings');
  }
  return value;
}

function cwdArg(args: Record<string, unknown>): string | undefined {
  const value = args.cwd;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('cwd must be a non-empty string when provided');
  }
  return expandHome(value.trim());
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

function assertAllowedCommand(command: string): void {
  const base = command.split('/').pop()?.toLowerCase() ?? command.toLowerCase();
  if (BLOCKED_COMMANDS.has(base)) {
    throw new Error(`Refusing to run shell interpreter: ${base}. Use command plus args instead.`);
  }
}

export function createExecTool(): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'exec',
        description: 'Execute a local program with a safe argument array. Do not use for destructive commands.',
        parameters: {
          type: 'object',
          required: ['command'],
          properties: {
            command: { type: 'string', description: 'Program to execute, for example pwd, git, npm, or find.' },
            args: { type: 'array', items: { type: 'string' }, description: 'Command arguments as separate strings.' },
            cwd: { type: 'string', description: 'Optional working directory. Supports ~ and ~/subdir.' },
          },
        },
      },
    },
    async run(args) {
      const command = stringArg(args, 'command');
      assertAllowedCommand(command);
      const commandArgs = arrayArg(args);
      const cwd = cwdArg(args);

      try {
        const { stdout, stderr } = await execFileAsync(command, commandArgs, {
          cwd,
          maxBuffer: 1024 * 1024,
          timeout: 2 * 60 * 1000,
        });
        return truncateText(JSON.stringify({ command, args: commandArgs, cwd, stdout, stderr, exitCode: 0 }, null, 2), 8000);
      } catch (error) {
        return truncateText(JSON.stringify(formatError(command, commandArgs, cwd, error), null, 2), 8000);
      }
    },
  };
}

function formatError(command: string, args: string[], cwd: string | undefined, error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { command, args, cwd, error: String(error) };
  const execError = error as ExecFileError;
  return {
    command,
    args,
    cwd,
    error: execError.message,
    exitCode: execError.code,
    stdout: execError.stdout,
    stderr: execError.stderr,
  };
}
