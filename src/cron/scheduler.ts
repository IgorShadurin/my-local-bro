import type { Logger } from '../logger.js';
import { cronMatches, minuteKey } from './schedule.js';
import type { CronRunner } from './runner.js';
import type { CronTaskStorage } from './storage.js';
import type { CronTask } from './types.js';

export class CronScheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly running = new Set<number>();

  constructor(
    private readonly storage: CronTaskStorage,
    private readonly runner: CronRunner,
    private readonly logger: Logger,
    private readonly tickMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => this.logger.error('Cron tick failed', error));
    }, this.tickMs);
    this.timer.unref();
    void this.logTaskSummary().catch((error) => this.logger.error('Cron task summary failed', error));
    void this.tick().catch((error) => this.logger.error('Cron initial tick failed', error));
    this.logger.success('Cron scheduler started');
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.logger.success('Cron scheduler stopped');
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const key = minuteKey(now);
    const tasks = await this.storage.list();
    for (const task of tasks) {
      if (this.shouldRun(task, now, key)) {
        this.running.add(task.id);
        void this.runTask(task, key).finally(() => this.running.delete(task.id));
      }
    }
  }

  private async logTaskSummary(): Promise<void> {
    const tasks = await this.storage.list();
    const enabled = tasks.filter((task) => task.enabled);
    const disabled = tasks.filter((task) => !task.enabled);
    this.logger.info('⏳', `Cron tasks loaded: ${tasks.length} total, ${enabled.length} enabled, ${disabled.length} disabled`);
    if (disabled.length > 0) {
      this.logger.info('⏳', `Disabled cron task IDs: ${disabled.map((task) => `#${task.id}`).join(', ')}`);
    }
  }

  private shouldRun(task: CronTask, now: Date, key: string): boolean {
    return task.enabled
      && task.lastRunMinute !== key
      && !this.running.has(task.id)
      && cronMatches(now, task.schedule);
  }

  private async runTask(task: CronTask, key: string): Promise<void> {
    const result = await this.runner.run(task);
    await this.storage.update({
      ...task,
      updatedAt: new Date().toISOString(),
      lastRunAt: new Date().toISOString(),
      lastRunMinute: key,
      lastRunStatus: result.status,
      lastRunSummary: result.summary,
    });
  }
}
