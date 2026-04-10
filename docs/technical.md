# Technical Details

This document holds the detailed project behavior that used to live in the main README.

## Runtime Overview

The bot receives Telegram messages, sends them to a local Gemma model through Ollama, lets the model use registered tools when useful, and sends the answer back in Telegram. While an answer is being generated, it can stream partial text into Telegram draft messages so progress is visible before the final answer is sent.

If `WEBHOOK_URL` is configured, the bot also long-polls a separate webhook service for uploaded audio events. Those webhook events are treated as private voice requests from the owner, and the remote audio file is deleted from the webhook service right after the bot downloads it.

## Access Control

The bot is private by default. It requires `ALLOWED_TELEGRAM_USER_IDS` in `.env`, and it only processes messages from those Telegram user IDs.

If someone else sends a message to the bot, the bot logs that the user was rejected and does not answer them.

The Telegram bot token is stored only in `.env`. The `.env` file is ignored by Git and must not be committed. The example file `.env.example` shows the required settings without secrets.

## Model

The default local model is:

```text
OLLAMA_MODEL=gemma4:e2b
```

Text answers use model thinking when enabled by `OLLAMA_THINKING`, but hidden thinking is never sent back to Telegram.

The Telegram menu includes `/model`. It shows Gemma model buttons for:

- `gemma4:26b`
- `gemma4:e4b`
- `gemma4:e2b`

When a model is selected, the running bot applies it immediately and saves it in runtime settings. The saved runtime setting has higher priority than `OLLAMA_MODEL`. The startup notification includes the model that will be used by the running bot.

The Telegram menu also includes `/voice_model`. It shows Whisper model buttons for:

- `ggml-large-v3-turbo-q5_0`
- `ggml-large-v3-turbo`
- `tiny`
- `base`
- `small`
- `medium`
- `large-v3`

When a voice model is selected, the running bot applies it immediately and saves it in runtime settings. The saved runtime setting has higher priority than `WHISPER_MODEL`. The startup notification includes the voice-transcription model that will be used by the running bot.

## Tools

The model has access to these tools when they are registered in the current run:

- `web_search` searches the web through Tavily when `TAVILY_API_KEY` is configured and the startup health check passes.
- `web_fetch` extracts a specific URL through Tavily Extract when `TAVILY_API_KEY` is configured and the startup health check passes.
- `calc` evaluates simple arithmetic expressions and returns the result directly.
- `codex` delegates coding or implementation work to `codex-proxy` in a separate local workspace and returns the result directly.
- `yt-download` downloads a URL with the configured local video-download script and returns the script output directly.
- `ls` lists files in a provided local path, including paths that start with `~`, and returns the result directly.
- `time` shows the current machine date/time plus London and New York directly.
- `translate` translates text directly. `from` and `to` are optional. The default behavior is English to Russian, Russian to English, and other detected languages to English.
- `grammar` fixes grammar, spelling, punctuation, and wording in any language and returns the result directly.
- `human_research` builds a public-profile research report for a human from clues such as name, email, company, or role. It uses search plus local LLM summarization and returns a PDF directly. It is disabled by default and must be enabled explicitly with `HUMAN_RESEARCH_ENABLED=true`.
- `reminder` creates, lists, and deletes one-time reminder tasks. Its output is returned directly.
- `tools` lists the currently registered tools directly, without asking the model to rewrite the list.
- `cron` creates, edits, deletes, enables, disables, and lists local scheduled tasks. Its output is returned directly.

Tools with `resultMode: direct` are sent to Telegram without another model-analysis pass.

## Human Research

The `human_research` tool is intended for public professional or creator research only. It is not for private personal investigation.

The flow is:

1. The model decides to call `human_research` with the full human research request.
2. The tool classifies the person into a broad public-profile archetype such as founder, indie developer, creator, agency owner, executive, employee, researcher, or open-source maintainer.
3. The tool creates a focused search plan with 6 to 10 one-question search queries.
4. Each query is searched and summarized separately.
5. The tool can add a few follow-up queries when it needs to resolve ambiguity between several matching profiles or when key public signals are still missing.
6. A final local-LLM pass merges the answers into a structured Markdown report.
7. A deterministic appendix adds exact public URLs and other source-backed signals.
8. The report is rendered to PDF and sent to Telegram as a document.

