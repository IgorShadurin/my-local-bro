import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export type LogEmoji = '✅' | '❌' | '⚠️' | 'ℹ️' | '📨' | '🤖' | '🔎' | '🧮' | '🎙️' | '⏳' | '🖼️';

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function humanTimestamp(date = new Date()): string {
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
}

export class Logger {
  constructor(private readonly logsRoot = 'logs') {}

  info(emoji: LogEmoji, message: string, meta?: unknown): void {
    this.write('log', emoji, message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write('warn', '⚠️', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write('error', '❌', message, meta);
  }

  success(message: string, meta?: unknown): void {
    this.write('log', '✅', message, meta);
  }

  private write(level: 'log' | 'warn' | 'error', emoji: LogEmoji, message: string, meta?: unknown): void {
    const line = `[${humanTimestamp()}] ${emoji.trim()} ${message.trimStart()}`;
    const formattedLine = meta === undefined ? line : `${line} ${this.formatMeta(meta)}`;
    if (meta === undefined) {
      console[level](line);
    } else {
      console[level](line, meta);
    }
    this.appendToFile(formattedLine);
  }

  private appendToFile(line: string): void {
    const now = new Date();
    const dir = join(
      this.logsRoot,
      String(now.getFullYear()),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
    );
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${pad(now.getHours())}.log`), `${line}\n`, 'utf8');
  }

  private formatMeta(meta: unknown): string {
    if (meta instanceof Error) {
      return JSON.stringify({
        name: meta.name,
        message: meta.message,
        stack: meta.stack,
      });
    }

    try {
      return JSON.stringify(meta);
    } catch {
      return String(meta);
    }
  }
}
