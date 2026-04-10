import type { ResearchArchetype, ResearchQuestion } from './types.js';
import { truncateText } from '../util/text.js';

export class ResearchProgress {
  private current = 0;
  private total = 1;

  constructor(private readonly report?: (message: string) => Promise<void>) {}

  setTotal(total: number): void {
    this.total = Math.max(total, this.current || 1);
  }

  async step(label: string): Promise<void> {
    this.current += 1;
    await this.report?.(`${label} - ${this.current} of ${this.total} steps`);
  }
}

export function parseArchetype(value: unknown): ResearchArchetype {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  switch (normalized) {
    case 'indie_developer':
    case 'founder':
    case 'creator':
    case 'agency_owner':
    case 'executive':
    case 'employee':
    case 'researcher':
    case 'open_source_maintainer':
    case 'investor':
      return normalized;
    default:
      return 'unknown';
  }
}

export function parseQuestion(value: unknown, index: number): ResearchQuestion[] {
  if (!value || typeof value !== 'object') return [];
  const raw = value as Record<string, unknown>;
  const question = typeof raw.question === 'string' ? raw.question.trim() : '';
  const searchQuery = typeof raw.searchQuery === 'string' ? raw.searchQuery.trim() : '';
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `q${index + 1}`;
  if (!question || !searchQuery) return [];
  return [{ id, question, searchQuery }];
}

export function uniqueQuestionQueries(questions: ResearchQuestion[]): ResearchQuestion[] {
  const seen = new Set<string>();
  const result: ResearchQuestion[] = [];
  for (const question of questions) {
    const normalized = normalizeQuery(question.searchQuery);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(question);
  }
  return result;
}

export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function uniqueQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const query of queries) {
    const normalized = normalizeQuery(query);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(query.trim());
  }
  return result;
}

export function extractJson(content: string): string | undefined {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fence?.trim()) return fence.trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return undefined;
  return content.slice(start, end + 1);
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function stepLabel(question: ResearchQuestion): string {
  const source = question.question.trim() || question.searchQuery.trim();
  return truncateText(source.replace(/[.?!]+$/g, ''), 80);
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const next = async (): Promise<void> => {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index]!, index);
    await next();
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
}
