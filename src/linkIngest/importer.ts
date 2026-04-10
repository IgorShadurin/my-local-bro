import { existsSync } from 'node:fs';
import type { AppConfig } from '../config.js';
import { formatExecError, runShortsDownload } from '../downloader/shortsToProcess.js';
import type { Logger } from '../logger.js';
import type { TelegramClient } from '../telegram/client.js';
import { truncateText } from '../util/text.js';
import { findExistingMediaRecords } from './db.js';
import { normalizeLink, normalizeUrl, type NormalizedLink } from './normalize.js';
import type { BatchImportSummary, IngestBatchJob, IngestBatchRequest, PrecheckSummary } from './types.js';

interface PreparedBatch {
  normalized: NormalizedLink[];
  queued: NormalizedLink[];
  duplicatesSkipped: number;
}

export class LinkBatchImporter {
  private activeAbort: AbortController | undefined;

  constructor(
    private readonly telegram: TelegramClient,
    private readonly logger: Logger,
    private readonly config: Pick<AppConfig, 'telegram' | 'ytDownload'>,
  ) {}

  cancelCurrent(): boolean {
    if (!this.activeAbort) return false;
    this.activeAbort.abort();
    return true;
  }

  async precheckBatch(batch: IngestBatchRequest): Promise<PrecheckSummary> {
    const prepared = await this.prepareBatch(batch.links);
    return {
      source: batch.source,
      totalReceived: batch.links.length,
      uniqueLinks: prepared.normalized.length,
      duplicatesSkipped: prepared.duplicatesSkipped,
      willDownload: prepared.queued.length,
    };
  }

  async runBatch(job: IngestBatchJob): Promise<void> {
    const abort = new AbortController();
    this.activeAbort = abort;
    const prepared = await this.prepareBatch(job.links);
    const summary: BatchImportSummary = {
      batchId: job.batchId,
      source: job.source,
      totalReceived: job.links.length,
      uniqueLinks: prepared.normalized.length,
      duplicatesSkipped: prepared.duplicatesSkipped,
      downloaded: 0,
      failed: 0,
      cancelled: false,
    };

    this.logger.info('⏳', 'Link batch accepted', {
      batchId: job.batchId,
      source: job.source,
      totalReceived: summary.totalReceived,
      uniqueLinks: summary.uniqueLinks,
      duplicatesSkipped: summary.duplicatesSkipped,
      willProcess: prepared.queued.length,
    });

    await this.notifyAll(this.startMessage(summary, prepared.queued.length));
    try {
      for (const item of prepared.queued) {
        throwIfAborted(abort.signal);
        this.logger.info('🔎', `Batch download ${job.batchId}: ${item.normalizedUrl}`);
        try {
          await runShortsDownload({
            scriptPath: this.config.ytDownload.scriptPath,
            url: item.normalizedUrl,
            ...(job.category ? { category: job.category } : {}),
            signal: abort.signal,
          });
          summary.downloaded += 1;
        } catch (error) {
          throwIfAborted(abort.signal);
          summary.failed += 1;
          this.logger.error(`Batch download failed for ${item.normalizedUrl}`, error);
        }
      }
      await this.notifyAll(this.finishMessage(summary));
    } catch (error) {
      if (isAbortError(error)) {
        summary.cancelled = true;
        await this.notifyAll(this.cancelMessage(summary));
        this.logger.warn(`Batch import cancelled: ${job.batchId}`);
        return;
      }
      await this.notifyAll(this.failureMessage(summary, error));
      throw error;
    } finally {
      if (this.activeAbort === abort) this.activeAbort = undefined;
    }
  }

  private async prepareBatch(links: IngestBatchRequest['links']): Promise<PreparedBatch> {
    const normalized = dedupeLinks(links.map(normalizeLink));
    const existing = await findExistingMediaRecords(
      this.config.ytDownload.dbPath,
      normalized.map((item) => item.externalId).filter((value): value is string => Boolean(value)),
      normalized.map((item) => item.normalizedUrl),
    );
    const existingKeys = new Set(
      existing
        .filter((row) => existsSync(row.originalPath))
        .flatMap((row) => {
          const keys = [safeNormalizeUrl(row.sourceUrl)];
          if (row.mediaId) keys.push(`id:${row.mediaId}`);
          return keys;
        }),
    );
    const queued = normalized.filter((item) => !isExisting(existingKeys, item));
    return {
      normalized,
      queued,
      duplicatesSkipped: links.length - normalized.length + (normalized.length - queued.length),
    };
  }

  private startMessage(summary: BatchImportSummary, willProcess: number): string {
    return [
      '📥 Favorite links received',
      `Source: ${summary.source}`,
      `Will process ${willProcess} URLs.`,
      `Duplicates skipped: ${summary.duplicatesSkipped}`,
    ].join('\n');
  }

  private finishMessage(summary: BatchImportSummary): string {
    return [
      '✅ Favorite links processed',
      `Source: ${summary.source}`,
      `Duplicates skipped: ${summary.duplicatesSkipped}`,
      `Downloaded: ${summary.downloaded}`,
      `Failed: ${summary.failed}`,
    ].join('\n');
  }

  private cancelMessage(summary: BatchImportSummary): string {
    return [
      '⚠️ Favorite links processing cancelled',
      `Source: ${summary.source}`,
      `Duplicates skipped: ${summary.duplicatesSkipped}`,
      `Downloaded before stop: ${summary.downloaded}`,
      `Failed before stop: ${summary.failed}`,
    ].join('\n');
  }

  private failureMessage(summary: BatchImportSummary, error: unknown): string {
    return [
      '❌ Favorite links processing failed',
      `Source: ${summary.source}`,
      `Downloaded before failure: ${summary.downloaded}`,
      `Failed before failure: ${summary.failed}`,
      truncateText(formatExecError(error), 500),
    ].join('\n');
  }

  private async notifyAll(text: string): Promise<void> {
    for (const chatId of this.config.telegram.allowedUserIds) {
      await this.telegram.sendMessage({ chat_id: chatId, text });
    }
  }
}

function dedupeLinks(links: NormalizedLink[]): NormalizedLink[] {
  const seen = new Set<string>();
  const result: NormalizedLink[] = [];
  for (const link of links) {
    if (seen.has(link.dedupeKey)) continue;
    seen.add(link.dedupeKey);
    result.push(link);
  }
  return result;
}

function isExisting(existingKeys: Set<string>, item: NormalizedLink): boolean {
  if (item.externalId && existingKeys.has(`id:${item.externalId}`)) return true;
  return existingKeys.has(item.normalizedUrl);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function safeNormalizeUrl(url: string): string {
  try {
    return normalizeUrl(url);
  } catch {
    return url;
  }
}
