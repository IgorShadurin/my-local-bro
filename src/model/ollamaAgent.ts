import type { ChatResponse, Message, Ollama, ToolCall } from 'ollama';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { reminderUsagePrompt } from '../tools/reminder.js';
import { truncateText } from '../util/text.js';
import { currentTimeContext } from '../util/date.js';
import { listToolDefinitions } from '../tools/index.js';
import { normalizeToolOutput, type TelegramDocumentArtifact, type ToolOutput, type ToolRegistry, type ToolResultMode, type ToolRunContext } from '../tools/types.js';

export interface GenerateOptions {
  prompt: string;
  images?: string[];
  onPartial?: (text: string) => Promise<void>;
  onToolStart?: (name: string, detail?: string) => Promise<void>;
  onToolProgress?: (name: string, progress: string) => Promise<void>;
  onToolDone?: (name: string, detail?: string) => Promise<void>;
  onToolError?: (name: string, error: string, detail?: string) => Promise<void>;
  onDirectToolResult?: (name: string, outcome: 'success' | 'error') => void;
  toolContext?: ToolRunContext;
}

export interface AgentResponse {
  content: string;
  artifact?: TelegramDocumentArtifact;
}

const MAX_TOOL_CALLS_PER_REQUEST = 10;

interface ActiveGeneration {
  cancelled: boolean;
  abortController: AbortController;
  stream?: { abort(): void };
}

interface ToolRunResult {
  message: Message;
  mode: ToolResultMode;
  content: string;
  outcome: 'success' | 'error';
  artifact?: TelegramDocumentArtifact;
}

export class GenerationCancelledError extends Error {
  constructor() {
    super('Generation cancelled');
    this.name = 'GenerationCancelledError';
  }
}

function createSystemPrompt(tools: ToolRegistry): string {
  const availableTools = [...tools.keys()].filter(Boolean).join(', ') || 'none';
  const webPrompt = tools.has('web_search') || tools.has('web_fetch')
    ? 'Use web_search for current discovery and web_fetch for reading a URL when those tools are helpful.'
    : 'Web tools are not available in this run; do not claim that you searched the web.';
  const reminderPrompt = tools.has('reminder') ? reminderUsagePrompt() : 'Reminder tool is not available in this run.';

  return [
  'You are a concise Telegram assistant.',
  currentTimeContext(),
  `Available tools: ${availableTools}.`,
  webPrompt,
  'When the user asks for current information about several independent items, do separate web_search calls for separate items instead of one combined search whenever that improves coverage.',
  'When the user asks a dependent question where one fact leads to another lookup, do follow-up web_search calls for the derived entity. Example: if you first identify a birthplace city, then do another search for that city population instead of guessing.',
  'For current populations, current leaders, current titles, or other current numeric/factual values, prefer an explicit fresh web_search for that specific item.',
  `You may use up to ${MAX_TOOL_CALLS_PER_REQUEST} tool calls in one request. Try to cover every requested item until all are covered or the tool-call limit is reached.`,
  'Use calc for adding two numbers, codex for delegated coding or implementation tasks, yt-download when a URL should be downloaded and pass category=hook or category=other when the user explicitly requests one of those categories, ls for listing files at a provided filesystem path, time for current time lookups, human_research for a public professional or creator profile report about a human, translate for translating text, grammar for fixing grammar in any language, tools for listing available tools, cron for creating, editing, deleting, listing, enabling, and disabling scheduled tasks, and reminder for one-time reminders when those tools are available.',
  'When the user starts a message with calc or asks for arithmetic, call calc; do not calculate arithmetic mentally.',
  'Use cron when the user asks to run something repeatedly or on a schedule. Convert supported human schedules like every minute/every hour/every day to a five-field crontab value before calling cron.',
  'When editing a cron task, use action=edit with the task id and only fields that must change. If the user says to keep the existing prompt and add text, pass that new text as appendPrompt.',
  reminderPrompt,
  'If the user sends only a URL, decide whether yt-download is appropriate instead of using hard-coded domain rules.',
  'For translate, from and to are optional: pass only text when the user does not specify languages. The translate tool defaults English source to Russian, Russian source to English, and other detected languages to English.',
  'Do not expose hidden thinking. Provide the final answer directly to the user.',
  ].join(' ');
}

export class OllamaAgent {
  private activeGeneration: ActiveGeneration | undefined;

  constructor(
    private readonly client: Ollama,
    private readonly config: AppConfig['ollama'],
    private readonly tools: ToolRegistry,
    private readonly logger: Logger,
  ) {}

  cancelCurrentGeneration(): boolean {
    const active = this.activeGeneration;
    if (!active) return false;
    active.cancelled = true;
    active.abortController.abort();
    active.stream?.abort();
    return true;
  }

  async generate(options: GenerateOptions): Promise<AgentResponse> {
    const active: ActiveGeneration = { cancelled: false, abortController: new AbortController() };
    this.activeGeneration = active;
    const messages: Message[] = [
      { role: 'system', content: createSystemPrompt(this.tools) },
      {
        role: 'user',
        content: options.prompt,
        ...(options.images?.length ? { images: options.images } : {}),
      },
    ];
    let visibleContent = '';
    let toolCallsUsed = 0;

    try {
      for (let step = 0; step < 8; step += 1) {
        this.throwIfCancelled(active);
        const response = await this.runStep(messages, visibleContent, active, options.onPartial);
        visibleContent = response.visibleContent;
        messages.push(response.assistantMessage);

        if (response.toolCalls.length === 0) {
          return { content: visibleContent.trim() };
        }

        for (const toolCall of response.toolCalls) {
          if (toolCallsUsed >= MAX_TOOL_CALLS_PER_REQUEST) {
            this.logger.warn(`Tool call limit reached at ${MAX_TOOL_CALLS_PER_REQUEST} calls`);
            return { content: visibleContent.trim() || `I stopped after reaching the ${MAX_TOOL_CALLS_PER_REQUEST}-tool limit.` };
          }
          toolCallsUsed += 1;
          this.throwIfCancelled(active);
          const toolResult = await this.runTool(toolCall, options, active);
          if (toolResult.mode === 'direct') {
            options.onDirectToolResult?.(toolCall.function.name, toolResult.outcome);
            return { content: toolResult.content, ...(toolResult.artifact ? { artifact: toolResult.artifact } : {}) };
          }
          messages.push(toolResult.message);
        }
      }

      this.logger.warn('Tool loop reached the maximum step count');
      return { content: visibleContent.trim() || 'I had to stop because the tool loop ran too long.' };
    } finally {
      if (this.activeGeneration === active) {
        this.activeGeneration = undefined;
      }
    }
  }

