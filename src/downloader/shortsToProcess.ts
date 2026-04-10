import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCallback);

export type ShortsCategory = 'hook' | 'other';

export interface ShortsDownloadOptions {
  scriptPath: string;
  url: string;
  category?: ShortsCategory;
  signal?: AbortSignal;
}

interface ExecFileError extends Error {
  stdout?: string;
  stderr?: string;
}

export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return `${homedir()}${path.slice(1)}`;
  return path;
}

export function parseShortsCategory(value: unknown): ShortsCategory | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new Error('category must be a string when provided');
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized !== 'hook' && normalized !== 'other') {
    throw new Error('category must be hook or other when provided');
  }
  return normalized as ShortsCategory;
}

export function requireUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('url must be a non-empty string');
  }
  return value.trim();
}

export async function runShortsDownload(options: ShortsDownloadOptions): Promise<string> {
  const scriptPath = expandHome(options.scriptPath);
  if (!existsSync(scriptPath)) {
    throw new Error(`Shorts downloader script not found: ${scriptPath}`);
  }
  const args = options.category ? [options.url, options.category] : [options.url];
  const { stdout, stderr } = await execFileAsync(scriptPath, args, {
    maxBuffer: 10 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const details = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  return details || 'Download finished, but the script returned no output.';
}

export function formatExecError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const execError = error as ExecFileError;
  return [execError.message, execError.stdout, execError.stderr].filter(Boolean).join('\n');
}
