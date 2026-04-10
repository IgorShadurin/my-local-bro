import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import type { RuntimeSettingsStore } from './settings.js';
import type { TelegramClient } from './telegram/client.js';
import type { TelegramCallbackQuery, TelegramMessage } from './telegram/types.js';
import { telegramHtml } from './util/text.js';

const MODEL_CALLBACK_PREFIX = 'model:set:';
const VOICE_MODEL_CALLBACK_PREFIX = 'voice-model:set:';
export const AVAILABLE_OLLAMA_MODELS = ['gemma4:26b', 'gemma4:e4b', 'gemma4:e2b'] as const;
export const AVAILABLE_WHISPER_MODELS = [
  'ggml-large-v3-turbo-q5_0',
  'ggml-large-v3-turbo',
  'tiny',
  'base',
  'small',
  'medium',
  'large-v3',
] as const;

export class ModelSelector {
  constructor(
    private readonly config: AppConfig,
    private readonly telegram: TelegramClient,
    private readonly settings: RuntimeSettingsStore,
    private readonly logger: Logger,
  ) {}

  isModelCommand(text: string | undefined): boolean {
    return this.commandName(text) === '/model';
  }

  isVoiceModelCommand(text: string | undefined): boolean {
    return this.commandName(text) === '/voice_model';
  }

  isModelCallback(query: TelegramCallbackQuery | undefined): boolean {
    return Boolean(
      query?.data?.startsWith(MODEL_CALLBACK_PREFIX)
      || query?.data?.startsWith(VOICE_MODEL_CALLBACK_PREFIX),
    );
  }

  async applySavedModel(): Promise<void> {
    const settings = await this.settings.load();
    const ollamaModel = settings.ollamaModel;
    if (ollamaModel) {
      if (!this.isAllowedModel(ollamaModel)) {
        this.logger.warn(`Saved Ollama model is not allowed and will be ignored: ${ollamaModel}`);
      } else {
        this.config.ollama.model = ollamaModel;
        this.logger.info('🤖', `Runtime settings selected Ollama model: ${ollamaModel}`);
      }
    }
    const whisperModel = settings.whisperModel;
    if (!whisperModel) return;
    if (!this.isAllowedWhisperModel(whisperModel)) {
      this.logger.warn(`Saved Whisper model is not allowed and will be ignored: ${whisperModel}`);
      return;
    }
    this.config.whisper.model = whisperModel;
    this.logger.info('🎙️', `Runtime settings selected Whisper model: ${whisperModel}`);
  }

  async handleMessage(message: TelegramMessage): Promise<boolean> {
    if (this.isModelCommand(message.text)) {
      const requested = this.commandArgs(message.text);
      if (requested) {
        await this.setModel(requested, message.chat.id, message.message_id);
        return true;
      }
      await this.sendModelPicker(message);
      return true;
    }
    if (!this.isVoiceModelCommand(message.text)) return false;
    const requested = this.commandArgs(message.text);
    if (requested) {
      await this.setVoiceModel(requested, message.chat.id, message.message_id);
      return true;
    }
    await this.sendVoiceModelPicker(message);
    return true;
  }

