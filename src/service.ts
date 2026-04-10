import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import { GenerationCancelledError, type OllamaAgent } from './model/ollamaAgent.js';
import type { VoiceTranscriber } from './model/voiceTranscriber.js';
import type { TelegramClient } from './telegram/client.js';
import { TelegramRequestStatus } from './telegram/requestStatus.js';
import { TelegramStatusMessenger, type TelegramStatusHandle } from './telegram/status.js';
import type { TelegramMessage, TelegramPhotoSize } from './telegram/types.js';
import { normalizeToolOutput, type ToolRegistry } from './tools/types.js';
import { telegramDraftText, telegramHtml } from './util/text.js';

type ToolMode = 'translate' | 'grammar';

interface ResolvedInput {
  text: string;
  images?: string[];
}

const DEFAULT_IMAGE_PROMPT = [
  'The image is attached to this message. Do not ask the user to provide it again.',
  'Extract all visible text exactly first. Then briefly describe what the image shows and answer with the most relevant details.',
].join(' ');

export class BotService {
  private readonly modeByUser = new Map<number, ToolMode>();
  private readonly messenger: TelegramStatusMessenger;

  constructor(
    private readonly config: AppConfig,
    private readonly telegram: TelegramClient,
    private readonly agent: OllamaAgent,
    private readonly transcriber: VoiceTranscriber,
    private readonly tools: ToolRegistry,
    private readonly logger: Logger,
  ) {
    this.messenger = new TelegramStatusMessenger(telegram, logger);
  }

  async handle(message: TelegramMessage): Promise<void> {
    this.logger.info('📨', 'Input message received', {
      chatId: message.chat.id,
      chatType: message.chat.type,
      fromUserId: message.from?.id,
      messageId: message.message_id,
      text: message.text,
      caption: message.caption,
      hasVoice: Boolean(message.voice),
      hasImage: this.hasImage(message),
    });

    const input = await this.resolveInput(message);
    if (!input) return;
    if (!input.images?.length && await this.handleToolMode(message, input.text)) return;
    if (!input.images?.length && await this.handleDirectToolCommand(message, input.text)) return;

    await this.runAssistantRequest(message, input.text, input.images);
  }

  private async runAssistantRequest(message: TelegramMessage, text: string, images?: string[]): Promise<void> {
    this.logger.info('🤖', `Processing message ${message.message_id}`);
    const target = this.target(message);
    const draftId = this.createDraftId(message.message_id);
    let lastDraftAt = 0;
    let lastDraftText = '';
    const requestStatus = new TelegramRequestStatus(this.messenger, target);
    const toolSlots = new Map<string, string[]>();
    let directToolName: string | undefined;
    let directToolOutcome: 'success' | 'error' | undefined;

    try {
      await requestStatus.start('⏳ Processing request');
      const answer = await this.agent.generate({
        prompt: text,
        ...(images?.length ? { images } : {}),
        toolContext: {
          chatId: message.chat.id,
          requestText: text,
          ...(message.from?.id ? { userId: message.from.id } : {}),
          ...(message.message_thread_id ? { messageThreadId: message.message_thread_id } : {}),
        },
        onToolStart: async (name, detail) => {
          const key = await requestStatus.startTool(`Running tool: ${this.toolStatusLabel(name, detail)}`);
          const slots = toolSlots.get(name) ?? [];
          slots.push(key);
          toolSlots.set(name, slots);
        },
        onToolProgress: async (name, progress) => {
          await requestStatus.updateTool(this.currentToolSlot(toolSlots, name), `Running tool: ${name}\n${progress}`);
        },
        onToolDone: async (name, detail) => {
          await requestStatus.finishTool(this.currentToolSlot(toolSlots, name), `✅ Tool done: ${this.toolStatusLabel(name, detail)}`);
          this.finishToolSlot(toolSlots, name);
        },
        onToolError: async (name, error, detail) => {
          await requestStatus.finishTool(this.currentToolSlot(toolSlots, name), `❌ Tool error: ${this.toolStatusLabel(name, detail)}\n${this.shortError(error)}`);
          this.finishToolSlot(toolSlots, name);
        },
        onDirectToolResult: (name, outcome) => {
          directToolName = name;
          directToolOutcome = outcome;
        },
        onPartial: async (partial) => {
          if (!this.config.telegram.streamDrafts || message.chat.type !== 'private') return;
          const now = Date.now();
          const draftText = telegramDraftText(partial);
          if (now - lastDraftAt < 700 || draftText === lastDraftText) return;
          lastDraftAt = now;
          lastDraftText = draftText;
          await this.telegram.sendMessageDraft({
            chat_id: message.chat.id,
            draft_id: draftId,
            text: telegramHtml(draftText),
            parse_mode: 'HTML',
            ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
          }).catch(async (error) => {
            this.logger.warn('Formatted draft failed; retrying as plain text', error);
            await this.telegram.sendMessageDraft({
              chat_id: message.chat.id,
              draft_id: draftId,
              text: draftText,
              ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
            });
          });
        },
      });

      if (!directToolName && this.config.telegram.streamDrafts && message.chat.type === 'private') {
        await this.telegram.sendMessageDraft({
          chat_id: message.chat.id,
          draft_id: draftId,
          text: telegramHtml(telegramDraftText(answer.content)),
          parse_mode: 'HTML',
          ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}),
        });
      }

