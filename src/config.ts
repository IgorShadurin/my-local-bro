import dotenv from 'dotenv';
import os from 'node:os';

dotenv.config();

export interface AppConfig {
  telegram: {
    botToken: string;
    allowedUserIds: Set<number>;
    pollTimeoutSeconds: number;
    streamDrafts: boolean;
    sendFinalMessage: boolean;
    enableInlineMode: boolean;
    menuButton: 'commands' | 'default' | 'none' | 'web_app';
    menuWebAppText: string;
    menuWebAppUrl?: string;
  };
  ollama: {
    host: string;
    model: string;
    apiKey?: string;
    thinking: boolean | 'high' | 'medium' | 'low';
    contextTokens: number;
  };
  whisper: {
    model: string;
  };
  cron: {
    enabled: boolean;
    storagePath: string;
    tickMs: number;
    commandTimeoutMs: number;
    allowSendMessageTool: boolean;
  };
  reminder: {
    enabled: boolean;
    storagePath: string;
    archiveDir: string;
    tickMs: number;
  };
  humanResearch: {
    enabled: boolean;
  };
  codex: {
    command: string;
    model: string;
    reasoning: 'low' | 'medium' | 'high' | 'xhigh';
    workspace: string;
    timeoutMs: number;
    shell: string;
    sourceZshrc: boolean;
  };
  runtime: {
    settingsPath: string;
  };
  ytDownload: {
    scriptPath: string;
    dbPath: string;
  };
  linkIngest: {
    enabled: boolean;
    host: string;
    port: number;
    token?: string;
  };
  webhook: {
    url?: string;
    uploadPassword?: string;
    controlPassword?: string;
    pollTimeoutSeconds: number;
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = optional(name);
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function numberEnv(name: string, fallback: number): number {
  const value = optional(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function parseAllowedUsers(value: string): Set<number> {
  const ids = value.split(',').map((item) => Number(item.trim())).filter(Number.isFinite);
  if (ids.length === 0) {
    throw new Error('ALLOWED_TELEGRAM_USER_IDS must contain at least one numeric user ID');
  }
  return new Set(ids);
}

function parseThinking(value: string | undefined): boolean | 'high' | 'medium' | 'low' {
  if (!value || value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  throw new Error('OLLAMA_THINKING must be true, false, high, medium, or low');
}

function parseCodexReasoning(value: string | undefined): AppConfig['codex']['reasoning'] {
  if (!value) return 'high';
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
  throw new Error('CODEX_REASONING must be low, medium, high, or xhigh');
}

function parseMenuButton(value: string | undefined): AppConfig['telegram']['menuButton'] {
  if (!value) return 'commands';
  if (value === 'commands' || value === 'default' || value === 'none' || value === 'web_app') return value;
  throw new Error('TELEGRAM_MENU_BUTTON must be commands, default, none, or web_app');
}

function expandHome(path: string): string {
  if (path === '~') return os.homedir();
  if (path.startsWith('~/')) return `${os.homedir()}/${path.slice(2)}`;
  return path;
}

export function loadConfig(): AppConfig {
  const apiKey = optional('OLLAMA_API_KEY');
  const menuButton = parseMenuButton(optional('TELEGRAM_MENU_BUTTON'));
  const menuWebAppUrl = optional('TELEGRAM_MENU_WEB_APP_URL');
  const webhookUrl = optional('WEBHOOK_URL');
  const webhookUploadPassword = optional('WEBHOOK_UPLOAD_PASSWORD');
  const webhookControlPassword = optional('WEBHOOK_CONTROL_PASSWORD');
  const linkIngestToken = optional('LINK_INGEST_TOKEN');
  if (menuButton === 'web_app' && !menuWebAppUrl) {
    throw new Error('TELEGRAM_MENU_WEB_APP_URL is required when TELEGRAM_MENU_BUTTON=web_app');
  }
  if (webhookUrl && (!webhookUploadPassword || !webhookControlPassword)) {
    throw new Error('WEBHOOK_UPLOAD_PASSWORD and WEBHOOK_CONTROL_PASSWORD are required when WEBHOOK_URL is set');
  }

  const ollamaConfig: AppConfig['ollama'] = {
    host: optional('OLLAMA_HOST') ?? 'http://127.0.0.1:11434',
    model: optional('OLLAMA_MODEL') ?? 'gemma4:e2b',
    thinking: parseThinking(optional('OLLAMA_THINKING')),
    contextTokens: numberEnv('OLLAMA_CONTEXT_TOKENS', 32768),
  };
  if (apiKey) {
    ollamaConfig.apiKey = apiKey;
  }

  return {
    telegram: {
      botToken: required('TELEGRAM_BOT_TOKEN'),
      allowedUserIds: parseAllowedUsers(required('ALLOWED_TELEGRAM_USER_IDS')),
      pollTimeoutSeconds: numberEnv('TELEGRAM_POLL_TIMEOUT_SECONDS', 30),
      streamDrafts: boolEnv('TELEGRAM_STREAM_DRAFTS', true),
      sendFinalMessage: boolEnv('TELEGRAM_SEND_FINAL_MESSAGE', true),
      enableInlineMode: boolEnv('TELEGRAM_ENABLE_INLINE_MODE', false),
      menuButton,
      menuWebAppText: optional('TELEGRAM_MENU_WEB_APP_TEXT') ?? 'Open tools',
      ...(menuWebAppUrl ? { menuWebAppUrl } : {}),
    },
    ollama: ollamaConfig,
    whisper: {
      model: optional('WHISPER_MODEL') ?? 'ggml-large-v3-turbo-q5_0',
    },
    cron: {
      enabled: boolEnv('CRON_ENABLED', true),
      storagePath: optional('CRON_STORAGE_PATH') ?? 'data/cron-tasks.json',
      tickMs: numberEnv('CRON_TICK_MS', 15_000),
      commandTimeoutMs: numberEnv('CRON_COMMAND_TIMEOUT_MS', 120_000),
      allowSendMessageTool: boolEnv('CRON_ALLOW_SEND_MESSAGE_TOOL', true),
    },
    reminder: {
      enabled: boolEnv('REMINDER_ENABLED', true),
      storagePath: optional('REMINDER_STORAGE_PATH') ?? 'data/reminders.json',
      archiveDir: optional('REMINDER_ARCHIVE_DIR') ?? 'data/reminders-done',
      tickMs: numberEnv('REMINDER_TICK_MS', 60_000),
    },
    humanResearch: {
      enabled: boolEnv('HUMAN_RESEARCH_ENABLED', false),
    },
    codex: {
      command: optional('CODEX_COMMAND') ?? 'codex-proxy',
      model: optional('CODEX_MODEL') ?? 'gpt-5.3-codex',
      reasoning: parseCodexReasoning(optional('CODEX_REASONING')),
      workspace: expandHome(optional('CODEX_WORKSPACE') ?? '~/web/my-local-bro-workspace'),
      timeoutMs: numberEnv('CODEX_TIMEOUT_MS', 20 * 60 * 1000),
      shell: optional('CODEX_SHELL') ?? '/bin/zsh',
      sourceZshrc: boolEnv('CODEX_SOURCE_ZSHRC', true),
    },
    runtime: {
      settingsPath: expandHome(optional('RUNTIME_SETTINGS_PATH') ?? 'data/settings.json'),
    },
    ytDownload: {
      scriptPath: expandHome(optional('YT_DOWNLOAD_SCRIPT') ?? '~/Movies/ShortsToProcess/video-dl.sh'),
      dbPath: expandHome(optional('YT_DOWNLOAD_DB_PATH') ?? '~/Movies/ShortsToProcess/shorts.sqlite3'),
    },
    linkIngest: {
      enabled: boolEnv('LINK_INGEST_ENABLED', true),
      host: optional('LINK_INGEST_HOST') ?? '127.0.0.1',
      port: numberEnv('LINK_INGEST_PORT', 45123),
      ...(linkIngestToken ? { token: linkIngestToken } : {}),
    },
    webhook: {
      ...(webhookUrl ? { url: webhookUrl } : {}),
      ...(webhookUploadPassword ? { uploadPassword: webhookUploadPassword } : {}),
      ...(webhookControlPassword ? { controlPassword: webhookControlPassword } : {}),
      pollTimeoutSeconds: numberEnv('WEBHOOK_POLL_TIMEOUT_SECONDS', 25),
    },
  };
}
