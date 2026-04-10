import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { truncateText } from '../util/text.js';
import { normalizeSchedule } from './schedule.js';
import type { CronTask, CronTaskCreateInput, CronTaskStoreData } from './types.js';

export class CronTaskStorage {
  constructor(private readonly filePath: string) {}

  async list(): Promise<CronTask[]> {
    return (await this.read()).tasks;
  }

  async create(input: CronTaskCreateInput): Promise<CronTask> {
    const data = await this.read();
    const now = new Date().toISOString();
    const task: CronTask = {
      id: data.nextId,
      enabled: true,
      schedule: normalizeSchedule(input.schedule),
      command: input.command,
      args: input.args ?? [],
      prompt: input.prompt,
      author: input.author,
      createdAt: now,
      updatedAt: now,
    };
    data.nextId += 1;
    data.tasks.push(task);
    await this.write(data);
    return task;
  }

  async delete(id: number): Promise<boolean> {
    const data = await this.read();
    const before = data.tasks.length;
    data.tasks = data.tasks.filter((task) => task.id !== id);
    if (data.tasks.length === before) return false;
    await this.write(data);
    return true;
  }

  async setEnabled(id: number, enabled: boolean): Promise<CronTask | undefined> {
    const data = await this.read();
    const task = data.tasks.find((item) => item.id === id);
    if (!task) return undefined;
    task.enabled = enabled;
    task.updatedAt = new Date().toISOString();
    await this.write(data);
    return task;
  }

  async update(task: CronTask): Promise<void> {
    const data = await this.read();
    const index = data.tasks.findIndex((item) => item.id === task.id);
    if (index === -1) throw new Error(`Cron task #${task.id} not found`);
    data.tasks[index] = { ...task, lastRunSummary: truncateText(task.lastRunSummary ?? '', 1000) };
    await this.write(data);
  }

  private async read(): Promise<CronTaskStoreData> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      if (raw.trim().length === 0) {
        const initial = this.initialData();
        await this.write(initial);
        return initial;
      }
      const parsed = JSON.parse(raw) as CronTaskStoreData;
      return {
        nextId: Number.isInteger(parsed.nextId) && parsed.nextId > 0 ? parsed.nextId : 1,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
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

  private initialData(): CronTaskStoreData {
    return { nextId: 1, tasks: [] };
  }

  private async write(data: CronTaskStoreData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.filePath);
  }
}
