import type { Logger } from './logger.js';
import type { ModelSelector } from './modelSelector.js';
import type { OllamaAgent } from './model/ollamaAgent.js';
import type { AsyncQueue } from './queue.js';
import type { TelegramClient } from './telegram/client.js';
import type { TelegramCallbackQuery, TelegramMessage } from './telegram/types.js';
import type { QueuedTask } from './webhook/subscriber.js';

export class CommandRouter {
  constructor(
    private readonly agent: OllamaAgent,
    private readonly queue: AsyncQueue<QueuedTask>,
    private readonly telegram: TelegramClient,
    private readonly logger: Logger,
    private readonly modelSelector: ModelSelector,
    private readonly handleMessage: (message: TelegramMessage) => Promise<void>,
    private readonly cancelCurrentExternalTask?: () => boolean,
  ) {}

  isImmediateCommand(text: string | undefined): boolean {
    const command = this.commandName(text);
    return command === '/stop' || command === '/stopall' || command === '/model' || command === '/voice_model';
  }

  async handle(message: TelegramMessage): Promise<boolean> {
    const command = this.commandName(message.text);
    if (await this.modelSelector.handleMessage(message)) return true;

    if (command === '/stop') {
      const stoppedAgent = this.agent.cancelCurrentGeneration();
      const stoppedExternal = this.cancelCurrentExternalTask?.() ?? false;
      const stopped = stoppedAgent || stoppedExternal;
      await this.reply(message, stopped ? 'Stopped the current task.' : 'No current task is running.');
      this.logger.info('✅', `Handled /stop command. Stopped active task: ${stopped}`);
      return true;
    }

    if (command === '/stopall') {
      const stopped = this.agent.cancelCurrentGeneration() || (this.cancelCurrentExternalTask?.() ?? false);
      const cleared = this.queue.clear();
      await this.reply(message, this.stopAllMessage(stopped, cleared));
      this.logger.info('✅', `Handled /stopall command. Stopped active: ${stopped}. Cleared queued: ${cleared}`);
      return true;
    }

    return false;
  }

  async handleCallback(query: TelegramCallbackQuery): Promise<boolean> {
    if (!this.modelSelector.isModelCallback(query)) return false;
    await this.modelSelector.handleCallback(query);
    return true;
  }

  async handleQueuedMessage(message: TelegramMessage): Promise<void> {
    await this.handleMessage(message);
  }

  private commandName(text: string | undefined): string | undefined {
    return text?.trim().split(/\s+/)[0]?.split('@')[0]?.toLowerCase();
  }

  private stopAllMessage(stopped: boolean, cleared: number): string {
    if (stopped && cleared > 0) return `Stopped the current task and cleared ${cleared} queued task${cleared === 1 ? '' : 's'}.`;
    if (stopped) return 'Stopped the current task. No queued tasks were waiting.';
    if (cleared > 0) return `Cleared ${cleared} queued task${cleared === 1 ? '' : 's'}. No current task was running.`;
    return 'No current task or queued tasks are running.';
  }

  private async reply(message: TelegramMessage, text: string): Promise<void> {
    await this.telegram.sendMessage({
      chat_id: message.chat.id,
      text,
      ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
    });
  }
}
