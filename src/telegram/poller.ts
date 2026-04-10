import type { AppConfig } from '../config.js';
import type { InlineQueryRouter } from '../inline.js';
import type { Logger } from '../logger.js';
import type { AsyncQueue } from '../queue.js';
import type { QueuedTask } from '../webhook/subscriber.js';
import type { CommandRouter } from '../commands.js';
import { sleep } from '../util/text.js';
import type { TelegramClient } from './client.js';
import type { TelegramCallbackQuery, TelegramInlineQuery, TelegramMessage } from './types.js';

export class TelegramPoller {
  private offset: number | undefined;
  private stopped = false;
  private pollAbortController: AbortController | undefined;

  constructor(
    private readonly client: TelegramClient,
    private readonly config: AppConfig['telegram'],
    private readonly queue: AsyncQueue<QueuedTask>,
    private readonly commands: CommandRouter,
    private readonly inlineQueries: InlineQueryRouter | undefined,
    private readonly logger: Logger,
  ) {}

  stop(): void {
    this.stopped = true;
    this.pollAbortController?.abort();
  }

  async start(): Promise<void> {
    this.logger.info('📨', 'Telegram long polling started');
    while (!this.stopped) {
      this.pollAbortController = new AbortController();
      try {
        const updates = await this.client.getUpdates({
          timeout: this.config.pollTimeoutSeconds,
          allowed_updates: this.allowedUpdates(),
          ...(this.offset !== undefined ? { offset: this.offset } : {}),
        }, this.pollAbortController.signal);
        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (this.config.enableInlineMode) this.acceptInlineQuery(update.inline_query);
          this.acceptCallbackQuery(update.callback_query);
          this.acceptUpdate(update.message);
        }
      } catch (error) {
        if (this.stopped && this.isAbortError(error)) {
          this.logger.info('✅', 'Telegram polling stopped');
          break;
        }
        this.logger.error('Telegram polling failed; retrying in 3s', error);
        await sleep(3000);
      } finally {
        this.pollAbortController = undefined;
      }
    }
  }

  private acceptUpdate(message: TelegramMessage | undefined): void {
    if (!message?.from || message.from.is_bot) return;
    if (!this.config.allowedUserIds.has(message.from.id)) {
      this.logger.warn(`Rejected unauthorized Telegram user ${message.from.id}`);
      return;
    }
    if (!message.text && !message.voice && !message.photo && !message.document) return;
    this.logger.info('📨', `Accepted message ${message.message_id} from ${message.from.id}`);
    if (this.commands.isImmediateCommand(message.text)) {
      void this.commands.handle(message).catch((error) => {
        this.logger.error('Command handling failed', error);
      });
      return;
    }
    this.queue.enqueue({ source: 'telegram', run: () => this.commands.handleQueuedMessage(message) });
  }

  private acceptInlineQuery(query: TelegramInlineQuery | undefined): void {
    if (!query?.from || query.from.is_bot) return;
    if (!this.inlineQueries) return;
    if (!this.config.allowedUserIds.has(query.from.id)) {
      this.logger.warn(`Rejected unauthorized Telegram inline user ${query.from.id}`);
      return;
    }
    void this.inlineQueries.handle(query).catch((error) => {
      this.logger.error('Inline query handling failed', error);
    });
  }

  private acceptCallbackQuery(query: TelegramCallbackQuery | undefined): void {
    if (!query?.from || query.from.is_bot) return;
    if (!this.config.allowedUserIds.has(query.from.id)) {
      this.logger.warn(`Rejected unauthorized Telegram callback user ${query.from.id}`);
      return;
    }
    void this.commands.handleCallback(query).catch((error) => {
      this.logger.error('Callback query handling failed', error);
    });
  }

  private allowedUpdates(): Array<'message' | 'inline_query' | 'callback_query'> {
    return this.config.enableInlineMode ? ['message', 'inline_query', 'callback_query'] : ['message', 'callback_query'];
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }
}
