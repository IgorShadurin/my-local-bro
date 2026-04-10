import type { Ollama } from 'ollama';
import { truncateText } from '../util/text.js';
import type { ToolRunContext, ToolRuntime } from './types.js';

const TAVILY_BASE_URL = 'https://api.tavily.com';

export interface WebProbeResult {
  ok: boolean;
  reason?: string;
}

const WEB_SEARCH_PLANNER_PROMPT = [
  'You split a user request into focused web search queries.',
  'Return strict JSON only in the form {"queries":["..."]}.',
  'Do not answer the user request.',
  'Use the full original user request and the suggested initial search query.',
  'Preserve the user intent exactly.',
  'Generate concise search phrases, not long natural-language sentences.',
  'When the request contains several requested items, create focused queries that together cover them.',
  'When the request names several different companies, people, products, places, or entities, prefer one focused query per named entity if that improves accuracy.',
  'Do not combine several named entities in one query when separate queries would be more precise.',
  'For repeated leadership lookups across many entities, use singular parallel wording exactly like "executive of Google", "executive of Apple", "executive of OpenAI" unless the user explicitly asks for founders, board members, or another different role.',
  'When the request contains a dependent lookup, include a follow-up query for the derived fact.',
  'Example: if the request asks who is the current CEO of Google, where he was born, and what the population of that city is, one query may find the CEO and birthplace and another query may ask for the population of the birthplace city of the current CEO of Google.',
  'Use at most 10 queries.',
].join(' ');

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

export function createWebSearchTool(client: Ollama, model: () => string): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for recent or external information using Tavily Search.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query.' },
            max_results: { type: 'number', description: 'Maximum results to return, up to 10.' },
            topic: { type: 'string', description: 'Optional topic: general, news, or finance.' },
            time_range: { type: 'string', description: 'Optional time range: day, week, month, year, d, w, m, or y.' },
          },
        },
      },
    },
    async run(args, context) {
      const query = stringArg(args, 'query');
      const requested = Number(args.max_results ?? args.maxResults ?? 5);
      const maxResults = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 10) : 5;
      const queries = await planWebSearchQueries(client, model, query, context);
      await context?.reportProgress?.([
        `${queries.length} searches planned`,
        ...queries.map((plannedQuery, index) => `${index + 1}. ${plannedQuery}`),
      ].join('\n'));
      const results = [];
      for (const plannedQuery of queries) {
        const body: Record<string, unknown> = {
          query: plannedQuery,
          max_results: maxResults,
          search_depth: 'basic',
          include_answer: false,
          include_raw_content: false,
          include_usage: true,
        };
        if (typeof args.topic === 'string' && args.topic.trim()) body.topic = args.topic.trim();
        if (typeof args.time_range === 'string' && args.time_range.trim()) body.time_range = args.time_range.trim();
        const result = await tavilyRequest('search', body);
        results.push({ query: plannedQuery, result });
      }
      return truncateText(JSON.stringify({ planned_queries: queries, results }, null, 2), 8000);
    },
  };
}

export function createWebFetchTool(): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch one web page by URL using Tavily Extract.',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'URL to fetch.' },
            query: { type: 'string', description: 'Optional intent for reranking extracted chunks.' },
          },
        },
      },
    },
    async run(args) {
      const url = stringArg(args, 'url');
      const body: Record<string, unknown> = {
        urls: url,
        extract_depth: 'basic',
        format: 'markdown',
        include_images: false,
        include_usage: true,
      };
      if (typeof args.query === 'string' && args.query.trim()) body.query = args.query.trim();
      const result = await tavilyRequest('extract', body);
      return truncateText(JSON.stringify(result, null, 2), 8000);
    },
  };
}

async function planWebSearchQueries(
  client: Ollama,
  model: () => string,
  suggestedQuery: string,
  context: ToolRunContext | undefined,
): Promise<string[]> {
  const requestText = context?.requestText?.trim();
  if (!requestText) return [suggestedQuery];

  try {
    const response = await client.chat({
      model: model(),
      think: false,
      messages: [
        { role: 'system', content: WEB_SEARCH_PLANNER_PROMPT },
        {
          role: 'user',
          content: [
            `Original user request: ${requestText}`,
            `Initial search query: ${suggestedQuery}`,
            'Return only JSON.',
          ].join('\n'),
        },
      ],
      options: { num_ctx: 8192 },
    });
    const planned = parsePlannedQueries(response.message.content, suggestedQuery);
    return planned.length > 0 ? planned : [suggestedQuery];
  } catch {
    return [suggestedQuery];
  }
}

function parsePlannedQueries(content: string, fallback: string): string[] {
  const parsed = extractJsonObject(content);
  if (!parsed) return [fallback];
  try {
    const value = JSON.parse(parsed) as { queries?: unknown };
    const queries = Array.isArray(value.queries)
      ? value.queries.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : [];
    return queries.length > 0 ? uniqueQueries(queries).slice(0, 10) : [fallback];
  } catch {
    return [fallback];
  }
}

function extractJsonObject(content: string): string | undefined {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return undefined;
  return content.slice(start, end + 1);
}

function uniqueQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const query of queries) {
    const normalized = query.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(query);
  }
  return result;
}

export async function probeWebTools(): Promise<WebProbeResult> {
  try {
    await tavilyRequest('search', {
      query: 'tavily health check',
      max_results: 1,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      include_usage: true,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function tavilyRequest(endpoint: 'search' | 'extract', body: Record<string, unknown>): Promise<unknown> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(`${endpoint} requires TAVILY_API_KEY. Set it in .env and restart the bot.`);
  }

  const response = await fetch(`${TAVILY_BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Tavily ${endpoint} failed with HTTP ${response.status}: ${parseErrorText(text) || response.statusText}`);
  }
  if (!text.trim()) {
    throw new Error(`Tavily ${endpoint} returned an empty HTTP ${response.status} response.`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Tavily ${endpoint} returned invalid JSON: ${truncateText(text, 500)}`);
  }
}

function parseErrorText(text: string): string {
  if (!text.trim()) return '';
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown; detail?: unknown };
    const message = parsed.error ?? parsed.message ?? parsed.detail;
    return typeof message === 'string' ? message : truncateText(text, 500);
  } catch {
    return truncateText(text, 500);
  }
}