  private async runStep(
    messages: Message[],
    visibleContent: string,
    active: ActiveGeneration,
    onPartial?: (text: string) => Promise<void>,
  ): Promise<{ visibleContent: string; assistantMessage: Message; toolCalls: ToolCall[] }> {
    const stream = await this.client.chat({
      model: this.config.model,
      messages,
      tools: listToolDefinitions(this.tools),
      think: this.config.thinking,
      stream: true,
      options: { num_ctx: this.config.contextTokens },
    });
    active.stream = stream;
    this.throwIfCancelled(active);

    let stepContent = '';
    let toolCalls: ToolCall[] = [];
    let thinkingChunks = 0;
    for await (const chunk of stream as AsyncIterable<ChatResponse>) {
      this.throwIfCancelled(active);
      const content = chunk.message.content ?? '';
      if (chunk.message.thinking) {
        thinkingChunks += 1;
      }
      if (content) {
        stepContent += content;
        visibleContent += content;
        await onPartial?.(visibleContent);
        this.throwIfCancelled(active);
      }
      if (chunk.message.tool_calls?.length) {
        toolCalls = chunk.message.tool_calls;
      }
    }
    if (thinkingChunks > 0) {
      this.logger.info('🤖', `Model thinking received in ${thinkingChunks} chunks`);
    }

    return {
      visibleContent,
      assistantMessage: { role: 'assistant', content: stepContent, tool_calls: toolCalls },
      toolCalls,
    };
  }

  private async runTool(toolCall: ToolCall, options: GenerateOptions, active: ActiveGeneration): Promise<ToolRunResult> {
    const name = toolCall.function.name;
    const detail = this.toolStatusDetail(name, toolCall.function.arguments);
    const tool = this.tools.get(name);
    if (!tool) {
      this.logger.warn(`Model requested unknown tool: ${name}`);
      const content = `Tool ${name} not found`;
      await options.onToolError?.(name, content, detail);
      return {
        mode: 'model',
        content,
        outcome: 'error',
        message: { role: 'tool', tool_name: name, content },
      };
    }

    try {
      this.logger.info(name === 'calc' ? '🧮' : '🔎', `Running tool: ${name}`);
      await options.onToolStart?.(name, detail);
      const output = normalizeToolOutput(await tool.run(toolCall.function.arguments, {
        ...options.toolContext,
        signal: active.abortController.signal,
        reportProgress: async (message) => {
          await options.onToolProgress?.(name, message);
        },
      }));
      this.throwIfCancelled(active);
      this.logger.success(`Tool completed: ${name}`);
      await options.onToolDone?.(name, this.toolStatusDetailFromResult(name, detail, output));
      const truncated = truncateText(output.content, 8000);
      return {
        mode: tool.resultMode ?? 'model',
        content: truncated,
        outcome: 'success',
        ...(output.artifact ? { artifact: output.artifact } : {}),
        message: { role: 'tool', tool_name: name, content: truncated },
      };
    } catch (error) {
      this.throwIfCancelled(active);
      this.logger.error(`Tool failed: ${name}`, error);
      const content = `Tool ${name} failed: ${this.formatToolError(error)}`;
      await options.onToolError?.(name, content, detail);
      return {
        mode: 'direct',
        content,
        outcome: 'error',
        message: { role: 'tool', tool_name: name, content },
      };
    }
  }

  private throwIfCancelled(active: ActiveGeneration): void {
    if (active.cancelled) {
      active.stream?.abort();
      throw new GenerationCancelledError();
    }
  }

  private formatToolError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return truncateText(text, 500);
  }

  private toolStatusDetail(name: string, args: Record<string, unknown>): string | undefined {
    if (name === 'web_search') {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      return query ? truncateText(query, 120) : undefined;
    }
    if (name === 'web_fetch') {
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      return url ? truncateText(url, 120) : undefined;
    }
    return undefined;
  }

  private toolStatusDetailFromResult(name: string, initialDetail: string | undefined, output: ToolOutput): string | undefined {
    if (name !== 'web_search' && name !== 'human_research') return initialDetail;

    try {
      const parsed = JSON.parse(output.content) as { planned_queries?: unknown; subjectLabel?: unknown };
      const queries = Array.isArray(parsed.planned_queries)
        ? parsed.planned_queries.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      if (queries.length === 0) return initialDetail;
      const header = name === 'human_research' ? `${queries.length} research searches planned` : `${queries.length} searches planned`;
      const subject = typeof parsed.subjectLabel === 'string' && parsed.subjectLabel.trim()
        ? [`Subject: ${parsed.subjectLabel.trim()}`]
        : [];
      return [header, ...subject, ...queries.map((query, index) => `${index + 1}. ${query}`)].join('\n');
    } catch {
      return initialDetail;
    }
  }
}
