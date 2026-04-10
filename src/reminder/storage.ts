import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ReminderCreateInput, ReminderStoreData, ReminderTask } from './types.js';

export class ReminderStorage {
  constructor(
    private readonly filePath: string,
    private readonly archiveDir: string,
  ) {}

  async list(): Promise<ReminderTask[]> {
    const data = await this.read();
    return [...data.reminders].sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id - b.id);
  }

  async create(input: ReminderCreateInput): Promise<ReminderTask> {
    const data = await this.read();
    const now = new Date().toISOString();
    const task: ReminderTask = {
      id: data.nextId,
      text: input.text,
      dueAt: normalizeDueAt(input.dueAt),
      author: input.author,
      createdAt: now,
      updatedAt: now,
    };
    data.nextId += 1;
    data.reminders.push(task);
    await this.write(data);
    return task;
  }

  async delete(id: number): Promise<ReminderTask | undefined> {
    const data = await this.read();
    const index = data.reminders.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    const task = data.reminders[index];
    if (!task) return undefined;
    data.reminders.splice(index, 1);
    await this.write(data);
    return task;
  }

  async archiveDelivered(id: number, deliveredAt: string): Promise<ReminderTask | undefined> {
    const data = await this.read();
    const index = data.reminders.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    const task = data.reminders[index];
    if (!task) return undefined;
    data.reminders.splice(index, 1);
    const delivered: ReminderTask = { ...task, deliveredAt, updatedAt: deliveredAt };
    await this.write(data);
    await this.archive(delivered);
    return delivered;
  }

  private async archive(task: ReminderTask): Promise<void> {
    await mkdir(this.archiveDir, { recursive: true });
    const fileName = `reminder-${task.id}-${task.deliveredAt?.replace(/[:.]/g, '-') ?? 'done'}.json`;
    await writeFile(join(this.archiveDir, fileName), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  }

  private async read(): Promise<ReminderStoreData> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      if (raw.trim().length === 0) {
        const initial = this.initialData();
        await this.write(initial);
        return initial;
      }
      const parsed = JSON.parse(raw) as ReminderStoreData;
      return {
        nextId: Number.isInteger(parsed.nextId) && parsed.nextId > 0 ? parsed.nextId : 1,
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
      };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        const initial = this.initialData();
        await this.write(initial);
        return initial;
      }
      throw error;
    }
  }

  private initialData(): ReminderStoreData {
    return { nextId: 1, reminders: [] };
  }

  private async write(data: ReminderStoreData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = join(dirname(this.filePath), `.${basename(this.filePath)}.tmp`);
    await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.filePath);
  }
}

function normalizeDueAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('dueAt must be a valid ISO date/time string');
  }
  return parsed.toISOString();
}
