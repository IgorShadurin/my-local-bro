import type { Ollama, Tool } from 'ollama';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { TelegramClient } from '../telegram/client.js';
import { telegramHtml, truncateText } from '../util/text.js';
import type { CronTask } from './types.js';

const SEND_MESSAGE_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'send_message',
    description: [
      'Send a Telegram message to the author of this cron task.',
      'Call this tool only if the cron task prompt explicitly says the result must be sent and the output satisfies that condition.',
      'Do not call this tool for routine output, empty output, or unmet conditions.',
    ].join(' '),
    parameters: {
      type: 'object',
      required: ['message'],
      properties: {
        message: {
          type: 'string',
          description: 'Short notification text to send after the fixed "Cron #ID Notification:" prefix.',
        },
      },
    },
  },
};

export class CronReviewAgent {
  constructor(
    private readonly client: Ollama,
    private readonly config: AppConfig['ollama'],
    private readonly telegram: TelegramClient,
    private readonly logger: Logger,
    private readonly allowSendMessageTool: boolean,
  ) {}

  async review(task: CronTask, commandOutput: string): Promise<string> {
    const response = await this.client.chat({
      model: this.config.model,
      think: this.config.thinking,
      ...(this.allowSendMessageTool ? { tools: [SEND_MESSAGE_TOOL] } : {}),
      messages: [
        {
          role: 'system',
          content: this.systemPrompt(),
        },
        {
          role: 'user',
          content: [
            `Cron task ID: ${task.id}`,
            `Task prompt: ${task.prompt}`,
            'Command output:',
            truncateText(commandOutput, 12000),
          ].join('\n\n'),
        },
      ],
    });

    const calls = response.message.tool_calls ?? [];
    const toolNames = calls.map((call) => call.function.name);
    if (!this.allowSendMessageTool) {
      this.logDecision(task.id, []);
      return 'cron review decision: no tools called; send_message disabled';
    }

    this.logDecision(task.id, toolNames);
    const sendCall = calls.find((call) => call.function.name === 'send_message');
    if (!sendCall) {
      return 'cron review decision: no tools called';
    }

    const message = this.messageArg(sendCall.function.arguments);
    await this.telegram.sendMessage({
      chat_id: task.author.chatId,
      text: telegramHtml(`Cron #${task.id} Notification:\n${message}`),
      parse_mode: 'HTML',
      ...(task.author.messageThreadId ? { message_thread_id: task.author.messageThreadId } : {}),
    });
    this.logger.success(`Cron task #${task.id} send_message completed`);
    return 'cron review decision: tool called: send_message';
  }

  private messageArg(args: Record<string, unknown>): string {
    const value = args.message;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('send_message.message must be a non-empty string');
    }
    return truncateText(value.trim(), 3500);
  }

  private systemPrompt(): string {
    const base = ['You review output from a scheduled cron task.'];
    if (!this.allowSendMessageTool) {
      return [...base, 'Notification sending is disabled. Answer with "notification tool disabled".'].join(' ');
    }
    return [
      ...base,
      'You have exactly one tool: send_message.',
      'Use send_message only when the task prompt explicitly asks to send a message and the command output satisfies that condition.',
      'If notification is needed, call send_message with a concise message only. Do not include the "Cron #ID Notification:" prefix yourself.',
      'If notification is not needed, do not call any tool and answer with "no notification".',
    ].join(' ');
  }

  private logDecision(taskId: number, toolNames: string[]): void {
    if (toolNames.length === 0) {
      this.logger.info('ℹ️', `Cron task #${taskId} review decision: no tools called`);
      return;
    }
    this.logger.info('ℹ️', `Cron task #${taskId} review decision: tools called: ${toolNames.join(', ')}`);
  }
}
