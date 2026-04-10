import type { Logger } from '../logger.js';
import { sleep } from '../util/text.js';
import type {
  TelegramAllowedUpdate,
  TelegramBotCommand,
  TelegramFile,
  TelegramInlineQueryResultArticle,
  TelegramInlineKeyboardMarkup,
  TelegramMenuButton,
  TelegramMessageResult,
  TelegramResponse,
  TelegramUpdate,
} from './types.js';

interface TelegramClientOptions {
  botToken: string;
}

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(options: TelegramClientOptions, private readonly logger: Logger) {
    this.baseUrl = `https://api.telegram.org/bot${options.botToken}`;
  }

  async getUpdates(
    params: { offset?: number; timeout: number; allowed_updates?: TelegramAllowedUpdate[] },
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>('getUpdates', {
      ...params,
    }, signal);
  }

  async sendMessage(params: {
    chat_id: number;
    text: string;
    parse_mode?: 'HTML';
    message_thread_id?: number;
    reply_markup?: TelegramInlineKeyboardMarkup;
  }): Promise<TelegramMessageResult> {
    return this.call<TelegramMessageResult>('sendMessage', params);
  }

  async sendDocument(params: {
    chat_id: number;
    document: { fileName: string; mimeType: string; data: Buffer };
    caption?: string;
    parse_mode?: 'HTML';
    message_thread_id?: number;
  }): Promise<TelegramMessageResult> {
    const form = new FormData();
    form.set('chat_id', String(params.chat_id));
    const bytes = params.document.data;
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    form.set('document', new Blob([arrayBuffer], { type: params.document.mimeType }), params.document.fileName);
    if (params.caption) form.set('caption', params.caption);
    if (params.parse_mode) form.set('parse_mode', params.parse_mode);
    if (params.message_thread_id) form.set('message_thread_id', String(params.message_thread_id));
    return this.callMultipart<TelegramMessageResult>('sendDocument', form);
  }

  async editMessageText(params: {
    chat_id: number;
    message_id: number;
    text: string;
    parse_mode?: 'HTML';
    reply_markup?: TelegramInlineKeyboardMarkup;
  }): Promise<TelegramMessageResult | boolean> {
    return this.call<TelegramMessageResult | boolean>('editMessageText', params);
  }

  async sendMessageDraft(params: {
    chat_id: number;
    draft_id: number;
    text: string;
    parse_mode?: 'HTML';
    message_thread_id?: number;
  }): Promise<boolean> {
    return this.call<boolean>('sendMessageDraft', params);
  }

  async sendChatAction(params: { chat_id: number; action: 'typing' }): Promise<boolean> {
    return this.call<boolean>('sendChatAction', params);
  }

  async getFile(params: { file_id: string }): Promise<TelegramFile> {
    return this.call<TelegramFile>('getFile', params);
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl.replace('/bot', '/file/bot')}/${filePath}`);
    if (!response.ok) {
      throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async answerInlineQuery(params: {
    inline_query_id: string;
    results: TelegramInlineQueryResultArticle[];
    cache_time?: number;
    is_personal?: boolean;
  }): Promise<boolean> {
    return this.call<boolean>('answerInlineQuery', params);
  }

  async answerCallbackQuery(params: {
    callback_query_id: string;
    text?: string;
    show_alert?: boolean;
  }): Promise<boolean> {
    return this.call<boolean>('answerCallbackQuery', params);
  }

  async setMyCommands(params: { commands: TelegramBotCommand[] }): Promise<boolean> {
    return this.call<boolean>('setMyCommands', params);
  }

  async setChatMenuButton(params: { menu_button: TelegramMenuButton }): Promise<boolean> {
    return this.call<boolean>('setChatMenuButton', params);
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    attempt = 1,
  ): Promise<T> {
    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    };
    const response = await fetch(`${this.baseUrl}/${method}`, requestInit);
    const payload = await response.json() as TelegramResponse<T>;

    if (payload.ok && payload.result !== undefined) {
      return payload.result;
    }

    const retryAfter = payload.parameters?.retry_after;
    if (response.status === 429 && retryAfter && attempt <= 3) {
      this.logger.warn(`Telegram rate limit from ${method}; retrying in ${retryAfter}s`);
      await sleep(retryAfter * 1000);
      return this.call<T>(method, body, signal, attempt + 1);
    }

    throw new Error(`Telegram ${method} failed: ${payload.description ?? response.statusText}`);
  }

  private async callMultipart<T>(method: string, body: FormData): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: 'POST',
      body,
    });
    const payload = await response.json() as TelegramResponse<T>;
    if (payload.ok && payload.result !== undefined) {
      return payload.result;
    }
    throw new Error(`Telegram ${method} failed: ${payload.description ?? response.statusText}`);
  }
}
