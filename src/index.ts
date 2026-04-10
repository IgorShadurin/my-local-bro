import { CommandRouter } from './commands.js';
import { loadConfig } from './config.js';
import { CronReviewAgent } from './cron/reviewAgent.js';
import { CronRunner } from './cron/runner.js';
import { CronScheduler } from './cron/scheduler.js';
import { CronTaskStorage } from './cron/storage.js';
import { InlineQueryRouter } from './inline.js';
import { Logger } from './logger.js';
import { LinkBatchImporter } from './linkIngest/importer.js';
import { LinkIngestServer } from './linkIngest/server.js';
import { ModelSelector } from './modelSelector.js';
import { createOllamaClient } from './model/ollamaClient.js';
import { OllamaAgent } from './model/ollamaAgent.js';
import { WhisperVoiceTranscriber } from './model/voiceTranscriber.js';
import { AsyncQueue } from './queue.js';
import { ReminderScheduler } from './reminder/scheduler.js';
import { ReminderStorage } from './reminder/storage.js';
import { BotService } from './service.js';
import { RuntimeSettingsStore } from './settings.js';
import { TelegramClient } from './telegram/client.js';
import { TelegramPoller } from './telegram/poller.js';
import { notifyOwnersServiceStarted } from './telegram/startup.js';
import { setupTelegramUi } from './telegram/ui.js';
import { createToolRegistry } from './tools/index.js';
import { probeWebTools } from './tools/web.js';
import { WebhookAudioProcessor } from './webhook/processor.js';
import { type QueuedTask, WebhookSubscriber } from './webhook/subscriber.js';

async function main(): Promise<void> {
  const logger = new Logger();
  const config = loadConfig();
  const settings = new RuntimeSettingsStore(config.runtime.settingsPath, logger);
  const telegram = new TelegramClient(config.telegram, logger);
  const modelSelector = new ModelSelector(config, telegram, settings, logger);
  await modelSelector.applySavedModel();
  const ollama = createOllamaClient(config.ollama);
  const cronStorage = config.cron.enabled ? new CronTaskStorage(config.cron.storagePath) : undefined;
  const reminderStorage = config.reminder.enabled
    ? new ReminderStorage(config.reminder.storagePath, config.reminder.archiveDir)
    : undefined;
  const enableWebTools = await resolveWebToolsEnabled(process.env.TAVILY_API_KEY, logger);
  const tools = createToolRegistry(ollama, () => config.ollama.model, {
    enableWebTools,
    enableHumanResearch: config.humanResearch.enabled,
    codex: config.codex,
    ytDownload: config.ytDownload,
    ...(cronStorage ? { cronStorage } : {}),
    ...(reminderStorage ? { reminderStorage } : {}),
  });
  const agent = new OllamaAgent(ollama, config.ollama, tools, logger);
  const cronScheduler = cronStorage
    ? new CronScheduler(
      cronStorage,
      new CronRunner(
        new CronReviewAgent(ollama, config.ollama, telegram, logger, config.cron.allowSendMessageTool),
        logger,
        config.cron.commandTimeoutMs,
      ),
      logger,
      config.cron.tickMs,
    )
    : undefined;
  const reminderScheduler = reminderStorage
    ? new ReminderScheduler(reminderStorage, telegram, logger, config.reminder.tickMs)
    : undefined;
  const transcriber = new WhisperVoiceTranscriber(telegram, logger, config.whisper);
  const service = new BotService(config, telegram, agent, transcriber, tools, logger);
  const queue = new AsyncQueue<QueuedTask>(logger, (task) => task.run());
  const linkBatchImporter = new LinkBatchImporter(telegram, logger, config);
  const linkIngestServer = new LinkIngestServer(config.linkIngest, queue, linkBatchImporter, logger);
  const webhookProcessor = new WebhookAudioProcessor(config, telegram, agent, transcriber, logger);
  const commands = new CommandRouter(
    agent,
    queue,
    telegram,
    logger,
    modelSelector,
    (message) => service.handle(message),
    () => linkBatchImporter.cancelCurrent(),
  );
  // Inline mode stays implemented, but it is not registered during normal runs unless enabled in .env.
  const inlineQueries = config.telegram.enableInlineMode ? new InlineQueryRouter(telegram, tools, logger) : undefined;
  const poller = new TelegramPoller(telegram, config.telegram, queue, commands, inlineQueries, logger);
  const webhookSubscriber = new WebhookSubscriber(config.webhook, queue, logger, (event) => webhookProcessor.handle(event));
  let shutdownRequested = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shutdownRequested) {
      logger.warn(`${signal} received again; forcing exit`);
      process.exit(130);
    }
    shutdownRequested = true;
    logger.warn(`${signal} received; stopping Telegram polling and active model generation`);
    poller.stop();
    webhookSubscriber.stop();
    linkIngestServer.stop();
    cronScheduler?.stop();
    reminderScheduler?.stop();
    const cancelled = agent.cancelCurrentGeneration();
    logger.info('✅', `Shutdown cancellation requested. Active model task cancelled: ${cancelled}`);
    setTimeout(() => {
      logger.warn('Shutdown timeout reached; forcing exit');
      process.exit(130);
    }, 1500).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.success(`Service booted with model ${config.ollama.model}`);
  logger.info('ℹ️', `Webhook ${config.webhook.url ? 'enabled' : 'disabled'}`);
  await linkIngestServer.start();
  await setupTelegramUi(telegram, config.telegram, logger);
  cronScheduler?.start();
  reminderScheduler?.start();
  await notifyOwnersServiceStarted(telegram, config, logger);
  void webhookSubscriber.start();
  await poller.start();
  logger.success('Service stopped');
}

async function resolveWebToolsEnabled(apiKey: string | undefined, logger: Logger): Promise<boolean> {
  if (!apiKey) {
    logger.warn('TAVILY_API_KEY is not set; web_search and web_fetch tools are disabled');
    return false;
  }

  const probe = await probeWebTools();
  if (probe.ok) {
    logger.success('Tavily web tools enabled');
    return true;
  }

  logger.warn(`Tavily web tools disabled after health check: ${probe.reason ?? 'unknown error'}`);
  return false;
}

main().catch((error) => {
  const logger = new Logger();
  logger.error('Service crashed during startup', error);
  process.exitCode = 1;
});