The report is designed to cover:

- likely identity match and ambiguity
- public location and contact clues
- current role or company
- exact public social and platform profile URLs when available
- public products, services, pricing, and public MRR or revenue signals when publicly disclosed
- public tools, integrations, or stack signals
- public content, audience, and collaboration signals
- recent public activity ordered by date

The archetype matters. Commercial details such as pricing, subscriptions, public MRR, and launch offers are emphasized only for archetypes where that information is relevant, such as founders, indie developers, creators, and agency owners. For non-commercial archetypes such as researchers or open-source maintainers, the report instead emphasizes role, projects, repositories, talks, and recent public work.

The tool is intentionally limited to public professional or creator information. Do not extend it to private addresses, phone numbers, family details, government IDs, private purchases, or other sensitive personal data.

Synthetic validation data for fake humans lives under `src/humanResearch/synthetic.ts`, and the real-model regression script is:

```sh
npm run test:human-research
```

That script uses `gemma4:26b`, mocked synthetic search results, and writes Markdown, JSON, and PDF outputs to a temp directory outside the project.

## Live Answer Streaming

Telegram `sendMessageDraft` lets bots stream partial generated messages into a chat while the final answer is still being produced.

This project uses that API for private chats when this is set:

```text
TELEGRAM_STREAM_DRAFTS=true
```

Draft streaming is progress UI. Telegram can remove drafts after generation. By default, the bot also sends a final normal Telegram message with:

```text
TELEGRAM_SEND_FINAL_MESSAGE=true
```

Direct tool results skip the final draft update and are sent as normal messages.

## Voice Messages

Telegram voice messages are downloaded through the Telegram file API, saved as a temporary audio file, and transcribed by `scripts/transcribe-voice.sh`. The helper supports two local backends:

- `ggml-*` models use `whisper.cpp`
- legacy model names such as `tiny`, `base`, `small`, `medium`, and `large-v3` use the Python Whisper CLI

The recognized text is then passed into the same assistant path as if it was typed manually.

Webhook audio events use the same Whisper helper. The webhook service stores uploaded bytes temporarily, and the bot requests deletion of that remote file immediately after downloading it.

The default voice model is speed-first:

```text
WHISPER_MODEL=ggml-large-v3-turbo-q5_0
```

For `ggml-*` models, the helper uses `whisper.cpp` and can reuse models already installed by VoiceInk from the default app-support directory. If `WHISPER_CPP_BIN` is not set, the helper tries `whisper-cli` from `PATH`, then `~/web/whisper.cpp/build/bin/whisper-cli`. If `WHISPER_CPP_MODEL_DIR` is not set, the helper tries the VoiceInk model directory automatically.

Measured locally on short test audio:

- `ggml-large-v3-turbo-q5_0`: about `1.6s` to `2.2s`
- `ggml-large-v3-turbo`: about `2.2s` after warm-up, but the first run can be very slow because Core ML may compile and warm the encoder
- legacy Python `medium`: about `10s`
- legacy Python `large-v3`: about `19s` to `31s`

For legacy Python Whisper models, the helper auto-selects Apple `mps` when available and falls back to CPU. It keeps `WHISPER_FP16=False` by default because large Whisper models can produce unstable `nan` logits on Apple MPS with fp16.

## Image Messages

Telegram photo messages and image documents are downloaded through the Telegram file API and sent to the configured Ollama chat model as image input.

If the image has a caption, the caption is used as the prompt. If the image is sent without text, the bot uses a default image-analysis prompt and replies with the model response.

The configured Ollama chat model must support image input. The default `gemma4:e2b` model supports image input.

## Codex Tool

The `codex` tool delegates coding or implementation tasks to the local Codex CLI through `codex-proxy`. It runs in a separate workspace by default:

```text
~/web/my-local-bro-workspace
```

