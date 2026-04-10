import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { WebhookAudioEvent, WebhookAudioRecord, WebhookInboundAudio, WebhookState, WebhookUploadResult } from './types.js';

function emptyState(): WebhookState {
  return {
    nextFileId: 1,
    nextEventId: 1,
    files: [],
    events: [],
  };
}

export class WebhookStorage {
  constructor(
    private readonly storagePath: string,
    private readonly audioDir: string,
  ) {}

  async saveAudio(input: WebhookInboundAudio): Promise<WebhookUploadResult> {
    const state = await this.load();
    const fileId = state.nextFileId++;
    const eventId = state.nextEventId++;
    const fileName = normalizeFileName(fileId, input.fileName, input.mimeType);
    const storedPath = join(this.audioDir, uniqueStoredFileName(fileId, fileName));
    const createdAt = new Date().toISOString();
    const file: WebhookAudioRecord = {
      id: fileId,
      createdAt,
      fileName,
      size: input.audio.length,
      storedPath,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(input.source ? { source: input.source } : {}),
    };
    const event: WebhookAudioEvent = {
      id: eventId,
      createdAt,
      type: 'audio.received',
      fileId,
      fileName,
      size: file.size,
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      ...(file.source ? { source: file.source } : {}),
    };
    state.files.push(file);
    state.events.push(event);
    await mkdir(dirname(storedPath), { recursive: true });
    await writeFile(storedPath, input.audio);
    await this.save(state);
    return { file, event };
  }

  async getEventsAfter(cursor: number): Promise<WebhookAudioEvent[]> {
    const state = await this.load();
    return state.events.filter((event) => {
      if (event.id <= cursor) return false;
      const file = state.files.find((item) => item.id === event.fileId);
      return Boolean(file && !file.deletedAt);
    });
  }

  async listFiles(): Promise<WebhookAudioRecord[]> {
    const state = await this.load();
    return state.files;
  }

  async getFile(fileId: number): Promise<WebhookAudioRecord | undefined> {
    const state = await this.load();
    return state.files.find((file) => file.id === fileId);
  }

  async deleteFile(fileId: number): Promise<boolean> {
    const state = await this.load();
    const file = state.files.find((item) => item.id === fileId);
    if (!file || file.deletedAt) return false;
    file.deletedAt = new Date().toISOString();
    await rm(file.storedPath, { force: true });
    await this.save(state);
    return true;
  }

  private async load(): Promise<WebhookState> {
    try {
      const raw = await readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as WebhookState;
      if (!parsed || typeof parsed !== 'object') return emptyState();
      return {
        nextFileId: Number.isFinite(parsed.nextFileId) ? parsed.nextFileId : 1,
        nextEventId: Number.isFinite(parsed.nextEventId) ? parsed.nextEventId : 1,
        files: Array.isArray(parsed.files) ? parsed.files : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
    } catch {
      return emptyState();
    }
  }

  private async save(state: WebhookState): Promise<void> {
    await mkdir(dirname(this.storagePath), { recursive: true });
    await writeFile(this.storagePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
}

function normalizeFileName(id: number, original: string | undefined, mimeType: string | undefined): string {
  const cleaned = (original ?? '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const ext = cleaned ? extname(cleaned) : extensionFromMime(mimeType);
  const base = cleaned ? cleaned.slice(0, cleaned.length - ext.length) : `audio-${id}`;
  return `${base || `audio-${id}`}${ext || extensionFromMime(mimeType) || '.bin'}`;
}

function uniqueStoredFileName(id: number, fileName: string): string {
  return `${id}-${fileName}`;
}

function extensionFromMime(mimeType: string | undefined): string {
  const mime = mimeType?.toLowerCase();
  if (!mime) return '';
  if (mime.includes('mpeg')) return '.mp3';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('aac')) return '.aac';
  if (mime.includes('ogg') || mime.includes('opus')) return '.ogg';
  if (mime.includes('m4a') || mime.includes('mp4')) return '.m4a';
  if (mime.includes('x-caf') || mime.endsWith('/caf')) return '.caf';
  return '';
}
