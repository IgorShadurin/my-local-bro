import type { Logger } from '../logger.js';
import type { TelegramClient } from '../telegram/client.js';
import type { ReminderStorage } from './storage.js';
import type { ReminderTask } from './types.js';

export class ReminderScheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly running = new Set<number>();

  constructor(
    private readonly storage: ReminderStorage,
    private readonly telegram: TelegramClient,
    private readonly logger: Logger,
    private readonly tickMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error) => this.logger.error('Reminder tick failed', error));
    }, this.tickMs);
    this.timer.unref();
    void this.logSummary().catch((error) => this.logger.error('Reminder summary failed', error));
    void this.tick().catch((error) => this.logger.error('Reminder initial tick failed', error));
    this.logger.success('Reminder scheduler started');
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.logger.success('Reminder scheduler stopped');
  }

  private async logSummary(): Promise<void> {
    const reminders = await this.storage.list();
    this.logger.info('⏳', `Reminders loaded: ${reminders.length} pending`);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const reminders = await this.storage.list();
    for (const reminder of reminders) {
      if (Date.parse(reminder.dueAt) <= now && !this.running.has(reminder.id)) {
        this.running.add(reminder.id);
        void this.deliver(reminder).finally(() => this.running.delete(reminder.id));
      }
    }
  }

  private async deliver(reminder: ReminderTask): Promise<void> {
    this.logger.info('⏳', `Reminder #${reminder.id} due; sending notification`);
    await this.telegram.sendMessage({
      chat_id: reminder.author.chatId,
      text: `⏰ Reminder #${reminder.id}:\n${reminder.text}`,
      ...(reminder.author.messageThreadId ? { message_thread_id: reminder.author.messageThreadId } : {}),
    });
    await this.storage.archiveDelivered(reminder.id, new Date().toISOString());
    this.logger.success(`Reminder #${reminder.id} delivered`);
  }
}
