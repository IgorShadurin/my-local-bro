import type { Logger } from './logger.js';

export class AsyncQueue<T> {
  private items: T[] = [];
  private active = false;

  constructor(
    private readonly logger: Logger,
    private readonly handler: (item: T) => Promise<void>,
  ) {}

  enqueue(item: T): void {
    this.items.push(item);
    this.logger.info('⏳', `Queued task. Pending: ${this.items.length}`);
    void this.drain();
  }

  clear(): number {
    const count = this.items.length;
    this.items = [];
    this.logger.info('⏳', `Cleared queued tasks. Removed: ${count}`);
    return count;
  }

  private async drain(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      while (this.items.length > 0) {
        const item = this.items.shift();
        if (item === undefined) continue;
        try {
          await this.handler(item);
        } catch (error) {
          this.logger.error('Queued task failed', error);
        }
      }
    } finally {
      this.active = false;
    }
  }
}
