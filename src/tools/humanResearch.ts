import type { Ollama } from 'ollama';
import { HumanResearchRunner } from '../humanResearch/runner.js';
import { createTavilyHumanResearchSearchAdapter } from '../humanResearch/search.js';
import type { ToolRuntime } from './types.js';

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

export function createHumanResearchTool(client: Ollama, model: () => string): ToolRuntime {
  const adapter = createTavilyHumanResearchSearchAdapter(process.env.TAVILY_API_KEY?.trim() || '');
  const runner = new HumanResearchRunner(client, model, adapter);

  return {
    definition: {
      type: 'function',
      function: {
        name: 'human_research',
        description: [
          'Research a public professional or creator profile for a human.',
          'Use it when the user provides a person name, email, company, role, or related clues and wants a consolidated public-profile report.',
          'The tool finds likely public profiles, public social accounts, products or services, public pricing or public MRR signals, tools or platform signals, and recent public activity.',
          'It also handles ambiguity between multiple matching profiles and returns a final PDF report.',
        ].join(' '),
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: {
              type: 'string',
              description: 'The full human research request with all clues, for example name, email, company, role, and what to find.',
            },
            country: {
              type: 'string',
              description: 'Optional country hint when the request clearly targets country-specific public registries or markets.',
            },
          },
        },
      },
    },
    resultMode: 'direct',
    async run(args, context) {
      const query = stringArg(args, 'query');
      const country = typeof args.country === 'string' && args.country.trim() ? args.country.trim() : undefined;
      const result = await runner.run({
        query,
        ...(country ? { country } : {}),
        ...(context?.reportProgress ? { reportProgress: context.reportProgress } : {}),
        ...(context?.signal ? { signal: context.signal } : {}),
      });
      return {
        content: JSON.stringify({
          subjectLabel: result.subjectLabel,
          planned_queries: result.plannedQueries,
          answer_count: result.answers.length,
        }),
        artifact: result.artifact,
      };
    },
  };
}
