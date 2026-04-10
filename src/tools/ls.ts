import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { truncateText } from '../util/text.js';
import type { ToolRuntime } from './types.js';

function pathArg(args: Record<string, unknown>): string {
  const value = args.path;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('path must be a non-empty string');
  }
  return expandHome(value.trim());
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

export function createLsTool(): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'ls',
        description: 'List files and directories at a provided filesystem path. Supports ~ for the home directory.',
        parameters: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'Directory path to list. Supports ~ and ~/subdir.' },
          },
        },
      },
    },
    resultMode: 'direct',
    async run(args) {
      const directory = pathArg(args);
      const entries = await readdir(directory, { withFileTypes: true });
      const files = entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other',
      }));
      files.sort((a, b) => a.name.localeCompare(b.name));
      const listing = files.map((entry) => `- [${entry.type}] ${entry.name}`).join('\n');
      return truncateText(`Files in ${directory}:\n${listing || '(empty)'}`, 8000);
    },
  };
}