The default command is loaded through zsh so the `codex-proxy` function from `.zshrc` is available. The tool uses `codex-proxy exec`, writes the final Codex answer to a temp file, and returns that final answer directly to Telegram.

The default timeout is 20 minutes. `/stop` and `/stopall` abort the active model generation and terminate the active Codex process group.

## Inline Mode

Telegram inline mode lets you type the bot username in the message field, add text, and choose a tool result without sending a slash command.

Example:

```text
@your_bot_name hello my friend
```

Telegram can show inline results such as:

- `Translate`
- `Fix grammar`

Inline mode currently starts with direct text tools:

- `translate`
- `grammar`

Inline mode is implemented but disabled during normal runs by default. To enable it later, enable inline mode for the bot in BotFather with `/setinline`, then set:

```text
TELEGRAM_ENABLE_INLINE_MODE=true
```

Telegram does not let the bot enable BotFather inline mode by itself.

## Menu Button

The bot configures Telegram's menu button as a command menu by default.

The menu includes:

- `/translate` to enable translate mode.
- `/grammar` to enable grammar-fix mode.
- `/model` to show Gemma model buttons and save the selected model.
- `/voice_model` to show Whisper model buttons and save the selected transcription model.
- `/normal` to return to normal assistant mode.
- `/stop` to stop the current task.
- `/stopall` to stop the current task and clear queued tasks.

Translate mode and grammar mode are stateful. After choosing one from the menu, send the text normally and the bot processes it directly without asking the main assistant model.

Menu mode can be changed without removing code:

```text
TELEGRAM_MENU_BUTTON=commands
```

Supported values:

- `commands` uses the Telegram command menu.
- `default` restores Telegram's default menu button.
- `web_app` opens a Telegram Web App and requires `TELEGRAM_MENU_WEB_APP_URL`.
- `none` skips menu-button setup on startup.

## Video Downloads

The model can choose the `yt-download` tool when it decides a URL should be downloaded as a video. There is no hard-coded domain allow-list in the bot; the decision is left to the model.

The tool runs the script configured by `YT_DOWNLOAD_SCRIPT` with the URL as a safe process argument, so Telegram text is not executed as shell code. The script is expected to live in `~/Movies/ShortsToProcess/video-dl.sh` and stores videos under either date-grouped directories like `YYYY/Month/DD/001/` or explicit category paths such as `hook/001/` and `other/001/` when the user requests those categories.

Each stored item should contain:

- `reference_original.mp4`
- `reference.mp4`

`reference.mp4` is the QuickTime-friendly ffmpeg conversion. The local script also keeps a SQLite index with media id, title, author, paths, and file sizes, so reruns can skip downloads when the media is already stored and only fill missing conversion or metadata.

The SQLite row stores both the original input URL (`source_url`) and the final resolved page URL (`resolved_url`).

The script currently skips conversion by default. To enable conversion and enforce `reference.mp4` generation again, run it with:

```text
SHORTS_ENABLE_CONVERSION=true
```

For Instagram URLs, the script first tries a saved cookies file if one exists. This avoids repeated macOS Keychain prompts and avoids daemon hangs on browser-cookie extraction. If the cookies file is missing or fails, the script falls back to a plain `yt-dlp` download. Browser-cookie extraction is optional and disabled by default.

```text
SHORTS_COOKIES_FILE=~/Movies/ShortsToProcess/cookies/instagram-cookies.txt
SHORTS_COOKIES_FROM_BROWSER=
SHORTS_COOKIES_TIMEOUT_SECONDS=8
```

`yt-download` returns its result directly to Telegram without a second model pass. The reply should stay concise and can include the original URL, file id, title, category, size, and whether the run downloaded, reused, repaired, or only converted the media.

## Cron Tasks

The bot includes a local cron module enabled by default. It stores task registrations in JSON so tasks can be read and recovered after restart:

```text
data/cron-tasks.json
```

The main assistant can use the `cron` tool to:

- create a task
- edit a task by integer ID
- delete a task by integer ID
- list tasks
- enable a task by integer ID
- disable a task by integer ID

