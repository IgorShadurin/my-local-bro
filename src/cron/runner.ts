import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Logger } from '../logger.js';
import { truncateText } from '../util/text.js';
import type { CronReviewAgent } from './reviewAgent.js';
import type { CronTask } from './types.js';

const execFileAsync = promisify(execFile);

interface ExecFileError extends Error {
  stdout?: string;
  stderr?: string;
}

export class CronRunner {
  constructor(
    private readonly reviewAgent: CronReviewAgent,
    private readonly logger: Logger,
    private readonly timeoutMs: number,
  ) {}

  async run(task: CronTask): Promise<{ status: 'success' | 'error'; summary: string }> {
    this.logger.info('⏳', `Cron task #${task.id} started: ${safeCommandLabel(task.command)}`);
    const command = expandHome(task.command);
    let status: 'success' | 'error' = 'success';
    let output: string;

    try {
      const { stdout, stderr } = await execFileAsync(command, task.args, {
        timeout: this.timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      output = formatOutput(stdout, stderr);
      this.logger.success(`Cron task #${task.id} command completed`);
    } catch (error) {
      status = 'error';
      output = formatError(error);
      this.logger.error(`Cron task #${task.id} command failed: ${errorLabel(error)}`);
    }

    try {
      const review = await this.reviewAgent.review(task, output);
      if (status === 'success') this.logger.success(`Cron task #${task.id} completed`);
      return { status, summary: truncateText(review, 1000) };
    } catch (error) {
      this.logger.error(`Cron task #${task.id} review failed`, error);
      return { status: 'error', summary: truncateText(formatError(error), 1000) };
    }
  }
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return path;
}

function formatOutput(stdout: string, stderr: string): string {
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  return output || '(command finished with no output)';
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const execError = error as ExecFileError;
  return [
    `Command failed: ${execError.message}`,
    execError.stdout?.trim(),
    execError.stderr?.trim(),
  ].filter(Boolean).join('\n');
}

function errorLabel(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function safeCommandLabel(command: string): string {
  return command.split('/').pop() || command;
}
