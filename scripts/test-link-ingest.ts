import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { Logger } from '../src/logger.js';
import { AsyncQueue } from '../src/queue.js';
import { LinkBatchImporter } from '../src/linkIngest/importer.js';
import { LinkIngestServer } from '../src/linkIngest/server.js';
import type { QueuedTask } from '../src/webhook/subscriber.js';

const execFile = promisify(execFileCallback);
const sqlite3Bin = process.env.SQLITE3_BIN?.trim() || '/Users/test/miniconda3/bin/sqlite3';

async function main(): Promise<void> {
  await testImporterDuplicateAndCancel();
  await testLinkIngestServer();
  console.log('Link ingest tests passed.');
}

async function testImporterDuplicateAndCancel(): Promise<void> {
  const root = join(tmpdir(), `my-local-bro-link-ingest-${Date.now()}`);
  await mkdir(root, { recursive: true });
  const dbPath = join(root, 'shorts.sqlite3');
  const originalPath = join(root, 'existing.mp4');
  const scriptPath = join(root, 'fake-video-dl.sh');
  const downloadLog = join(root, 'downloads.log');
  await writeFile(originalPath, 'existing', 'utf8');
  await writeFile(downloadLog, '', 'utf8');
  await seedDb(dbPath, originalPath);
  await writeFile(scriptPath, [
    '#!/bin/zsh',
    'if [[ "$1" == *"CANCELME"* ]]; then',
    '  sleep 10',
    'fi',
    `print -r -- "$1" >> "${downloadLog}"`,
    'print -r -- "ok"',
  ].join('\n'), 'utf8');
  await chmod(scriptPath, 0o755);

  const sent: string[] = [];
  const telegram = {
    sendMessage: async ({ text }: { text: string }) => {
      sent.push(text);
      return { message_id: sent.length } as never;
    },
    editMessageText: async ({ text }: { text: string }) => {
      sent[sent.length - 1] = text;
      return true as never;
    },
  };
  const importer = new LinkBatchImporter(telegram as never, new Logger(join(root, 'logs')), {
    telegram: { allowedUserIds: new Set([1]) } as never,
    ytDownload: { scriptPath, dbPath },
  });

  const input = {
    source: 'test',
    links: [
      { url: 'https://www.instagram.com/reel/EXIST1/', platform: 'instagram', externalId: 'EXIST1' },
      { url: 'https://www.instagram.com/reel/NEW1/', platform: 'instagram', externalId: 'NEW1' },
      { url: 'https://www.instagram.com/reel/NEW1/?foo=1', platform: 'instagram', externalId: 'NEW1' },
      { url: 'https://www.instagram.com/reel/NEW2/', platform: 'instagram', externalId: 'NEW2' },
    ],
  };

  const precheck = await importer.precheckBatch(input);
  if (precheck.willDownload !== 2) throw new Error(`Expected precheck willDownload=2, got ${precheck.willDownload}`);
  if (precheck.duplicatesSkipped !== 2) throw new Error(`Expected precheck duplicatesSkipped=2, got ${precheck.duplicatesSkipped}`);

  await importer.runBatch({
    batchId: 'batch-1',
    receivedAt: new Date().toISOString(),
    ...input,
  });

  const downloadLines = (await readFileText(downloadLog)).trim().split('\n').filter(Boolean);
  if (downloadLines.length !== 2) throw new Error(`Expected 2 downloads, got ${downloadLines.length}`);
  if (!sent[0]?.includes('Will process 2 URLs.')) throw new Error(`Unexpected start message: ${sent[0]}`);
  if (!sent[0]?.includes('Duplicates skipped: 2')) throw new Error(`Unexpected duplicate count: ${sent[0]}`);
  if (!sent[1]?.includes('Downloaded: 2')) throw new Error(`Unexpected finish message: ${sent[1]}`);

  const cancelPromise = importer.runBatch({
    batchId: 'batch-2',
    receivedAt: new Date().toISOString(),
    source: 'test-cancel',
    links: [
      { url: 'https://www.instagram.com/reel/CANCELME/', platform: 'instagram', externalId: 'CANCELME' },
      { url: 'https://www.instagram.com/reel/LATER/', platform: 'instagram', externalId: 'LATER' },
    ],
  });
  await sleep(250);
  const cancelled = importer.cancelCurrent();
  if (!cancelled) throw new Error('Expected active importer cancellation');
  await cancelPromise;
  const lastMessage = sent[sent.length - 1] || '';
  if (!lastMessage.includes('processing cancelled')) throw new Error(`Expected cancel message, got: ${lastMessage}`);

  await rm(root, { recursive: true, force: true });
}