Schedules can be five-field crontab expressions:

```text
* * * * *
```

The cron tool also accepts simple human phrases and converts them:

- `every minute` -> `* * * * *`
- `every hour` -> `0 * * * *`
- `every day` -> `0 9 * * *`
- `every 5 minutes` -> `*/5 * * * *`

Each task stores:

- integer ID
- schedule
- command/script path
- command args
- prompt for checking the command output
- Telegram author chat for notifications

When a cron task runs, the bot executes the configured command with safe argument arrays, captures stdout/stderr, then passes the result and task prompt to the same Ollama model. That cron review pass does not receive the normal tool list. It only receives one restricted tool:

```text
send_message
```

The `send_message` tool is not available in the main assistant tools. It can only send a Telegram message to the author of that cron task, and its description tells the model to call it only when the task prompt explicitly says the result should be sent and the output satisfies the condition.

Cron logs do not print command stdout/stderr. Logs record only execution status and the final cron review tool decision, for example whether no tool was called or `send_message` was called.

Notification format:

```text
Cron #3 Notification:
Cat is found
```

A test script can be kept locally, for example:

```text
~/Downloads/test-bot.sh
```

Avoid enabling every-minute test tasks unless you explicitly want notifications; they can spam the chat.

## Reminders

The bot includes a local reminder module enabled by default. It stores pending one-time reminders in JSON and archives delivered reminders into a separate directory:

```text
data/reminders.json
data/reminders-done/
```

The main assistant can use the `reminder` tool to:

- create a reminder
- list pending reminders
- delete a reminder by integer ID

The reminder tool expects:

- `text` as concise English reminder text
- `dueAt` as a full ISO 8601 date/time string with timezone offset

Relative requests such as `in 1 hour`, `tomorrow at 9:30`, or similar non-English phrasings are interpreted by the main model using the current local time context included in the system prompt.

Pending reminders are checked every minute by default:

```text
REMINDER_TICK_MS=60000
```

When a reminder becomes due, or if the bot was offline and the reminder is now overdue, the scheduler sends it directly to Telegram without another LLM pass:

```text
⏰ Reminder #3:
Call the store
```

After delivery, the reminder is removed from the pending JSON file and archived into `data/reminders-done/`.

## Bot Commands

The bot handles these commands directly, without asking the AI model:

- `/stop` stops only the currently running model task. Messages already waiting in the queue continue after the current task is cancelled.
- `/stopall` stops the current model task and clears every pending queued message.

These commands are handled outside the normal queue, so they can interrupt a running generation immediately instead of waiting for the model response.

## Message Queue

The bot processes messages one at a time.

If several messages are sent quickly, they are added to a queue and handled in order. This makes behavior easier to debug and prevents multiple model calls from mixing their responses.

## Logs

Every log line starts with a human-readable date and time in brackets, followed by an emoji that shows the kind of event.

Examples:

```text
[2026-04-07 18:45:12] 📨 Input message received {"chatId":123,"chatType":"private","fromUserId":456,"messageId":789,"text":"hello","hasVoice":false}
[2026-04-07 18:45:18] ✅ Finished message 789
[2026-04-07 18:46:02] ❌ Tool failed: web_search {"name":"Error","message":"..."}
```

Logs are stored by year, month, day, and hour:

```text
logs/2026/04/07/18.log
```

These files are ignored by Git, so debugging logs stay local.

Startup logs now also state whether webhook subscription is enabled or disabled. The Telegram startup message does not reveal the webhook URL or passwords.

## Shutdown

Pressing `Ctrl+C` stops Telegram polling immediately, aborts the active model generation if one is running, logs what was cancelled, and then exits. If shutdown hangs, pressing `Ctrl+C` again forces the process to exit.

## Project Layout

The project keeps files small and focused. The long-term rule is documented in `AGENTS.md`: source files should stay under 400 lines and be split by responsibility.

Main areas:

