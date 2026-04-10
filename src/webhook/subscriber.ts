import { setTimeout as sleep } from 'node:timers/promises';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { AsyncQueue } from '../queue.js';
import type { WebhookSubscriberEvent } from './types.js';

export interface QueuedTask {
  source: 'telegram' | 'webhook' | 'link_ingest';
  run: () => Promise<void>;
}

export class WebhookSubscriber {
  private cursor = 0;
  private stopped = false;
  private activeAbort: AbortController | undefined;

  constructor(
    private readonly config: AppConfig['webhook'],
    private readonly queue: AsyncQueue<QueuedTask>,
    private readonly logger: Logger,
    private readonly onEvent: (event: WebhookSubscriberEvent) => Promise<void>,
  ) {}

  stop(): void {
    this.stopped = true;
    this.activeAbort?.abort();
  }

  async start(): Promise<void> {
    if (!this.config.url || !this.config.controlPassword) {
      this.logger.info('ℹ️', 'Webhook subscription disabled: WEBHOOK_URL or WEBHOOK_CONTROL_PASSWORD is not set');
      return;
    }

    this.logger.info('✅', 'Webhook subscription enabled');
    while (!this.stopped) {
      this.activeAbort = new AbortController();
      try {
        const events = await this.pollEvents(this.activeAbort.signal);
        for (const event of events) {
          this.cursor = Math.max(this.cursor, event.id);
          await this.enqueueEvent(event);
        }
      } catch (error) {
        if (this.stopped && isAbortError(error)) {
          this.logger.info('✅', 'Webhook subscription stopped');
          break;
        }
        this.logger.error('Webhook subscription failed; retrying in 3s', error);
        await sleep(3000);
      } finally {
        this.activeAbort = undefined;
      }
    }
  }

  private async enqueueEvent(event: WebhookEventPayload): Promise<void> {
    this.logger.info('📨', `Webhook event accepted ${event.id} for file ${event.fileId}`);
    const audio = await this.downloadFile(event.fileId);
    if (!audio) {
      this.logger.warn(`Skipping webhook event ${event.id}: remote file ${event.fileId} is no longer available`);
      return;
    }
    await this.deleteRemoteFile(event.fileId);
    this.queue.enqueue({
      source: 'webhook',
      run: () => this.onEvent({
        eventId: event.id,
        fileId: event.fileId,
        fileName: event.fileName,
        ...(event.mimeType ? { mimeType: event.mimeType } : {}),
        ...(event.source ? { source: event.source } : {}),
        audio,
      }),
    });
  }

  private async pollEvents(signal: AbortSignal): Promise<WebhookEventPayload[]> {
    const url = new URL('/api/webhook/events', this.config.url);
    url.searchParams.set('cursor', String(this.cursor));
    url.searchParams.set('timeout', String(this.config.pollTimeoutSeconds));
    const response = await fetch(url, {
      headers: { 'x-webhook-password': this.controlPassword() },
      signal,
    });
    if (!response.ok) throw new Error(`Webhook events request failed: HTTP ${response.status}`);
    const payload = await response.json() as { events?: WebhookEventPayload[] };
    return payload.events ?? [];
  }

  private async downloadFile(fileId: number): Promise<Buffer | undefined> {
    const url = new URL(`/api/webhook/files/${fileId}`, this.config.url);
    const response = await fetch(url, {
      headers: { 'x-webhook-password': this.controlPassword() },
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Webhook file download failed for ${fileId}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async deleteRemoteFile(fileId: number): Promise<void> {
    const url = new URL(`/api/webhook/files/${fileId}`, this.config.url);
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'x-webhook-password': this.controlPassword() },
    });
    if (!response.ok && response.status !== 404) {
      this.logger.warn(`Webhook file delete failed for ${fileId}: HTTP ${response.status}`);
      return;
    }
    this.logger.info('✅', `Webhook file deleted on remote storage: ${fileId}`);
  }

  private controlPassword(): string {
    if (!this.config.controlPassword) {
      throw new Error('WEBHOOK_CONTROL_PASSWORD is required when WEBHOOK_URL is set');
    }
    return this.config.controlPassword;
  }
}

interface WebhookEventPayload {
  id: number;
  fileId: number;
  fileName: string;
  mimeType?: string;
  source?: string;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
