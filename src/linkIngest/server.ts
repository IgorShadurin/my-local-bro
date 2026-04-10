import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { AsyncQueue } from '../queue.js';
import { parseShortsCategory } from '../downloader/shortsToProcess.js';
import type { QueuedTask } from '../webhook/subscriber.js';
import type { LinkBatchImporter } from './importer.js';
import type { IngestBatchJob, IngestBatchRequest, IngestLinkItem } from './types.js';

interface LinkIngestResponse {
  ok: boolean;
  batchId?: string;
  received?: number;
  queued?: number;
  error?: string;
}

export class LinkIngestServer {
  private server = createServer((req, res) => {
    void this.handle(req, res).catch((error) => {
      this.logger.error('Link ingest request failed', error);
      if (!res.headersSent) {
        this.writeJson(res, 500, { ok: false, error: 'Internal server error' });
      }
    });
  });

  constructor(
    private readonly config: AppConfig['linkIngest'],
    private readonly queue: AsyncQueue<QueuedTask>,
    private readonly importer: LinkBatchImporter,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('ℹ️', 'Link ingest server disabled');
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.config.port, this.config.host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.logger.success(`Link ingest server listening on http://${this.config.host}:${this.config.port}`);
  }

  stop(): void {
    this.server.close();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.writeCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${this.config.host}:${this.config.port}`);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      this.writeJson(res, 200, { ok: true });
      return;
    }
    if (req.method !== 'POST' || url.pathname !== '/api/link-batches') {
      this.writeJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }
    if (!this.isAuthorized(req)) {
      this.writeJson(res, 401, { ok: false, error: 'Unauthorized' });
      return;
    }

    const payload = validateBatchRequest(await readJsonBody(req));
    const batchId = randomUUID();
    const job: IngestBatchJob = {
      ...payload,
      batchId,
      receivedAt: new Date().toISOString(),
    };
    this.queue.enqueue({
      source: 'link_ingest',
      run: () => this.importer.runBatch(job),
    });
    this.logger.info('📨', 'Link ingest batch queued', {
      batchId,
      source: job.source,
      received: job.links.length,
      category: job.category,
    });
    this.writeJson(res, 202, {
      ok: true,
      batchId,
      received: job.links.length,
      queued: job.links.length,
    });
  }

  private isAuthorized(req: IncomingMessage): boolean {
    if (!this.config.token) return true;
    return req.headers['x-link-ingest-token'] === this.config.token;
  }

  private writeCors(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Link-Ingest-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }

  private writeJson(res: ServerResponse, statusCode: number, payload: LinkIngestResponse | { ok: true }): void {
    res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.reduce((sum, part) => sum + part.length, 0) > 1024 * 1024) {
      throw new Error('Request body too large');
    }
  }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  return body ? JSON.parse(body) : {};
}

function validateBatchRequest(payload: unknown): IngestBatchRequest {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Body must be a JSON object');
  }
  const record = payload as Record<string, unknown>;
  const source = typeof record.source === 'string' && record.source.trim()
    ? record.source.trim()
    : 'extension';
  const linksRaw = Array.isArray(record.links) ? record.links : undefined;
  if (!linksRaw?.length) {
    throw new Error('links must be a non-empty array');
  }
  const links = linksRaw.map(validateLink).slice(0, 500);
  const category = parseShortsCategory(record.category);
  return {
    source,
    links,
    ...(category ? { category } : {}),
  };
}

function validateLink(value: unknown): IngestLinkItem {
  if (!value || typeof value !== 'object') {
    throw new Error('each link must be an object');
  }
  const record = value as Record<string, unknown>;
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!url) throw new Error('link url must be a non-empty string');
  const result: IngestLinkItem = { url };
  if (typeof record.platform === 'string' && record.platform.trim()) result.platform = record.platform.trim();
  if (typeof record.externalId === 'string' && record.externalId.trim()) result.externalId = record.externalId.trim();
  if (typeof record.title === 'string' && record.title.trim()) result.title = record.title.trim();
  if (typeof record.author === 'string' && record.author.trim()) result.author = record.author.trim();
  if (typeof record.takenAt === 'number' && Number.isFinite(record.takenAt)) result.takenAt = record.takenAt;
  return result;
}
