import type { ToolRuntime } from './types.js';

function isTimeRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ');
  return [
    'time',
    'current time',
    'time now',
    'what time is it',
    'show time',
    'show current time',
    'date and time',
    'current date and time',
    'what is the time',
    'время',
    'сколько времени',
    'текущее время',
    'дата и время',
  ].includes(normalized);
}

function formatZone(date: Date, timeZone: string, label: string, flag: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const offset = formatUtcOffset(date, timeZone);
  return `${flag} ${label}: ${pick('hour')}:${pick('minute')}:${pick('second')} (${offset}) ${pick('year')}-${pick('month')}-${pick('day')}`;
}

function formatUtcOffset(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  });
  const value = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  return value.replace(/^GMT/, 'UTC');
}

export function createTimeTool(): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'time',
        description: 'Show the current date and time on this machine, in London, and in New York. The result is final and should be returned as-is.',
        parameters: {
          type: 'object',
          required: [],
          properties: {},
        },
      },
    },
    resultMode: 'direct',
    directCommands: [{
      description: 'Direct current-time commands that should bypass the LLM.',
      buildArgs: (text) => isTimeRequest(text) ? {} : undefined,
    }],
    async run() {
      const now = new Date();
      return [
        formatZone(now, 'Europe/Minsk', 'Machine', '🇧🇾'),
        formatZone(now, 'Europe/London', 'London', '🇬🇧'),
        formatZone(now, 'America/New_York', 'New York', '🇺🇸'),
      ].join('\n');
    },
  };
}
