import type { Ollama } from 'ollama';
import type { ToolRuntime } from './types.js';

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

export function createGrammarTool(client: Ollama, model: () => string): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'grammar',
        description: 'Fix grammar, spelling, punctuation, and wording in any language while preserving meaning.',
        parameters: {
          type: 'object',
          required: ['text'],
          properties: {
            text: { type: 'string', description: 'Text to correct.' },
          },
        },
      },
    },
    resultMode: 'direct',
    inline: {
      order: 20,
      title: 'Fix grammar',
      description: 'Correct spelling, grammar, and punctuation.',
      buildArgs(query) {
        const text = query.trim();
        return text ? { text } : undefined;
      },
    },
    async run(args) {
      const text = requiredString(args, 'text');
      const response = await client.chat({
        model: model(),
        think: true,
        messages: [
          {
            role: 'system',
            content: [
              'You are a grammar correction engine for any language.',
              'Return only the corrected text.',
              'Preserve the original meaning, language, tone, names, formatting, and line breaks.',
              'Do not explain, summarize, annotate, or add quotes.',
            ].join(' '),
          },
          {
            role: 'user',
            content: text,
          },
        ],
      });
      return response.message.content.trim();
    },
  };
}
