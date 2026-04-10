import type { Ollama } from 'ollama';
import type { AppConfig } from '../config.js';
import type { CronTaskStorage } from '../cron/storage.js';
import type { ReminderStorage } from '../reminder/storage.js';
import { createCalcTool } from './calc.js';
import { createCodexTool } from './codex.js';
import { createCronTool } from './cron.js';
// import { createExecTool } from './exec.js';
import { createGrammarTool } from './grammar.js';
import { createHumanResearchTool } from './humanResearch.js';
import { createLsTool } from './ls.js';
import { createReminderTool } from './reminder.js';
import { createTimeTool } from './time.js';
import { createUuidTool } from './uuid.js';
import { createWebFetchTool, createWebSearchTool } from './web.js';
import { createTranslateTool } from './translate.js';
import { createToolListTool } from './toolList.js';
import type { ToolRegistry, ToolRuntime } from './types.js';
import { createYtDownloadTool } from './ytDownload.js';

export interface ToolRegistryOptions {
  cronStorage?: CronTaskStorage;
  reminderStorage?: ReminderStorage;
  codex: AppConfig['codex'];
  ytDownload: AppConfig['ytDownload'];
  enableWebTools: boolean;
  enableHumanResearch: boolean;
}

export function createToolRegistry(client: Ollama, model: () => string, options: ToolRegistryOptions): ToolRegistry {
  const registry: ToolRegistry = new Map();
  const tools = [
    createCalcTool(),
    createCodexTool(options.codex),
    ...(options.enableWebTools ? [
      createWebSearchTool(client, model),
      createWebFetchTool(),
    ] : []),
    createYtDownloadTool(options.ytDownload),
    createLsTool(),
    createTimeTool(),
    createUuidTool(),
    ...(options.enableHumanResearch ? [createHumanResearchTool(client, model)] : []),
    createTranslateTool(client, model),
    createGrammarTool(client, model),
    ...(options.cronStorage ? [createCronTool(options.cronStorage)] : []),
    ...(options.reminderStorage ? [createReminderTool(options.reminderStorage)] : []),
    // createExecTool(),
  ];
  for (const tool of tools) {
    registry.set(tool.definition.function.name ?? '', tool);
  }
  registry.set('tools', createToolListTool(() => registry));
  return registry;
}

export function listToolDefinitions(registry: ToolRegistry): ToolRuntime['definition'][] {
  return [...registry.values()].map((tool) => tool.definition);
}

export function listInlineTools(registry: ToolRegistry): ToolRuntime[] {
  return [...registry.values()]
    .filter((tool) => tool.inline)
    .sort((a, b) => (a.inline?.order ?? 0) - (b.inline?.order ?? 0));
}
