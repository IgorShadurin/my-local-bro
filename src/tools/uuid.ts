import { randomUUID } from 'node:crypto';
import type { ToolRuntime } from './types.js';

export function createUuidTool(): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'uuid',
        description: 'Generate a UUID. Return only the UUID string as-is.',
        parameters: {
          type: 'object',
          required: [],
          properties: {},
        },
      },
    },
    resultMode: 'direct',
    async run() {
      return randomUUID();
    },
  };
}
