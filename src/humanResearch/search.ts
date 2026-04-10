import { truncateText } from '../util/text.js';
import type { HumanResearchSearchAdapter, SearchDocument, SearchResult } from './types.js';

const TAVILY_BASE_URL = 'https://api.tavily.com';

export function createTavilyHumanResearchSearchAdapter(apiKey: string): HumanResearchSearchAdapter {
  return {
    providerName: 'tavily',
    async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
      if (!apiKey) {
        throw new Error('human_research requires TAVILY_API_KEY. Set it in .env and restart the bot.');
      }
      const response = await fetch(`${TAVILY_BASE_URL}/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query,
          max_results: 8,
          search_depth: 'advanced',
          include_answer: false,
          include_raw_content: true,
          include_images: false,
        }),
        ...(signal ? { signal } : {}),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Tavily human research search failed with HTTP ${response.status}: ${truncateText(text, 500)}`);
      }
      const parsed = JSON.parse(text) as { results?: Array<Record<string, unknown>> };
      const documents = (parsed.results ?? []).map(normalizeTavilyDocument);
      return { query, documents };
    },
  };
}

function normalizeTavilyDocument(raw: Record<string, unknown>): SearchDocument {
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Untitled';
  const url = typeof raw.url === 'string' ? raw.url : 'https://example.invalid';
  const snippet = typeof raw.content === 'string' ? raw.content : '';
  const body = typeof raw.raw_content === 'string' && raw.raw_content.trim() ? raw.raw_content : snippet;
  const publishedAt = typeof raw.published_date === 'string' ? raw.published_date : undefined;
  return {
    title,
    url,
    snippet: truncateText(snippet.replace(/\s+/g, ' ').trim(), 600),
    body: truncateText(body.replace(/\s+/g, ' ').trim(), 4000),
    ...(publishedAt ? { publishedAt } : {}),
  };
}