- `src/index.ts` wires the service together.
- `src/config.ts` loads `.env` settings.
- `src/telegram/` handles Telegram API calls and polling.
- `src/model/` handles Ollama model calls and voice transcription.
- `src/tools/` contains model-callable tools.
- `src/reminder/` contains one-time reminder storage and scheduling.
- `src/logger.ts` writes console and file logs.
- `src/service.ts` handles one Telegram message end-to-end.

## Required Settings

Create or edit `.env` with these values:

```text
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
ALLOWED_TELEGRAM_USER_IDS=your-telegram-user-id
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:e2b
OLLAMA_THINKING=medium
OLLAMA_CONTEXT_TOKENS=32768
RUNTIME_SETTINGS_PATH=data/settings.json
WHISPER_BIN=whisper
WHISPER_MODEL=large-v3
WHISPER_MODEL_DIR=~/.cache/whisper
WHISPER_DEVICE=auto
WHISPER_BEAM_SIZE=5
WHISPER_THREADS=0
WHISPER_LANGUAGE=
WHISPER_ALLOW_DOWNLOAD=false
WHISPER_FP16=False
OLLAMA_API_KEY=your-ollama-api-key-if-needed
TAVILY_API_KEY=your-tavily-api-key-for-web-tools
YT_DOWNLOAD_SCRIPT=~/Movies/ShortsToProcess/video-dl.sh
WEBHOOK_URL=
WEBHOOK_UPLOAD_PASSWORD=
WEBHOOK_CONTROL_PASSWORD=
WEBHOOK_POLL_TIMEOUT_SECONDS=25
WEBHOOK_BIND_HOST=0.0.0.0
WEBHOOK_PORT=3000
WEBHOOK_AUDIO_DIR=data/webhook-audio
WEBHOOK_STORAGE_PATH=data/webhook-state.json
WEBHOOK_MAX_AUDIO_BYTES=20971520
TELEGRAM_STREAM_DRAFTS=true
TELEGRAM_SEND_FINAL_MESSAGE=true
TELEGRAM_POLL_TIMEOUT_SECONDS=30
TELEGRAM_ENABLE_INLINE_MODE=false
TELEGRAM_MENU_BUTTON=commands
TELEGRAM_MENU_WEB_APP_TEXT=Open tools
TELEGRAM_MENU_WEB_APP_URL=
CRON_ENABLED=true
CRON_STORAGE_PATH=data/cron-tasks.json
CRON_TICK_MS=15000
CRON_COMMAND_TIMEOUT_MS=120000
CRON_ALLOW_SEND_MESSAGE_TOOL=true
REMINDER_ENABLED=true
REMINDER_STORAGE_PATH=data/reminders.json
REMINDER_ARCHIVE_DIR=data/reminders-done
REMINDER_TICK_MS=60000
CODEX_COMMAND=codex-proxy
CODEX_MODEL=gpt-5.3-codex
CODEX_REASONING=high
CODEX_WORKSPACE=~/web/my-local-bro-workspace
CODEX_TIMEOUT_MS=1200000
CODEX_SHELL=/bin/zsh
CODEX_SOURCE_ZSHRC=true
```

`TAVILY_API_KEY` is required for the Tavily-backed `web_search` and `web_fetch` tools. If it is empty or the startup health check fails, those tools are not registered and the model is told web tools are unavailable. The local model itself uses `OLLAMA_HOST`.

`RUNTIME_SETTINGS_PATH` stores user-selected runtime settings such as the active Ollama model. If the file contains a saved model, that model overrides `OLLAMA_MODEL` on startup.

## Translation Benchmark

Use `npm run benchmark:translation` to compare local translation quality and speed across the configured benchmark models. The script writes `results.json`, `summary.md`, and per-model Markdown files to a timestamped directory under the OS temp directory by default.

You can override the output directory or model list:

```sh
npm run benchmark:translation -- --out /tmp/my-translation-run --models gemma4:26b,gemma4:e4b
```

## Current Limitations

- Voice transcription depends on the local Whisper CLI and `ffmpeg`.
- The bot uses Telegram long polling, not webhooks.
- Web search and fetch depend on Tavily and require a Tavily API key.
- This is built for private use by a small allow-list, not for a public multi-user bot.
