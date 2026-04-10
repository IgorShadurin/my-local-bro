import type { Logger } from '../logger.js';
import type { TelegramDocumentArtifact } from '../tools/types.js';
import { chunkTelegramMessage, telegramHtml } from '../util/text.js';
import type { TelegramClient } from './client.js';

export interface TelegramChatTarget {
  chatId: number;
  messageThreadId?: number;
}

export interface TelegramStatusHandle {
  messageId?: number;
}

export class TelegramStatusMessenger {
  constructor(
    private readonly telegram: TelegramClient,
    private readonly logger: Logger,
  ) {}

  async reply(target: TelegramChatTarget, text: string): Promise<void> {
    await this.telegram.sendMessage({
      chat_id: target.chatId,
      text,
      ...(target.messageThreadId ? { message_thread_id: target.messageThreadId } : {}),
    });
  }

  async startStatus(target: TelegramChatTarget, text: string): Promise<TelegramStatusHandle> {
    return this.startStatusWithOptions(target, text, {});
  }

  async startStatusWithOptions(
    target: TelegramChatTarget,
    text: string,
    options: { disableNotification?: boolean },
  ): Promise<TelegramStatusHandle> {
    try {
      const result = await this.telegram.sendMessage({
        chat_id: target.chatId,
        text: telegramHtml(text),
        parse_mode: 'HTML',
        ...(target.messageThreadId ? { message_thread_id: target.messageThreadId } : {}),
        ...(options.disableNotification ? { disable_notification: true } : {}),
      });
      return { messageId: result.message_id };
    } catch (error) {
      this.logger.warn('Tool status message failed; continuing task', error);
      return {};
    }
  }

  async finishStatus(
    target: TelegramChatTarget,
    status: TelegramStatusHandle | undefined,
    text: string,
    fallbackToNewMessage = true,
  ): Promise<void> {
    if (!status?.messageId) {
      if (fallbackToNewMessage) await this.startStatus(target, text);
      return;
    }

    try {
      await this.telegram.editMessageText({
        chat_id: target.chatId,
        message_id: status.messageId,
        text: telegramHtml(text),
        parse_mode: 'HTML',
      });
    } catch (error) {
      this.logger.warn('Tool status edit failed; continuing task', error);
    }
  }

  async updateStatus(
    target: TelegramChatTarget,
    status: TelegramStatusHandle | undefined,
    text: string,
  ): Promise<void> {
    if (!status?.messageId) return;

    try {
      await this.telegram.editMessageText({
        chat_id: target.chatId,
        message_id: status.messageId,
        text: telegramHtml(text),
        parse_mode: 'HTML',
      });
    } catch (error) {
      this.logger.warn('Tool status update failed; continuing task', error);
    }
  }

  async sendChunkedHtml(target: TelegramChatTarget, text: string): Promise<void> {
    for (const chunk of chunkTelegramMessage(text)) {
      await this.telegram.sendMessage({
        chat_id: target.chatId,
        text: telegramHtml(chunk),
        parse_mode: 'HTML',
        ...(target.messageThreadId ? { message_thread_id: target.messageThreadId } : {}),
      });
    }
  }

  async sendDocument(target: TelegramChatTarget, artifact: TelegramDocumentArtifact): Promise<void> {
    await this.telegram.sendDocument({
      chat_id: target.chatId,
      document: {
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        data: artifact.data,
      },
      ...(artifact.caption ? { caption: telegramHtml(artifact.caption), parse_mode: 'HTML' } : {}),
      ...(target.messageThreadId ? { message_thread_id: target.messageThreadId } : {}),
    });
  }
}
