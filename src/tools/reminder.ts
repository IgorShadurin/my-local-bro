import type { ReminderStorage } from '../reminder/storage.js';
import type { ReminderAuthor, ReminderTask } from '../reminder/types.js';
import { formatLocalDateTime } from '../util/date.js';
import { truncateText } from '../util/text.js';
import type { ToolRunContext, ToolRuntime } from './types.js';

type ReminderDirectArgs =
  | { action: 'list' }
  | { action: 'delete'; id: number };

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function intArg(args: Record<string, unknown>, key: string): number {
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
  return value;
}

function authorFromContext(context: ToolRunContext | undefined): ReminderAuthor {
  if (!context?.userId || !context.chatId) {
    throw new Error('Reminder creation requires Telegram user and chat context');
  }
  return {
    userId: context.userId,
    chatId: context.chatId,
    ...(context.messageThreadId ? { messageThreadId: context.messageThreadId } : {}),
  };
}

export function reminderUsagePrompt(): string {
  return [
    'Use reminder to create one-time reminders for a future date/time.',
    'When creating a reminder, convert the reminder text to concise English.',
    'Preserve the original meaning exactly.',
    'Do not change direction or relation words such as to/from, in/out, on/off, before/after, with/without.',
    'If the user says the reminder text as a statement, keep it as a statement.',
    'Do not rewrite statements into tasks like check, verify, confirm, remember to check, or ask whether, unless the user explicitly asked for checking or verifying.',
    'If the user already gave the exact content that should appear later, keep that content and only normalize language and punctuation.',
    'Keep the text short and natural. Do not add extra verbs, explanation, or commentary.',
    'Return the reminder text in clean sentence case.',
    'If the reminder reads like a full statement, keep the final period.',
    'Pass dueAt as a full ISO 8601 timestamp with timezone offset based on the current local time context.',
    'Use action=create with text and dueAt.',
    'Use action=list when the user asks to show reminders or pending reminders; that result is final and should be returned as-is.',
    'Use action=delete only when the user explicitly asks to remove or cancel a reminder by ID.',
  ].join(' ');
}

export function createReminderTool(storage: ReminderStorage): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'reminder',
        description: [
          'Create, list, and delete one-time reminder tasks stored locally.',
          'Create reminders only for future times. Convert reminder text to concise English before calling this tool.',
          'Preserve the intended reminder text exactly. Do not turn declarative text into a check or verification task unless the user asked for that.',
          'Pass dueAt as a full ISO 8601 date/time string with timezone offset.',
          'Use action=list when the user asks to show reminders; the result is final and should be returned as-is.',
        ].join(' '),
        parameters: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', description: 'One of: create, list, delete.' },
            id: { type: 'number', description: 'Reminder ID for delete.' },
            text: { type: 'string', description: 'Reminder text in concise English.' },
            dueAt: { type: 'string', description: 'Full ISO 8601 date/time with timezone offset, for example 2026-04-09T15:30:00+03:00.' },
          },
        },
      },
    },
    resultMode: 'direct',
    directCommands: [{
      description: 'Direct reminder list/delete commands by reminder ID.',
      buildArgs: reminderDirectArgs,
    }],
    async run(args, context) {
      const action = stringArg(args, 'action').toLowerCase();
      if (action === 'list') return formatReminderList(await storage.list());
      if (action === 'delete') {
        const id = intArg(args, 'id');
        return await storage.delete(id)
          ? `Deleted reminder #${id}.`
          : `Reminder #${id} was not found.`;
      }
      if (action === 'create') {
        const reminder = await storage.create({
          text: stringArg(args, 'text'),
          dueAt: stringArg(args, 'dueAt'),
          author: authorFromContext(context),
        });
        return formatCreatedReminder(reminder);
      }
      throw new Error(`Unsupported reminder action "${action}"`);
    },
  };
}

function reminderDirectArgs(text: string): ReminderDirectArgs | undefined {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ');
  if (
    /^(?:show|list)? ?(?:my )?(?:pending )?reminders?$/.test(normalized)
    || /^(?:reminder|reminders) list$/.test(normalized)
    || /^(?:show )?list of reminders?$/.test(normalized)
  ) {
    return { action: 'list' };
  }
  const startMatch = normalized.match(/^(delete|remove|cancel) ?(?:my )?reminder ?#?(\d+)$/);
  const endMatch = normalized.match(/^(?:my )?reminder ?#?(\d+) ?(delete|remove|cancel)$/);
  const id = Number(startMatch?.[2] ?? endMatch?.[1]);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return { action: 'delete', id };
}

function formatCreatedReminder(reminder: ReminderTask): string {
  return [
    `Created reminder #${reminder.id}.`,
    `When: ${formatLocalDateTime(new Date(reminder.dueAt))}`,
    `Text: **${truncateText(reminder.text, 500)}**`,
  ].join('\n');
}

function formatReminderList(reminders: ReminderTask[]): string {
  if (reminders.length === 0) return 'No pending reminders.';
  return reminders.map((reminder) => [
    `#${reminder.id} ${formatLocalDateTime(new Date(reminder.dueAt))}`,
    `Text: **${truncateText(reminder.text, 500)}**`,
    `Created: ${formatLocalDateTime(new Date(reminder.createdAt))}`,
  ].join('\n')).join('\n\n');
}
