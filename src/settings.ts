import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger } from './logger.js';

export interface RuntimeSettings {
  ollamaModel?: string;
  whisperModel?: string;
}

export class RuntimeSettingsStore {
  constructor(private readonly path: string, private readonly logger: Logger) {}

  async load(): Promise<RuntimeSettings> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as RuntimeSettings;
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
      this.logger.warn(`Runtime settings could not be loaded from ${this.path}; using defaults`, error);
      return {};
    }
  }

  async save(settings: RuntimeSettings): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  }

  async saveModel(model: string): Promise<void> {
    const settings = await this.load();
    await this.save({ ...settings, ollamaModel: model });
  }

  async saveWhisperModel(model: string): Promise<void> {
    const settings = await this.load();
    await this.save({ ...settings, whisperModel: model });
  }
}
