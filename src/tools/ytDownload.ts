import type { AppConfig } from '../config.js';
import { formatExecError, parseShortsCategory, requireUrl, runShortsDownload } from '../downloader/shortsToProcess.js';
import { truncateText } from '../util/text.js';
import type { ToolRuntime } from './types.js';

export function createYtDownloadTool(config: AppConfig['ytDownload']): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'yt-download',
        description: 'Download one URL using the local ShortsToProcess yt-dlp wrapper script when the model decides the URL should be downloaded. If the user explicitly provides the supported category hook or other, pass it as category. The script output is final and must be returned as-is without extra model analysis.',
        parameters: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'URL to download.' },
            category: { type: 'string', description: 'Optional storage category. Currently supported values are hook and other.' },
          },
        },
      },
    },
    resultMode: 'direct',
    async run(args, context) {
      const url = requireUrl(args.url);
      const category = parseShortsCategory(args.category);
      try {
        const details = await runShortsDownload({
          scriptPath: config.scriptPath,
          url,
          ...(category ? { category } : {}),
          ...(context?.signal ? { signal: context.signal } : {}),
        });
        return truncateText(details || 'Download finished, but the script returned no output.', 8000);
      } catch (error) {
        throw new Error(`yt-download failed: ${formatExecError(error)}`);
      }
    },
  };
}
