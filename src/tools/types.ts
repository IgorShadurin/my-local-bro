import type { Tool } from 'ollama';

export type ToolResultMode = 'direct' | 'model';

export interface TelegramDocumentArtifact {
  kind: 'telegram_document';
  fileName: string;
  mimeType: string;
  data: Buffer;
  caption?: string;
}

export interface ToolOutput {
  content: string;
  artifact?: TelegramDocumentArtifact;
}

export type ToolRunOutput = string | ToolOutput;

export interface ToolInlineMode {
  order: number;
  title: string;
  description: string;
  buildArgs(query: string): Record<string, unknown> | undefined;
}

export interface ToolDirectCommand {
  description: string;
  buildArgs(text: string): Record<string, unknown> | undefined;
}

export interface ToolRunContext {
  userId?: number;
  chatId?: number;
  messageThreadId?: number;
  requestText?: string;
  signal?: AbortSignal;
  reportProgress?: (message: string) => Promise<void>;
}

export interface ToolRuntime {
  definition: Tool;
  resultMode?: ToolResultMode;
  inline?: ToolInlineMode;
  directCommands?: ToolDirectCommand[];
  run(args: Record<string, unknown>, context?: ToolRunContext): Promise<ToolRunOutput>;
}

export type ToolRegistry = Map<string, ToolRuntime>;

export function normalizeToolOutput(output: ToolRunOutput): ToolOutput {
  return typeof output === 'string' ? { content: output } : output;
}
