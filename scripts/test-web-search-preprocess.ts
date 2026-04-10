import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { Ollama } from 'ollama';
import { normalizeToolOutput } from '../src/tools/types.js';
import { createWebSearchTool } from '../src/tools/web.js';

const outputDir = `/tmp/my-local-bro-web-search-preprocess-${Date.now()}`;
const model = process.env.TEST_MULTI_SEARCH_MODEL?.trim() || 'gemma4:26b';
process.env.TAVILY_API_KEY ??= 'test-key';

interface TestResult {
  name: string;
  requestText: string;
  plannedQueries: string[];
  durationMs: number;
  output: string;
}

interface TestCase {
  name: string;
  query: string;
  requestText: string;
  expectAtLeast: number;
  requiredMatches: string[];
  maxNamedEntitiesPerQuery?: number;
  preferredPrefix?: string;
}

const cases: TestCase[] = [
  {
    name: 'three-items',
    query: 'current CEOs of Google, Microsoft, and Apple',
    requestText: 'Browse who is the current CEO of Google, Microsoft, and Apple, and where each of them was born.',
    expectAtLeast: 3,
    requiredMatches: ['google', 'microsoft', 'apple'],
  },
  {
    name: 'dependent-city-population',
    query: 'current CEO of Google',
    requestText: 'Browse who is the current CEO of Google, where he was born, and what the population of that city is.',
    expectAtLeast: 2,
    requiredMatches: ['google', 'population'],
  },
  {
    name: 'six-companies',
    query: 'executives of Google, Apple, OpenAI, Microsoft, Telegram, JetBrains',
    requestText: 'Кто управленцы Google, Apple, OpenAI, Microsoft, Telegram, JetBrains?',
    expectAtLeast: 6,
    requiredMatches: ['google', 'apple', 'openai', 'microsoft', 'telegram', 'jetbrains'],
    maxNamedEntitiesPerQuery: 1,
    preferredPrefix: 'executive of',
  },
];

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const client = new Ollama({ host: process.env.OLLAMA_HOST?.trim() || 'http://127.0.0.1:11434' });
  const recordedQueries: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith('https://api.tavily.com/search')) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
    const query = typeof body.query === 'string' ? body.query : '';
    recordedQueries.push(query);
    return new Response(JSON.stringify({ query, mock: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const tool = createWebSearchTool(client, () => model);
    const results: TestResult[] = [];
    for (const testCase of cases) {
      recordedQueries.length = 0;
      const startedAt = Date.now();
      const output = normalizeToolOutput(await tool.run({ query: testCase.query }, { requestText: testCase.requestText })).content;
      const durationMs = Date.now() - startedAt;
      if (recordedQueries.length < testCase.expectAtLeast) {
        throw new Error(`${testCase.name} planned only ${recordedQueries.length} search queries: ${recordedQueries.join(' | ')}`);
      }
      for (const required of testCase.requiredMatches) {
        const matched = recordedQueries.some((query) => query.toLowerCase().includes(required));
        if (!matched) {
          throw new Error(`${testCase.name} is missing required query fragment "${required}": ${recordedQueries.join(' | ')}`);
        }
      }
      if (typeof testCase.maxNamedEntitiesPerQuery === 'number') {
        for (const query of recordedQueries) {
          const matchedEntities = testCase.requiredMatches.filter((entity) => query.toLowerCase().includes(entity));
          if (matchedEntities.length > testCase.maxNamedEntitiesPerQuery) {
            throw new Error(`${testCase.name} has an over-batched query "${query}" with entities: ${matchedEntities.join(', ')}`);
          }
        }
      }
      if (testCase.preferredPrefix) {
        for (const query of recordedQueries) {
          if (!query.toLowerCase().startsWith(testCase.preferredPrefix)) {
            throw new Error(`${testCase.name} query does not use preferred prefix "${testCase.preferredPrefix}": ${query}`);
          }
        }
      }
      results.push({
        name: testCase.name,
        requestText: testCase.requestText,
        plannedQueries: [...recordedQueries],
        durationMs,
        output,
      });
    }
    await writeFile(`${outputDir}/results.json`, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    console.log(`Model: ${model}`);
    console.log(`Results saved to ${outputDir}`);
    for (const result of results) {
      console.log(`${result.name}: planned=${result.plannedQueries.length}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
