const FIELD_LIMITS = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;

export function normalizeSchedule(value: string): string {
  const trimmed = value.trim();
  if (trimmed.split(/\s+/).length === 5) {
    validateCron(trimmed);
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'every minute' || lower === 'each minute' || lower === 'once a minute') return '* * * * *';
  if (lower === 'hourly' || lower === 'every hour' || lower === 'each hour') return '0 * * * *';
  if (lower === 'daily' || lower === 'every day' || lower === 'each day') return '0 9 * * *';
  if (lower === 'weekly' || lower === 'every week' || lower === 'each week') return '0 9 * * 1';

  const minuteMatch = lower.match(/^every\s+(\d+)\s+minutes?$/);
  if (minuteMatch?.[1]) return `*/${bounded(minuteMatch[1], 1, 59)} * * * *`;

  const hourMatch = lower.match(/^every\s+(\d+)\s+hours?$/);
  if (hourMatch?.[1]) return `0 */${bounded(hourMatch[1], 1, 23)} * * *`;

  throw new Error(`Unsupported schedule "${value}". Use five-field crontab or phrases like every minute, every hour, every day.`);
}

export function cronMatches(date: Date, expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  validateCron(expression);
  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];
  return parts.every((field, index) => fieldMatches(field, values[index] ?? 0, FIELD_LIMITS[index] ?? [0, 0]));
}

export function minuteKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join('-');
}

function validateCron(expression: string): void {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron schedule must have 5 fields, got ${parts.length}`);
  }
  parts.forEach((field, index) => {
    if (!fieldMatches(field, FIELD_LIMITS[index]?.[0] ?? 0, FIELD_LIMITS[index] ?? [0, 0])) {
      throw new Error(`Invalid cron field "${field}"`);
    }
  });
}

function fieldMatches(field: string, value: number, [min, max]: readonly [number, number]): boolean {
  return field.split(',').some((part) => partMatches(part, value, min, max));
}

function partMatches(part: string, value: number, min: number, max: number): boolean {
  if (part === '*') return true;
  const stepMatch = part.match(/^\*\/(\d+)$/);
  if (stepMatch?.[1]) {
    const step = bounded(stepMatch[1], 1, max);
    return (value - min) % step === 0;
  }

  const rangeMatch = part.match(/^(\d+)-(\d+)$/);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const start = bounded(rangeMatch[1], min, max);
    const end = bounded(rangeMatch[2], min, max);
    return value >= start && value <= end;
  }

  if (/^\d+$/.test(part)) {
    const exact = bounded(part, min, max);
    if (max === 7 && exact === 7) return value === 0;
    return value === exact;
  }

  return false;
}

function bounded(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Cron value ${value} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}