      if (this.config.telegram.sendFinalMessage && directToolOutcome !== 'error') {
        if (answer.artifact) {
          await this.messenger.sendDocument(target, answer.artifact);
        } else {
          await this.messenger.sendChunkedHtml(target, answer.content);
        }
      }
      await requestStatus.setRequest('✅ Request processed');
      this.logger.success(`Finished message ${message.message_id}`);
    } catch (error) {
      if (error instanceof GenerationCancelledError || this.isAbortError(error)) {
        await requestStatus.setRequest('⚠️ Request cancelled');
        this.logger.warn(`Cancelled message ${message.message_id}`);
        return;
      }
      await requestStatus.setRequest(`❌ Request failed\n${this.shortError(error)}`);
      throw error;
    }
  }

  private createDraftId(messageId: number): number {
    return (Date.now() + messageId) % 2_147_483_647 || 1;
  }

  private async resolveInput(message: TelegramMessage): Promise<ResolvedInput | undefined> {
    let images: string[];
    try {
      images = await this.resolveImages(message);
    } catch (error) {
      this.logger.error(`Image preparation failed for message ${message.message_id}`, error);
      await this.messenger.reply(this.target(message), `Image processing failed: ${this.shortError(error)}`);
      return undefined;
    }
    const text = message.text?.trim()
      || message.caption?.trim()
      || (images.length ? DEFAULT_IMAGE_PROMPT : undefined);
    if (text) return images.length ? { text, images } : { text };

    let transcript: string | null;
    let status: TelegramStatusHandle | undefined;
    try {
      if (message.voice) {
        status = await this.messenger.startStatus(this.target(message), '🎙️ Recognizing voice message');
      }
      transcript = await this.transcriber.transcribe(message);
      await this.messenger.finishStatus(
        this.target(message),
        status,
        transcript ? `✅ Voice recognized\n${transcript}` : '✅ Voice recognized',
        false,
      );
    } catch (error) {
      this.logger.error(`Voice transcription failed for message ${message.message_id}`, error);
      await this.messenger.finishStatus(this.target(message), status, `❌ Voice recognition failed\n${this.shortError(error)}`);
      return undefined;
    }
    if (!transcript) return undefined;
    this.logger.info('🎙️', `Voice message ${message.message_id} will be processed as text`, {
      transcribedText: transcript,
    });
    return { text: transcript };
  }

  private async resolveImages(message: TelegramMessage): Promise<string[]> {
    const fileIds = this.imageFileIds(message);
    if (fileIds.length === 0) return [];
    this.logger.info('🖼️', `Downloading ${fileIds.length} image attachment${fileIds.length === 1 ? '' : 's'} from message ${message.message_id}`);
    const images: string[] = [];
    for (const fileId of fileIds) {
      const file = await this.telegram.getFile({ file_id: fileId });
      if (!file.file_path) throw new Error(`Telegram file path missing for image in message ${message.message_id}`);
      images.push((await this.telegram.downloadFile(file.file_path)).toString('base64'));
    }
    this.logger.info('🖼️', `Prepared ${images.length} image attachment${images.length === 1 ? '' : 's'} for message ${message.message_id}`);
    return images;
  }

  private imageFileIds(message: TelegramMessage): string[] {
    const ids: string[] = [];
    const photo = this.bestPhoto(message.photo);
    if (photo) ids.push(photo.file_id);
    if (message.document?.mime_type?.startsWith('image/')) ids.push(message.document.file_id);
    return ids;
  }

  private bestPhoto(photo: TelegramPhotoSize[] | undefined): TelegramPhotoSize | undefined {
    if (!photo?.length) return undefined;
    return [...photo].sort((a, b) => this.photoScore(b) - this.photoScore(a))[0];
  }

  private photoScore(photo: TelegramPhotoSize): number {
    return photo.file_size ?? photo.width * photo.height;
  }

  private hasImage(message: TelegramMessage): boolean {
    return Boolean(message.photo?.length || message.document?.mime_type?.startsWith('image/'));
  }

  private async handleToolMode(message: TelegramMessage, text: string): Promise<boolean> {
    const userId = message.from?.id;
    if (!userId) return false;

    const command = this.commandName(text);
    if (command === '/translate' || command === '/grammar') {
      const mode = command.slice(1) as ToolMode;
      const inlineText = this.commandArgs(text);
      this.modeByUser.set(userId, mode);
      if (inlineText) {
        await this.runDirectToolMode(message, mode, inlineText);
        return true;
      }
      await this.messenger.reply(this.target(message), `${this.modeLabel(mode)} mode enabled. Send the text you want to process.`);
      return true;
    }

    if (command === '/normal' || command === '/cancel') {
      this.modeByUser.delete(userId);
      await this.messenger.reply(this.target(message), 'Normal assistant mode enabled.');
      return true;
    }

    const mode = this.modeByUser.get(userId);
    if (!mode || command) return false;
    await this.runDirectToolMode(message, mode, text);
    return true;
  }

  private async runDirectToolMode(message: TelegramMessage, mode: ToolMode, text: string): Promise<void> {
    const tool = this.tools.get(mode);
    if (!tool) {
      await this.messenger.reply(this.target(message), `${this.modeLabel(mode)} tool is not available.`);
      return;
    }

    this.logger.info('🔎', `Running ${mode} mode for message ${message.message_id}`);
    const target = this.target(message);
    const status = new TelegramRequestStatus(this.messenger, target);
    await status.start('⏳ Processing request');
    const toolSlot = await status.startTool(`Running tool: ${mode}`);
    let output: ReturnType<typeof normalizeToolOutput>;
    try {
      output = normalizeToolOutput(await tool.run({ text }));
      await status.finishTool(toolSlot, `✅ Tool done: ${mode}`);
      await status.setRequest('✅ Request processed');
    } catch (error) {
      await status.finishTool(toolSlot, `❌ Tool error: ${mode}\n${this.shortError(error)}`);
      await status.setRequest(`❌ Request failed\n${this.shortError(error)}`);
      throw error;
    }
    if (output.artifact) {
      await this.messenger.sendDocument(target, output.artifact);
    } else {
      await this.messenger.sendChunkedHtml(target, output.content);
    }
    this.logger.success(`Finished ${mode} mode message ${message.message_id}`);
  }

  private async handleDirectToolCommand(message: TelegramMessage, text: string): Promise<boolean> {
    for (const tool of this.tools.values()) {
      for (const directCommand of tool.directCommands ?? []) {
        const args = directCommand.buildArgs(text);
        if (!args) continue;
        await this.runDirectToolCommand(message, tool.definition.function.name ?? 'tool', args, text);
        return true;
      }
    }
    return false;
  }

  private async runDirectToolCommand(
    message: TelegramMessage,
    toolName: string,
    args: Record<string, unknown>,
    requestText: string,
  ): Promise<void> {
    const tool = this.tools.get(toolName);
    if (!tool) throw new Error(`Direct tool ${toolName} is not registered`);

    this.logger.info('🔎', `Running ${toolName} directly for message ${message.message_id}`);
    const target = this.target(message);
    const status = new TelegramRequestStatus(this.messenger, target);
    await status.start('⏳ Processing request');
    const toolSlot = await status.startTool(`Running tool: ${toolName}`);
    let output: ReturnType<typeof normalizeToolOutput>;
    try {
      output = normalizeToolOutput(await tool.run(args, {
        chatId: message.chat.id,
        requestText,
        ...(message.from?.id ? { userId: message.from.id } : {}),
        ...(message.message_thread_id ? { messageThreadId: message.message_thread_id } : {}),
      }));
      await status.finishTool(toolSlot, `✅ Tool done: ${toolName}`);
      await status.setRequest('✅ Request processed');
    } catch (error) {
      await status.finishTool(toolSlot, `❌ Tool error: ${toolName}\n${this.shortError(error)}`);
      await status.setRequest(`❌ Request failed\n${this.shortError(error)}`);
      throw error;
    }

    if (output.artifact) {
      await this.messenger.sendDocument(target, output.artifact);
    } else {
      await this.messenger.sendChunkedHtml(target, output.content);
    }
    this.logger.success(`Finished direct ${toolName} message ${message.message_id}`);
  }

  private shortError(error: unknown): string {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return text.length <= 500 ? text : `${text.slice(0, 499)}…`;
  }

  private commandName(text: string): string | undefined {
    const first = text.trim().split(/\s+/)[0];
    if (!first?.startsWith('/')) return undefined;
    return first.split('@')[0]?.toLowerCase();
  }

  private commandArgs(text: string): string {
    return text.trim().replace(/^\S+\s*/, '').trim();
  }

  private modeLabel(mode: ToolMode): string {
    return mode === 'translate' ? 'Translate' : 'Grammar';
  }

  private toolStatusLabel(name: string, detail?: string): string {
    if (!detail) return name;
    return detail.includes('\n') ? `${name}\n${detail}` : `${name} - ${detail}`;
  }

  private currentToolSlot(toolSlots: Map<string, string[]>, name: string): string {
    const slots = toolSlots.get(name);
    if (slots?.length) return slots[slots.length - 1]!;
    return `tool:missing:${name}`;
  }

  private finishToolSlot(toolSlots: Map<string, string[]>, name: string): void {
    const slots = toolSlots.get(name);
    if (!slots?.length) return;
    slots.pop();
    if (slots.length === 0) toolSlots.delete(name);
  }

  private target(message: TelegramMessage): { chatId: number; messageThreadId?: number } {
    return {
      chatId: message.chat.id,
      ...(message.message_thread_id ? { messageThreadId: message.message_thread_id } : {}),
    };
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }
}
