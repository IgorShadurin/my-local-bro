import dotenv from 'dotenv';

dotenv.config();

export interface WebhookServerConfig {
  host: string;
  port: number;
  audioDir: string;
  storagePath: string;
  uploadPassword: string;
  controlPassword: string;
  maxAudioBytes: number;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const value = optional(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

export function loadWebhookServerConfig(): WebhookServerConfig {
  return {
    host: optional('WEBHOOK_BIND_HOST') ?? '0.0.0.0',
    port: numberEnv('WEBHOOK_PORT', 3000),
    audioDir: optional('WEBHOOK_AUDIO_DIR') ?? 'data/webhook-audio',
    storagePath: optional('WEBHOOK_STORAGE_PATH') ?? 'data/webhook-state.json',
    uploadPassword: required('WEBHOOK_UPLOAD_PASSWORD'),
    controlPassword: required('WEBHOOK_CONTROL_PASSWORD'),
    maxAudioBytes: numberEnv('WEBHOOK_MAX_AUDIO_BYTES', 20 * 1024 * 1024),
  };
}
