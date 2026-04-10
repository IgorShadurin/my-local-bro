import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { TelegramClient } from './client.js';
import type { TelegramBotCommand, TelegramMenuButton } from './types.js';

const COMMANDS: TelegramBotCommand[] = [
  { command: 'translate', description: 'Translate' },
  { command: 'grammar', description: 'Fix grammar' },
  { command: 'model', description: 'Model' },
  { command: 'voice_model', description: 'Voice model' },
  { command: 'normal', description: 'Normal mode' },
  { command: 'stop', description: 'Stop' },
  { command: 'stopall', description: 'Stop all' },
];

export async function setupTelegramUi(
  telegram: TelegramClient,
  config: AppConfig['telegram'],
  logger: Logger,
): Promise<void> {
  if (config.menuButton === 'none') {
    logger.info('ℹ️', 'Telegram menu button setup disabled');
    return;
  }

  try {
    await telegram.setMyCommands({ commands: COMMANDS });
    await telegram.setChatMenuButton({ menu_button: menuButton(config) });
    logger.success(`Telegram menu button configured: ${config.menuButton}`);
  } catch (error) {
    logger.error('Telegram menu button setup failed; bot will continue running', error);
  }
}

function menuButton(config: AppConfig['telegram']): TelegramMenuButton {
  if (config.menuButton === 'default') return { type: 'default' };
  if (config.menuButton === 'web_app') {
    if (!config.menuWebAppUrl) {
      throw new Error('TELEGRAM_MENU_WEB_APP_URL is required for web_app menu button');
    }
    return {
      type: 'web_app',
      text: config.menuWebAppText,
      web_app: { url: config.menuWebAppUrl },
    };
  }
  return { type: 'commands' };
}
