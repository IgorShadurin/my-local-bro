import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { GenerationCancelledError, type OllamaAgent } from '../model/ollamaAgent.js';
import type { VoiceTranscriber } from '../model/voiceTranscriber.js';
import type { TelegramClient } from '../telegram/client.js';
import { TelegramStatusMessenger } from '../telegram/status.js';
import { telegramDraftText, telegramHtml, truncateText } from '../util/text.js';
import type { WebhookSubscriberEvent } from './types.js';

export class WebhookAudioProcessor {
  private readonly messenger: TelegramStatusMessenger;

  constructor(
    private readonly config: AppConfig,
    private readonly telegram: TelegramClient,
    private readonly agent: OllamaAgent,
    private readonly transcriber: VoiceTranscriber,
    private readonly logger: Logger,
  ) {
    this.messenger = new TelegramStatusMessenger(telegram, logger);
  }

  async handle(event: WebhookSubscriberEvent): Promise<void> {
    const chatId = this.firstAllowedUser();
    const draftId = this.createDraftId(event.eventId);
    let lastDraftAt = 0;
    let lastDraftText = '';
    let directToolName: string | undefined;
    let directToolOutcome: 'success' | 'error' | undefined;
    let transcript = '';
    const statusOrder: string[] = [];
    const statusLines = new Map<string, string>();
    const activeToolSlots = new Map<string, string[]>();
    let toolSlotSeq = 0;

    this.logger.info('📨', 'Webhook audio received', {
      eventId: event.eventId,
      fileId: event.fileId,
      fileName: event.fileName,
      mimeType: event.mimeType,
      source: event.source,
      size: event.audio.length,
    });

    const renderStatus = (): string => {
      const base = `✅ Voice recognized from webhook\n\n🗣️ ${transcript}`;
      const lines = statusOrder.map((key) => statusLines.get(key)).filter((line): line is string => Boolean(line));
      if (lines.length === 0) return base;
      return `${base}\n\n──────────\n${lines.join('\n\n')}`;
    };
    const setStatus = async (key: string, line: string): Promise<void> => {
      if (!statusLines.has(key)) statusOrder.push(key);
      statusLines.set(key, line);
      await this.messenger.finishStatus({ chatId }, voiceStatus, renderStatus(), false);
    };
    const startToolSlot = (name: string): string => {
      const key = `tool:${++toolSlotSeq}`;
      const slots = activeToolSlots.get(name) ?? [];
      slots.push(key);
      activeToolSlots.set(name, slots);
      return key;
    };
    const currentToolSlot = (name: string): string => {
      const slots = activeToolSlots.get(name);
      if (slots?.length) return slots[slots.length - 1]!;
      return startToolSlot(name);
    };
    const finishToolSlot = (name: string): void => {
      const slots = activeToolSlots.get(name);
      if (!slots?.length) return;
      slots.pop();
      if (slots.length === 0) activeToolSlots.delete(name);
    };

    const voiceStatus = await this.messenger.startStatusWithOptions(
      { chatId },
      '🎙️ Webhook audio received and will be transcribed',
      { disableNotification: true },
    );
    try {
      transcript = await this.transcriber.transcribeBuffer(event.audio, event.fileName);
      await this.messenger.finishStatus({ chatId }, voiceStatus, renderStatus(), false);
    } catch (error) {
      await this.messenger.finishStatus(
        { chatId },
        voiceStatus,
        `❌ Voice recognition failed\n${this.shortError(error)}`,
      );
      throw error;
    }

    this.logger.info('🎙️', `Webhook audio ${event.eventId} will be processed as text`, {
      transcribedText: transcript,
    });

    try {
      const answer = await this.agent.generate({
        prompt: transcript,
        toolContext: {
          chatId,
          userId: chatId,
          requestText: transcript,
        },
        onToolStart: async (name) => {
          await setStatus(startToolSlot(name), `⏳ Running tool: ${name}`);
        },
        onToolProgress: async (name, progress) => {
          await setStatus(currentToolSlot(name), `⏳ ${name}\n${progress}`);
        },
        onToolDone: async (name, detail) => {
          await setStatus(currentToolSlot(name), `✅ Tool done: ${this.toolStatusLabel(name, detail)}`);
          finishToolSlot(name);
        },
        onToolError: async (name, error, detail) => {
          await setStatus(currentToolSlot(name), `❌ Tool error: ${this.toolStatusLabel(name, detail)}\n${this.shortError(error)}`);
          finishToolSlot(name);
        },
        onDirectToolResult: (name, outcome) => {
          directToolName = name;
          directToolOutcome = outcome;
        },
        onPartial: async (partial) => {
          if (!this.config.telegram.streamDrafts) return;
          const now = Date.now();
          const draftText = telegramDraftText(partial);
          if (now - lastDraftAt < 700 || draftText === lastDraftText) return;
          lastDraftAt = now;
          lastDraftText = draftText;
          await this.telegram.sendMessageDraft({
            chat_id: chatId,
            draft_id: draftId,
            text: telegramHtml(draftText),
            parse_mode: 'HTML',
          }).catch(async () => {
            await this.telegram.sendMessageDraft({
              chat_id: chatId,
              draft_id: draftId,
              text: draftText,
            });
          });
        },
      });

      if (!directToolName && this.config.telegram.streamDrafts) {
        await this.telegram.sendMessageDraft({
          chat_id: chatId,
          draft_id: draftId,
          text: telegramHtml(telegramDraftText(answer.content)),
          parse_mode: 'HTML',
        });
      }

      if (this.config.telegram.sendFinalMessage && directToolOutcome !== 'error') {
        if (answer.artifact) {
          await this.messenger.sendDocument({ chatId }, answer.artifact);
        } else {
          await this.messenger.sendChunkedHtml({ chatId }, answer.content);
        }
      }
      await setStatus('request', '✅ Request processed');
      this.logger.success(`Finished webhook event ${event.eventId}`);
    } catch (error) {
      if (error instanceof GenerationCancelledError || isAbortError(error)) {
        await setStatus('request', '⚠️ Request cancelled');
        this.logger.warn(`Cancelled webhook event ${event.eventId}`);
        return;
      }
      await setStatus('request', `❌ Request failed\n${this.shortError(error)}`);
      throw error;
    }
  }

  private createDraftId(eventId: number): number {
    return (Date.now() + eventId) % 2_147_483_647 || 1;
  }

  private firstAllowedUser(): number {
    const first = this.config.telegram.allowedUserIds.values().next().value;
    if (!first) throw new Error('No allowed Telegram user is configured');
    return first;
  }

  private shortError(error: unknown): string {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return truncateText(text, 500);
  }

  private toolStatusLabel(name: string, detail?: string): string {
    if (!detail) return name;
    return detail.includes('\n') ? `${name}\n${detail}` : `${name} - ${detail}`;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
