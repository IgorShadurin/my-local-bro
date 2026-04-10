import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { TelegramClient } from '../telegram/client.js';
import type { TelegramMessage } from '../telegram/types.js';

export interface VoiceTranscriber {
  transcribe(message: TelegramMessage): Promise<string | null>;
  transcribeBuffer(audio: Buffer, fileName?: string): Promise<string>;
}

interface ExecFileError extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

export class WhisperVoiceTranscriber implements VoiceTranscriber {
  private readonly scriptPath = resolve('scripts/transcribe-voice.sh');

  constructor(
    private readonly telegram: TelegramClient,
    private readonly logger: Logger,
    private readonly config: AppConfig['whisper'],
  ) {}

  async transcribe(message: TelegramMessage): Promise<string | null> {
    const voice = message.voice;
    if (!voice) return null;

    const model = this.config.model;
    this.logger.info('🎙️', `Transcribing voice message ${message.message_id} with ${backendName(model)} ${model}`);
    const file = await this.telegram.getFile({ file_id: voice.file_id });
    if (!file.file_path) throw new Error(`Telegram file path missing for voice message ${message.message_id}`);

    const audio = await this.telegram.downloadFile(file.file_path);
    const startedAt = Date.now();
    const transcript = await this.transcribeAudio(audio, file.file_path);
    this.logger.info('🎙️', `Voice message ${message.message_id} transcribed in ${Date.now() - startedAt}ms`);
    return transcript;
  }

  async transcribeBuffer(audio: Buffer, fileName = 'voice-input.bin'): Promise<string> {
    const startedAt = Date.now();
    const transcript = await this.transcribeAudio(audio, fileName);
    this.logger.info('🎙️', `Audio buffer ${fileName} transcribed in ${Date.now() - startedAt}ms`);
    return transcript;
  }

  private async transcribeAudio(audio: Buffer, filePath: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'my-local-bro-voice-'));
    const inputPath = join(dir, basename(filePath) || 'voice.ogg');
    try {
      await writeFile(inputPath, audio);
      const transcript = await this.runWhisper(inputPath);
      if (!transcript) throw new Error('Whisper returned an empty transcript');
      return transcript;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private runWhisper(inputPath: string): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      execFile(this.scriptPath, [inputPath], {
        timeout: 10 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          WHISPER_MODEL: this.config.model,
        },
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Whisper transcription failed: ${formatExecError(error as ExecFileError, stderr)}`));
          return;
        }
        resolvePromise(stdout.trim());
      });
    });
  }
}

function backendName(model: string): string {
  return model.startsWith('ggml-') ? 'whisper.cpp' : 'Whisper';
}

function formatExecError(error: ExecFileError, stderr: string): string {
  const detail = cleanWhisperError(stderr) || error.message;
  const code = error.code === undefined ? '' : `exit ${error.code}: `;
  return `${code}${detail}`.slice(0, 1000);
}

function cleanWhisperError(stderr: string): string {
  return stderr
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isProgressLine(line))
    .join('\n')
    .trim();
}

function isProgressLine(line: string): boolean {
  return /^\d+%[|]/.test(line) || /^\d+%.*\d+(?:\.\d+)?[KMG]i?B/.test(line);
}