async function testLinkIngestServer(): Promise<void> {
  const logger = new Logger(join(tmpdir(), `my-local-bro-link-ingest-logs-${Date.now()}`));
  const queued: QueuedTask[] = [];
  const queue = new AsyncQueue<QueuedTask>(logger, async () => {});
  queue.enqueue = ((item: QueuedTask) => { queued.push(item); }) as typeof queue.enqueue;
  const importer = {
    precheckBatch: async (batch: { source: string; links: { url: string }[] }) => ({
      source: batch.source,
      totalReceived: batch.links.length,
      uniqueLinks: 1,
      duplicatesSkipped: 2,
      willDownload: 3,
    }),
    runBatch: async () => {},
  };
  const server = new LinkIngestServer({ enabled: true, host: '127.0.0.1', port: 45124 }, queue, importer as never, logger);
  await server.start();
  try {
    const health = await fetch('http://127.0.0.1:45124/healthz');
    if (!health.ok) throw new Error(`Health check failed: ${health.status}`);

    const precheckResponse = await fetch('http://127.0.0.1:45124/api/link-batches/precheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'instagram_saved_posts',
        links: [{ url: 'https://www.instagram.com/reel/ABC123/', platform: 'instagram', externalId: 'ABC123' }],
      }),
    });
    const precheckPayload = await precheckResponse.json() as { ok?: boolean; summary?: { willDownload?: number } };
    if (precheckResponse.status !== 200 || !precheckPayload.ok || precheckPayload.summary?.willDownload !== 3) {
      throw new Error(`Unexpected precheck response: ${precheckResponse.status} ${JSON.stringify(precheckPayload)}`);
    }

    const importResponse = await fetch('http://127.0.0.1:45124/api/link-batches/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'instagram_saved_posts',
        links: [{ url: 'https://www.instagram.com/reel/ABC123/', platform: 'instagram', externalId: 'ABC123' }],
      }),
    });
    const importPayload = await importResponse.json() as { ok?: boolean };
    if (importResponse.status !== 202 || !importPayload.ok) {
      throw new Error(`Unexpected import response: ${importResponse.status} ${JSON.stringify(importPayload)}`);
    }
    if (queued.length !== 1) throw new Error(`Expected 1 queued task, got ${queued.length}`);
  } finally {
    server.stop();
  }
}

async function seedDb(dbPath: string, originalPath: string): Promise<void> {
  const sql = [
    'CREATE TABLE media_files (',
    'media_id TEXT PRIMARY KEY,',
    'source_url TEXT NOT NULL,',
    'resolved_url TEXT,',
    'title TEXT,',
    'author TEXT,',
    'platform TEXT,',
    'category TEXT,',
    'parent_dir TEXT NOT NULL,',
    'slot TEXT NOT NULL,',
    'dir_path TEXT NOT NULL,',
    'original_path TEXT NOT NULL,',
    'converted_path TEXT NOT NULL,',
    'original_size_bytes INTEGER,',
    'converted_size_bytes INTEGER,',
    'created_at TEXT NOT NULL,',
    'updated_at TEXT NOT NULL',
    ');',
    `INSERT INTO media_files (media_id, source_url, parent_dir, slot, dir_path, original_path, converted_path, created_at, updated_at) VALUES ('EXIST1', 'https://www.instagram.com/reel/EXIST1/', '/tmp', '001', '/tmp/001', '${escapeSql(originalPath)}', '/tmp/001/reference.mp4', '2026-04-10T00:00:00Z', '2026-04-10T00:00:00Z');`,
  ].join(' ');
  await execFile(sqlite3Bin, [dbPath, sql]);
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

async function readFileText(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
