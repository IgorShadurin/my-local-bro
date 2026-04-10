import type { CronTaskStorage } from '../cron/storage.js';
import { normalizeSchedule } from '../cron/schedule.js';
import type { CronTask, CronTaskAuthor } from '../cron/types.js';
import { truncateText } from '../util/text.js';
import type { ToolRunContext, ToolRuntime } from './types.js';

type CronControlArgs = { action: 'list' } | { action: 'delete' | 'disable' | 'enable'; id: number };

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function optionalStringArrayArg(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function intArg(args: Record<string, unknown>, key: string): number {
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function authorFromContext(context: ToolRunContext | undefined): CronTaskAuthor {
  if (!context?.userId || !context.chatId) {
    throw new Error('Cron task creation requires Telegram user and chat context');
  }
  return {
    userId: context.userId,
    chatId: context.chatId,
    ...(context.messageThreadId ? { messageThreadId: context.messageThreadId } : {}),
  };
}

export function createCronTool(storage: CronTaskStorage): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'cron',
        description: [
          'Create, delete, list, enable, and disable persistent scheduled cron tasks.',
          'Use this when the user asks to run something repeatedly, on a schedule, or with phrases like every minute, every hour, every day.',
          'Use action=list when the user asks to show cron tasks; the tool result is final and should be returned as-is.',
          'For creation, pass a five-field crontab schedule or a supported human phrase, the command/script path, optional args, and a prompt that explains what the cron reviewer should check. If the user already described what to check, copy that instruction into prompt.',
          'For editing an existing task, use action=edit with id and only the fields that should change. Use appendPrompt when the user asks to keep the existing prompt and add an instruction.',
        ].join(' '),
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'One of: create, edit, update, delete, list, enable, disable.' },
            id: { type: 'number', description: 'Integer task ID for edit, update, delete, enable, or disable.' },
            schedule: { type: 'string', description: 'Five-field crontab or human phrase like every minute/every hour/every day.' },
            command: { type: 'string', description: 'Executable/script path. Supports ~, for example ~/Downloads/test-bot.sh.' },
            args: { type: 'array', items: { type: 'string' }, description: 'Optional command arguments.' },
            prompt: { type: 'string', description: 'Instruction for analyzing command output after each scheduled run.' },
            appendPrompt: { type: 'string', description: 'Text to append to the existing prompt when editing a task.' },
          },
        },
      },
    },
    resultMode: 'direct',
    directCommands: [{
      description: 'Direct cron list/delete/disable/enable commands by task ID. Edit requests intentionally go through the LLM.',
      buildArgs: cronControlArgs,
    }],
    async run(args, context) {
      const action = stringArg(args, 'action').toLowerCase();
      if (action === 'list') return formatTaskList(await storage.list());
      if (action === 'delete') {
        const id = intArg(args, 'id');
        return await storage.delete(id) ? `Deleted cron task #${id}.` : `Cron task #${id} was not found.`;
      }
      if (action === 'enable' || action === 'disable') {
        const id = intArg(args, 'id');
        const task = await storage.setEnabled(id, action === 'enable');
        if (!task) return `Cron task #${id} was not found.`;
        return `${action === 'enable' ? 'Enabled' : 'Disabled'} cron task #${id}.`;
      }
      if (action === 'create') {
        const task = await storage.create({
          schedule: stringArg(args, 'schedule'),
          command: stringArg(args, 'command'),
          args: optionalStringArray(args, 'args'),
          prompt: cronPrompt(args, context),
          author: authorFromContext(context),
        });
        return formatCreatedTask(task);
      }
      if (action === 'edit' || action === 'update') {
        return formatEditedTask(await editTask(storage, args));
      }
      throw new Error(`Unsupported cron action "${action}"`);
    },
  };
}

