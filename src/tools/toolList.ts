import { truncateText } from '../util/text.js';
import type { ToolRegistry, ToolRuntime } from './types.js';

function isToolListRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ');
  return [
    'tools',
    'list tools',
    'show tools',
    'show list of tools',
    'show tool list',
    'list of tools',
    'available tools',
    'show available tools',
    'what tools are available',
    'what tools do you have',
  ].includes(normalized);
}

function toolName(tool: ToolRuntime): string {
  return tool.definition.function.name ?? 'unknown';
}

function toolDescription(tool: ToolRuntime): string {
  const description = tool.definition.function.description;
  if (typeof description !== 'string' || !description.trim()) return 'No description.';
  return truncateText(description.replace(/\s+/g, ' ').trim(), 220);
}

function formatTools(registry: ToolRegistry): string {
  const tools = [...registry.values()]
    .filter((tool) => toolName(tool))
    .sort((a, b) => toolName(a).localeCompare(toolName(b)));

  if (tools.length === 0) return 'No tools are currently registered.';

  return [
    'Available tools:',
    ...tools.map((tool) => `- **${toolName(tool)}**: ${toolDescription(tool)}`),
  ].join('\n\n');
}

export function createToolListTool(getRegistry: () => ToolRegistry): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'tools',
        description: 'List currently registered assistant tools. The result is final and should be returned as-is.',
        parameters: {
          type: 'object',
          required: [],
          properties: {},
        },
      },
    },
    resultMode: 'direct',
    directCommands: [{
      description: 'Direct tool list commands that should bypass the LLM.',
      buildArgs: (text) => isToolListRequest(text) ? {} : undefined,
    }],
    async run() {
      return formatTools(getRegistry());
    },
  };
}
