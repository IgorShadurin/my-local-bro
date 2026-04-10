import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { TelegramClient } from './client.js';

export async function notifyOwnersServiceStarted(
  telegram: TelegramClient,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  const webhookStatus = config.webhook.url ? '✅ enabled' : '❌ disabled';
  const text = [
    '✅ MyLocalBro started',
    `Model: ${config.ollama.model}`,
    `Voice model: ${config.whisper.model}`,
    `Webhook: ${webhookStatus}`,
  ].join('\n');
  for (const userId of config.telegram.allowedUserIds) {
    try {
      await telegram.sendMessage({ chat_id: userId, text, disable_notification: true });
      logger.success(`Startup notification sent to ${userId}`);
    } catch (error) {
      logger.warn(`Startup notification failed for ${userId}`, error);
    }
  }
}
