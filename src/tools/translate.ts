import type { Ollama } from 'ollama';
import type { ToolRuntime } from './types.js';

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string when provided`);
  }
  return value.trim();
}

export const TRANSLATION_SYSTEM_PROMPT = [
  'You are a translation engine. Return only the translated text. Do not explain, summarize, annotate, or add quotes.',
  'Forbidden output characters: — and –.',
  'If source or target language is auto/default, detect the source language.',
  'Resolve the target language before writing the answer.',
  'Mandatory default rule: English source translates to Russian; Russian source translates to English.',
  'If the source is neither English nor Russian and no explicit target is provided, translate to English.',
  'Do not return the source language when the resolved target language is different.',
  'Translate in a fluent native-speaker style, not word-for-word. Keep the meaning, facts, numbers, names, perspective, and tense, but choose natural phrasing that reads like a person wrote it.',
  'Preserve paragraph breaks from the source. If the source has multiple paragraphs, the translation must keep multiple paragraphs instead of collapsing them into one block.',
  'When the source is a personal note, status update, journal entry, or casual message, keep that natural personal style instead of making it formal or corporate.',
  'When translating into Russian, avoid English calques and English grammar patterns. Use idiomatic Russian phrasing that a native speaker would actually write.',
  'When translating first-person text into Russian, do not use parenthesized gender alternatives like он(а), сделал(-а), or расстроен(-а). Prefer wording that avoids unnecessary gender; if a choice is unavoidable and the speaker gender is unknown, translate as a male speaker using normal masculine forms.',
  'Preserve the speech act and sentence intent: questions must remain questions, requests must remain requests, and exclamations must remain exclamations.',
  'Fix obvious capitalization, spacing, and punctuation in the translated output so it reads naturally in the target language, including capitalizing the start of each sentence when the target language normally does that.',
  'If the source omits a question mark but is clearly a question, add the correct question punctuation in the translation.',
  'Never output these dash characters: — or –. If a pause or separation is needed, use natural punctuation such as a comma, colon, semicolon, parentheses, or a regular hyphen - instead.',
  'Before returning the final translation, check it for — or –. If either appears, rewrite that sentence with different punctuation before answering.',
  'Before returning Russian text, check for gender alternatives in parentheses such as (-а), (а), or /а. If they appear, rewrite using a normal sentence without alternatives.',
].join(' ');

export function createTranslateTool(client: Ollama, model: () => string): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'translate',
        description: 'Translate text. If languages are not provided, default English to Russian and Russian to English.',
        parameters: {
          type: 'object',
          required: ['text'],
          properties: {
            from: { type: 'string', description: 'Optional source language, or auto if unknown.' },
            to: { type: 'string', description: 'Optional target language.' },
            text: { type: 'string', description: 'Text to translate.' },
          },
        },
      },
    },
    resultMode: 'direct',
    inline: {
      order: 10,
      title: 'Translate',
      description: 'Default: English to Russian, Russian to English.',
      buildArgs(query) {
        const text = query.trim();
        return text ? { text } : undefined;
      },
    },
    async run(args) {
      const from = optionalString(args, 'from') ?? 'auto';
      const to = optionalString(args, 'to') ?? 'auto-default';
      const text = requiredString(args, 'text');
      const response = await client.chat({
        model: model(),
        think: true,
        messages: [
          {
            role: 'system',
            content: TRANSLATION_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: `Translate from ${from} to ${to}:\n\n${text}`,
          },
        ],
      });
      return response.message.content.trim();
    },
  };
}