  async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const data = query.data ?? '';
    if (data.startsWith(MODEL_CALLBACK_PREFIX)) {
      const model = data.slice(MODEL_CALLBACK_PREFIX.length);
      if (!this.isAllowedModel(model)) {
        await this.telegram.answerCallbackQuery({ callback_query_id: query.id, text: 'Unknown model.' });
        return;
      }
      await this.settings.saveModel(model);
      this.config.ollama.model = model;
      await this.telegram.answerCallbackQuery({ callback_query_id: query.id, text: `Model set: ${model}` });
      if (query.message) {
        await this.telegram.editMessageText({
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          text: telegramHtml(`✅ Model selected: **${model}**\nApplied now and saved in runtime settings.`),
          parse_mode: 'HTML',
        });
      }
      this.logger.success(`Ollama model switched to ${model} by ${query.from.id}`);
      return;
    }
    const model = data.slice(VOICE_MODEL_CALLBACK_PREFIX.length);
    if (!this.isAllowedWhisperModel(model)) {
      await this.telegram.answerCallbackQuery({ callback_query_id: query.id, text: 'Unknown voice model.' });
      return;
    }
    await this.settings.saveWhisperModel(model);
    this.config.whisper.model = model;
    await this.telegram.answerCallbackQuery({ callback_query_id: query.id, text: `Voice model set: ${model}` });
    if (query.message) {
      await this.telegram.editMessageText({
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        text: telegramHtml(`✅ Voice model selected: **${model}**\nApplied now and saved in runtime settings.`),
        parse_mode: 'HTML',
      });
    }
    this.logger.success(`Whisper model switched to ${model} by ${query.from.id}`);
  }

  private async sendModelPicker(message: TelegramMessage): Promise<void> {
    const current = this.config.ollama.model;
    await this.telegram.sendMessage({
      chat_id: message.chat.id,
      text: telegramHtml(`Current model: **${current}**\nChoose a Gemma model:`),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: AVAILABLE_OLLAMA_MODELS.map((model) => [{
          text: model === current ? `✅ ${model}` : model,
          callback_data: `${MODEL_CALLBACK_PREFIX}${model}`,
        }]),
      },
      ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
    });
  }

  private async sendVoiceModelPicker(message: TelegramMessage): Promise<void> {
    const current = this.config.whisper.model;
    await this.telegram.sendMessage({
      chat_id: message.chat.id,
      text: telegramHtml(`Current voice model: **${current}**\nChoose a Whisper model:`),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: AVAILABLE_WHISPER_MODELS.map((model) => [{
          text: model === current ? `✅ ${model}` : model,
          callback_data: `${VOICE_MODEL_CALLBACK_PREFIX}${model}`,
        }]),
      },
      ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
    });
  }

  private async setModel(model: string, chatId: number, messageId: number): Promise<void> {
    if (!this.isAllowedModel(model)) {
      await this.telegram.sendMessage({
        chat_id: chatId,
        text: `Unknown model. Available models: ${AVAILABLE_OLLAMA_MODELS.join(', ')}`,
      });
      return;
    }
    await this.settings.saveModel(model);
    this.config.ollama.model = model;
    await this.telegram.sendMessage({
      chat_id: chatId,
      text: telegramHtml(`✅ Model selected: **${model}**`),
      parse_mode: 'HTML',
    });
    this.logger.success(`Ollama model switched to ${model} from /model command on message ${messageId}`);
  }

  private isAllowedModel(model: string): model is typeof AVAILABLE_OLLAMA_MODELS[number] {
    return AVAILABLE_OLLAMA_MODELS.includes(model as typeof AVAILABLE_OLLAMA_MODELS[number]);
  }

  private async setVoiceModel(model: string, chatId: number, messageId: number): Promise<void> {
    if (!this.isAllowedWhisperModel(model)) {
      await this.telegram.sendMessage({
        chat_id: chatId,
        text: `Unknown voice model. Available models: ${AVAILABLE_WHISPER_MODELS.join(', ')}`,
      });
      return;
    }
    await this.settings.saveWhisperModel(model);
    this.config.whisper.model = model;
    await this.telegram.sendMessage({
      chat_id: chatId,
      text: telegramHtml(`✅ Voice model selected: **${model}**`),
      parse_mode: 'HTML',
    });
    this.logger.success(`Whisper model switched to ${model} from /voice_model command on message ${messageId}`);
  }

  private isAllowedWhisperModel(model: string): model is typeof AVAILABLE_WHISPER_MODELS[number] {
    return AVAILABLE_WHISPER_MODELS.includes(model as typeof AVAILABLE_WHISPER_MODELS[number]);
  }

  private commandName(text: string | undefined): string | undefined {
    return text?.trim().split(/\s+/)[0]?.split('@')[0]?.toLowerCase();
  }

  private commandArgs(text: string | undefined): string {
    return text?.trim().replace(/^\S+\s*/, '').trim() ?? '';
  }
}
