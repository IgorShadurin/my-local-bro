import { createHash } from 'node:crypto';
import type { Logger } from './logger.js';
import type { TelegramClient } from './telegram/client.js';
import type { TelegramInlineQuery, TelegramInlineQueryResultArticle } from './telegram/types.js';
import { listInlineTools } from './tools/index.js';
import { normalizeToolOutput, type ToolRegistry, type ToolRuntime } from './tools/types.js';
import { truncateText } from './util/text.js';

const INLINE_MESSAGE_LIMIT = 4096;

export class InlineQueryRouter {
  constructor(
    private readonly telegram: TelegramClient,
    private readonly tools: ToolRegistry,
    private readonly logger: Logger,
  ) {}

  async handle(query: TelegramInlineQuery): Promise<void> {
    const text = query.query.trim();
    this.logger.info('🔎', 'Inline query received', {
      fromUserId: query.from.id,
      queryId: query.id,
      text,
    });

    const results = text ? await this.buildToolResults(text) : this.buildEmptyQueryResults();
    await this.telegram.answerInlineQuery({
      inline_query_id: query.id,
      results,
      cache_time: 0,
      is_personal: true,
    });
    this.logger.success(`Answered inline query ${query.id} with ${results.length} results`);
  }

  private async buildToolResults(text: string): Promise<TelegramInlineQueryResultArticle[]> {
    const results = await Promise.all(
      listInlineTools(this.tools).map((tool) => this.runInlineTool(tool, text)),
    );
    return results.filter((result): result is TelegramInlineQueryResultArticle => Boolean(result));
  }

  private async runInlineTool(
    tool: ToolRuntime,
    text: string,
  ): Promise<TelegramInlineQueryResultArticle | undefined> {
    if (!tool.inline) return undefined;
    const name = tool.definition.function.name;
    const args = tool.inline.buildArgs(text);
    if (!name || !args) return undefined;

    try {
      this.logger.info('🔎', `Running inline tool: ${name}`);
      const output = truncateText(normalizeToolOutput(await tool.run(args)).content, INLINE_MESSAGE_LIMIT);
      return this.article({
        id: `${name}-${this.hash(text)}`,
        title: tool.inline.title,
        description: tool.inline.description,
        messageText: output || '(empty result)',
      });
    } catch (error) {
      this.logger.error(`Inline tool failed: ${name}`, error);
      return this.article({
        id: `${name}-error-${this.hash(text)}`,
        title: `${tool.inline.title} failed`,
        description: 'Open bot logs for details.',
        messageText: `The ${tool.inline.title} inline tool failed.`,
      });
    }
  }

  private buildEmptyQueryResults(): TelegramInlineQueryResultArticle[] {
    return [
      this.article({
        id: 'translate-help',
        title: 'Translate',
        description: 'Type text after the bot name, then choose this result.',
        messageText: 'Type text after the bot name, then choose Translate.',
      }),
      this.article({
        id: 'grammar-help',
        title: 'Fix grammar',
        description: 'Type text after the bot name, then choose this result.',
        messageText: 'Type text after the bot name, then choose Fix grammar.',
      }),
    ];
  }

  private article(params: {
    id: string;
    title: string;
    description: string;
    messageText: string;
  }): TelegramInlineQueryResultArticle {
    return {
      type: 'article',
      id: truncateText(params.id, 64),
      title: params.title,
      description: params.description,
      input_message_content: {
        message_text: truncateText(params.messageText, INLINE_MESSAGE_LIMIT),
      },
    };
  }

  private hash(value: string): string {
    return createHash('sha1').update(value).digest('hex').slice(0, 16);
  }
}
