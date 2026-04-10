import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { Logger } from '../logger.js';
import { loadWebhookServerConfig } from './config.js';
import { WebhookStorage } from './storage.js';
import type { WebhookInboundAudio } from './types.js';

async function main(): Promise<void> {
  const logger = new Logger();
  const config = loadWebhookServerConfig();
  const storage = new WebhookStorage(config.storagePath, config.audioDir);
  const waiters = new Set<() => void>();

  const server = createServer(async (req, res) => {
    try {
      await routeRequest(req, res, storage, config, waiters, logger);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
      logger.error('Webhook server request failed', error);
      sendJson(res, 500, { error: 'internal_error' });
    }
  });

  server.listen(config.port, config.host, () => {
    logger.success(`Webhook server listening on ${config.host}:${config.port}`);
  });

  process.on('SIGINT', () => server.close());
  process.on('SIGTERM', () => server.close());
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  storage: WebhookStorage,
  config: ReturnType<typeof loadWebhookServerConfig>,
  waiters: Set<() => void>,
  logger: Logger,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/webhook/audio' && req.method === 'POST') {
    await requirePassword(req, config.uploadPassword, 'upload');
    const inbound = await readInboundAudio(req, url, config.maxAudioBytes);
    const result = await storage.saveAudio(inbound);
    for (const notify of waiters) notify();
    logger.info('📨', `Webhook stored audio file ${result.file.id} and event ${result.event.id}`, {
      fileName: result.file.fileName,
      mimeType: result.file.mimeType,
      source: result.file.source,
      size: result.file.size,
    });
    sendJson(res, 201, {
      ok: true,
      eventId: result.event.id,
      fileId: result.file.id,
      fileName: result.file.fileName,
    });
    return;
  }

  if (pathname === '/api/webhook/events' && req.method === 'GET') {
    await requirePassword(req, config.controlPassword, 'control');
    const cursor = Number(url.searchParams.get('cursor') ?? '0');
    const timeout = Math.max(0, Math.min(Number(url.searchParams.get('timeout') ?? '25'), 55));
    const events = await waitForEvents(storage, Number.isFinite(cursor) ? cursor : 0, timeout, waiters);
    sendJson(res, 200, { events });
    return;
  }

  if (pathname === '/api/webhook/files' && req.method === 'GET') {
    await requirePassword(req, config.controlPassword, 'control');
    const files = await storage.listFiles();
    sendJson(res, 200, {
      files: files.map((file) => ({
        id: file.id,
        createdAt: file.createdAt,
        fileName: file.fileName,
        mimeType: file.mimeType,
        size: file.size,
        source: file.source,
        deletedAt: file.deletedAt,
      })),
    });
    return;
  }

  const fileMatch = pathname.match(/^\/api\/webhook\/files\/(\d+)$/);
  if (fileMatch && req.method === 'GET') {
    await requirePassword(req, config.controlPassword, 'control');
    const fileId = Number(fileMatch[1]);
    const file = await storage.getFile(fileId);
    if (!file || file.deletedAt) {
      sendJson(res, 404, { error: 'file_not_found' });
      return;
    }
    const body = await readFile(file.storedPath);
    res.statusCode = 200;
    res.setHeader('content-type', file.mimeType ?? 'application/octet-stream');
    res.setHeader('content-length', String(body.length));
    res.setHeader('content-disposition', `attachment; filename="${basename(file.fileName)}"`);
    res.end(body);
    return;
  }

  if (fileMatch && req.method === 'DELETE') {
    await requirePassword(req, config.controlPassword, 'control');
    const fileId = Number(fileMatch[1]);
    const deleted = await storage.deleteFile(fileId);
    sendJson(res, deleted ? 200 : 404, { deleted });
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

async function readInboundAudio(
  req: IncomingMessage,
  url: URL,
  maxAudioBytes: number,
): Promise<WebhookInboundAudio> {
  const contentType = firstHeader(req, 'content-type')?.split(';')[0]?.trim().toLowerCase();
  if (contentType === 'application/json') {
    return readJsonAudio(req, maxAudioBytes);
  }
  if (contentType === 'multipart/form-data' || contentType === 'application/x-www-form-urlencoded') {
    return readFormAudio(req, url, maxAudioBytes);
  }
  return readRawAudio(req, url, maxAudioBytes);
}

async function readJsonAudio(req: IncomingMessage, maxAudioBytes: number): Promise<WebhookInboundAudio> {
  const body = await readBody(req, maxAudioBytes);
  const parsed = JSON.parse(body.toString('utf8')) as {
    audioBase64?: unknown;
    fileName?: unknown;
    mimeType?: unknown;
    source?: unknown;
  };
  if (typeof parsed.audioBase64 !== 'string' || !parsed.audioBase64.trim()) {
    throw new Error('audioBase64 is required for JSON webhook uploads');
  }
  return {
    audio: Buffer.from(parsed.audioBase64, 'base64'),
    ...(typeof parsed.fileName === 'string' && parsed.fileName.trim() ? { fileName: parsed.fileName.trim() } : {}),
    ...(typeof parsed.mimeType === 'string' && parsed.mimeType.trim() ? { mimeType: parsed.mimeType.trim() } : {}),
    ...(typeof parsed.source === 'string' && parsed.source.trim() ? { source: parsed.source.trim() } : {}),
  };
}

async function readFormAudio(req: IncomingMessage, url: URL, maxAudioBytes: number): Promise<WebhookInboundAudio> {
  const request = new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: Readable.toWeb(req) as BodyInit,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const form = await request.formData();
  const file = form.get('audio') ?? form.get('file');
  if (!(file instanceof File)) {
    throw new Error('multipart webhook upload requires an audio or file field');
  }
  if (file.size > maxAudioBytes) {
    throw new Error(`request body exceeds ${maxAudioBytes} bytes`);
  }
  const source = form.get('source');
  return {
    audio: Buffer.from(await file.arrayBuffer()),
    ...(file.name ? { fileName: file.name } : {}),
    ...(file.type ? { mimeType: file.type } : {}),
    ...(typeof source === 'string' && source.trim() ? { source: source.trim() } : {}),
  };
}

async function readRawAudio(req: IncomingMessage, url: URL, maxAudioBytes: number): Promise<WebhookInboundAudio> {
  const audio = await readBody(req, maxAudioBytes);
  const headerFileName = firstHeader(req, 'x-webhook-file-name');
  const headerSource = firstHeader(req, 'x-webhook-source');
  const mimeType = firstHeader(req, 'content-type')?.split(';')[0]?.trim();
  const queryFileName = url.searchParams.get('file_name') ?? undefined;
  const querySource = url.searchParams.get('source') ?? undefined;
  return {
    audio,
    ...(headerFileName || queryFileName ? { fileName: headerFileName ?? queryFileName ?? '' } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(headerSource || querySource ? { source: headerSource ?? querySource ?? '' } : {}),
  };
}

async function waitForEvents(
  storage: WebhookStorage,
  cursor: number,
  timeoutSeconds: number,
  waiters: Set<() => void>,
): Promise<Awaited<ReturnType<WebhookStorage['getEventsAfter']>>> {
  const immediate = await storage.getEventsAfter(cursor);
  if (immediate.length > 0 || timeoutSeconds <= 0) return immediate;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(notify);
      resolve();
    }, timeoutSeconds * 1000);
    const notify = (): void => {
      clearTimeout(timer);
      waiters.delete(notify);
      resolve();
    };
    waiters.add(notify);
  });

  return storage.getEventsAfter(cursor);
}

async function requirePassword(
  req: IncomingMessage,
  expected: string,
  scope: 'upload' | 'control',
): Promise<void> {
  const password = firstHeader(req, 'x-webhook-password')
    ?? bearerToken(req)
    ?? undefined;
  if (!password || password !== expected) {
    throw new HttpError(401, `${scope}_unauthorized`);
  }
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = firstHeader(req, 'authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return undefined;
  return header.slice(7).trim();
}

function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

main().catch((error) => {
  const logger = new Logger();
  logger.error('Webhook server crashed during startup', error);
  process.exitCode = 1;
});
