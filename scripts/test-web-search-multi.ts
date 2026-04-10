import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { Ollama } from 'ollama';
import { Logger } from '../src/logger.js';
import { OllamaAgent } from '../src/model/ollamaAgent.js';
import type { ToolRegistry } from '../src/tools/types.js';

const outputDir = `/tmp/my-local-bro-web-search-multi-${Date.now()}`;
const model = process.env.TEST_MULTI_SEARCH_MODEL?.trim() || 'gemma4:26b';

type MultiSearchCase = {
  name: string;
  request: string;
  expectedItems: string[];
  minCoveredItems: number;
  expectPopulationFollowUp?: boolean;
};

const cases: MultiSearchCase[] = [
  {
    name: 'three-items',
    request: 'Browse who is the current CEO of Google, Microsoft, and Apple, and where each of them was born.',
    expectedItems: ['Google', 'Microsoft', 'Apple'],
    minCoveredItems: 3,
  },
  {
    name: 'ten-items',
    request: 'Browse who is the current CEO of Google, Microsoft, Apple, Amazon, Meta, Netflix, NVIDIA, OpenAI, Intel, and AMD, and where each of them was born.',
    expectedItems: ['Google', 'Microsoft', 'Apple', 'Amazon', 'Meta', 'Netflix', 'NVIDIA', 'OpenAI', 'Intel', 'AMD'],
    minCoveredItems: 3,
  },
  {
    name: 'dependent-city-population',
    request: 'Browse who is the current CEO of Google, where he was born, and what the population of that city is.',
    expectedItems: ['Google', 'Madurai'],
    minCoveredItems: 2,
    expectPopulationFollowUp: true,
  },
];

function createMockRegistry(recordedQueries: string[]): ToolRegistry {
  const registry: ToolRegistry = new Map();
  registry.set('web_search', {
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
          },
        },
      },
    },
    async run(args) {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) throw new Error('query must be a non-empty string');
      recordedQueries.push(query);
      if (/google/i.test(query) && /ceo/i.test(query) && !/madurai|population/i.test(query)) {
        return JSON.stringify({
          company: 'Google',
          ceo: 'Sundar Pichai',
          birthplace: 'Madurai, Tamil Nadu, India',
          mock: true,
        });
      }
      if (/madurai/i.test(query) && /population/i.test(query)) {
        return JSON.stringify({
          city: 'Madurai',
          population: 'about 1.7 million metro',
          mock: true,
        });
      }
      return JSON.stringify({ query, mock: true });
    },
  });
  return registry;
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const logger = new Logger(`${outputDir}/logs`);
  const client = new Ollama({ host: process.env.OLLAMA_HOST?.trim() || 'http://127.0.0.1:11434' });
  const results: Array<Record<string, unknown>> = [];

  for (const testCase of cases) {
    const queries: string[] = [];
    const registry = createMockRegistry(queries);
    const agent = new OllamaAgent(client, {
      host: process.env.OLLAMA_HOST?.trim() || 'http://127.0.0.1:11434',
      model,
      thinking: 'high',
      contextTokens: 32768,
    }, registry, logger);
    const startedAt = Date.now();
    const answer = await agent.generate({ prompt: testCase.request });
    const durationMs = Date.now() - startedAt;
    const coveredItems = testCase.expectedItems.filter((item) => queries.some((query) => query.toLowerCase().includes(item.toLowerCase())));
    if (coveredItems.length < testCase.minCoveredItems) {
      throw new Error(`${testCase.name} covered only ${coveredItems.length} items: ${coveredItems.join(', ') || 'none'}`);
    }
    if (testCase.expectPopulationFollowUp) {
      const hasPopulationFollowUp = queries.some((query) => /madurai/i.test(query) && /population/i.test(query));
      if (!hasPopulationFollowUp) {
        throw new Error(`${testCase.name} did not issue a follow-up city population search. Queries: ${queries.join(' | ')}`);
      }
    }
    results.push({
      name: testCase.name,
      request: testCase.request,
      queries,
      coveredItems,
      coveredCount: coveredItems.length,
      queryCount: queries.length,
      durationMs,
      answer,
    });
  }

  await writeFile(`${outputDir}/results.json`, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(`Model: ${model}`);
  console.log(`Results saved to ${outputDir}`);
  for (const result of results) {
    console.log(`${result.name}: queries=${result.queryCount} covered=${result.coveredCount}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