function cronControlArgs(text: string): CronControlArgs | undefined {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ');
  if (/^(edit|update|change)\b/.test(normalized)) return undefined;

  if (/^(?:show|list)? ?(?:cron|crontab|scheduled) tasks?(?: list)?$/.test(normalized)
    || /^(?:cron|crontab) list$/.test(normalized)) {
    return { action: 'list' };
  }

  const startMatch = normalized.match(/^(delete|remove|disable|diable|enable) ?(?:(?:cron|crontab|scheduled) )?(?:task )?#?(\d+)$/);
  const endMatch = normalized.match(/^(?:(?:cron|crontab|scheduled) )?(?:task )?#?(\d+) ?(delete|remove|disable|diable|enable)$/);
  const verb = startMatch?.[1] ?? endMatch?.[2];
  const id = Number(startMatch?.[2] ?? endMatch?.[1]);
  if (!verb || !Number.isInteger(id) || id <= 0) return undefined;
  const action = verb === 'remove' ? 'delete' : verb === 'diable' ? 'disable' : verb;
  return action === 'delete' || action === 'disable' || action === 'enable' ? { action, id } : undefined;
}

function cronPrompt(args: Record<string, unknown>, context: ToolRunContext | undefined): string {
  const explicit = optionalStringArg(args, 'prompt');
  if (explicit) return explicit;

  const requestText = context?.requestText?.trim();
  if (requestText) {
    return [
      'Use the original Telegram request as the review instruction.',
      `Original request: ${truncateText(requestText, 1000)}`,
    ].join('\n');
  }

  return 'Review the command output and only send a message to the task author if the output satisfies the scheduled task request.';
}

function formatCreatedTask(task: CronTask): string {
  return [
    `Created cron task #${task.id}.`,
    `Schedule: ${task.schedule}`,
    `Command: ${[task.command, ...task.args].join(' ')}`,
    `Prompt: ${truncateText(task.prompt, 500)}`,
  ].join('\n');
}

async function editTask(storage: CronTaskStorage, args: Record<string, unknown>): Promise<CronTask> {
  const id = intArg(args, 'id');
  const task = (await storage.list()).find((item) => item.id === id);
  if (!task) throw new Error(`Cron task #${id} was not found.`);

  const schedule = optionalStringArg(args, 'schedule');
  const command = optionalStringArg(args, 'command');
  const nextArgs = optionalStringArrayArg(args, 'args');
  const prompt = optionalStringArg(args, 'prompt');
  const appendPrompt = optionalStringArg(args, 'appendPrompt');

  const edited: CronTask = {
    ...task,
    ...(schedule ? { schedule: normalizeSchedule(schedule) } : {}),
    ...(command ? { command } : {}),
    ...(nextArgs ? { args: nextArgs } : {}),
    ...(prompt ? { prompt } : {}),
    updatedAt: new Date().toISOString(),
  };

  if (appendPrompt) {
    edited.prompt = appendPromptOnce(edited.prompt, appendPrompt);
  }

  await storage.update(edited);
  return edited;
}

function appendPromptOnce(prompt: string, appendPrompt: string): string {
  const lines = prompt.split('\n').map((line) => line.trim()).filter(Boolean);
  const appendLine = appendPrompt.trim();
  if (lines.some((line) => normalizedPromptLine(line) === normalizedPromptLine(appendLine))) {
    return lines.join('\n');
  }
  return [...lines, appendLine].join('\n');
}

function normalizedPromptLine(text: string): string {
  const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'that', 'to']);
  return text
    .toLowerCase()
    .split(/[^a-z0-9а-яё]+/gi)
    .filter((word) => word && !stopWords.has(word))
    .join('');
}

function formatEditedTask(task: CronTask): string {
  return [
    `Edited cron task #${task.id}.`,
    `Schedule: ${task.schedule}`,
    `Command: ${[task.command, ...task.args].join(' ')}`,
    `Prompt: ${truncateText(task.prompt, 700)}`,
  ].join('\n');
}

function formatTaskList(tasks: CronTask[]): string {
  if (tasks.length === 0) return 'No cron tasks registered.';
  return tasks.map((task) => [
    `#${task.id} ${task.enabled ? 'enabled' : 'disabled'} ${task.schedule}`,
    `Command: ${[task.command, ...task.args].join(' ')}`,
    `Prompt: ${truncateText(task.prompt, 300)}`,
    task.lastRunAt ? `Last run: ${task.lastRunAt} ${task.lastRunStatus ?? ''}`.trim() : 'Last run: never',
  ].join('\n')).join('\n\n');
}
