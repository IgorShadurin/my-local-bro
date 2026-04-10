# Agency Rules

This service is intended to be reliable and easy to change. Keep the codebase organized around small, focused files.

## File Size

- Keep every source file at or below 400 lines.
- If a file approaches 400 lines, split it before adding more behavior.
- Prefer helpers, interfaces, adapters, and focused services over one large main file.

## Structure

- Keep `src/index.ts` as composition-only wiring.
- Put Telegram API code in `src/telegram/`.
- Put Ollama/model orchestration in `src/model/`.
- Put model-callable tools in `src/tools/`.
- Put cron scheduler code in `src/cron/`.
- Put one-time reminder scheduler code in `src/reminder/`.
- Put public human-research planning, summarization, PDF rendering, and search adapters in `src/humanResearch/`.
- Put webhook server and bot-side webhook subscription code in `src/webhook/`.
- Put shared generic helpers in `src/util/`.

## Runtime Settings

- Runtime settings live behind `src/settings.ts` and are stored in the path configured by `RUNTIME_SETTINGS_PATH`; the default is `data/settings.json`.
- Runtime settings are local state and should stay ignored by Git.
- A saved runtime setting has higher priority than the matching `.env` default. For example, the model selected through `/model` applies immediately and overrides `OLLAMA_MODEL`.
- Model selection UI lives in `src/modelSelector.ts`. Keep the allowed Ollama and Whisper model lists there unless the project grows a more general settings registry.

## Reliability

- Fail closed for missing secrets and missing allow-list configuration.
- Keep logs timestamped and emoji-prefixed after the timestamp.
- Handle Telegram polling errors without exiting the process.
- Queue inbound messages and process them sequentially.
- Keep external API adapters thin so they can be tested or swapped.
- After changing project code, `.env.example`, runtime config, tool registration, or service behavior, restart the macOS LaunchAgent so the running bot loads the new version: `launchctl kickstart -k gui/$(id -u)/com.my-local-bro.bot`.
- Keep pending reminder state in the path from `REMINDER_STORAGE_PATH` and archive delivered reminders under `REMINDER_ARCHIVE_DIR`.

## Voice Messages

- Telegram voice handling lives behind the `VoiceTranscriber` interface in `src/model/voiceTranscriber.ts`.
- Voice messages should be transcribed first, then routed through the same service path as normal text messages.
- Voice transcription should call `scripts/transcribe-voice.sh`.
- `scripts/transcribe-voice.sh` supports two local backends: `ggml-*` models through `whisper.cpp`, and legacy names such as `tiny`, `base`, `small`, `medium`, and `large-v3` through the Python Whisper CLI.
- Keep `WHISPER_MODEL=ggml-large-v3-turbo-q5_0` as the fast default when `whisper.cpp` and the VoiceInk-installed ggml model are available.
- `/voice_model` should apply immediately and override `WHISPER_MODEL` through runtime settings in the same way `/model` overrides `OLLAMA_MODEL`.
- Reuse already installed VoiceInk models when possible instead of redownloading them. Prefer the VoiceInk WhisperModels directory when resolving `ggml-*` models.
- Keep `WHISPER_FP16=False` by default. Apple MPS can produce `nan` logits with large Whisper models in fp16.
- Do not register voice transcription as a normal model-callable tool; it is preprocessing for Telegram voice input.
- Webhook audio uploads should use the same Whisper helper and should be deleted from remote webhook storage after the bot downloads them.

## Reminder Module

- Keep one-time reminder scheduling code in `src/reminder/`.
- Pending reminders live in the JSON path from `REMINDER_STORAGE_PATH`; delivered reminders must be removed from that file and archived under `REMINDER_ARCHIVE_DIR`.
- Reminder delivery must not use the LLM. The LLM is only used once to convert a natural-language user request into `reminder` tool arguments.
- Reminder list output should stay direct and should not be rewritten by the model.
- Reminder text should be normalized to concise English when the main model creates the tool call.

## Webhook Module

- The webhook server is a separate entrypoint and must not require Telegram bot startup to run.
- Keep webhook server env and bot subscriber env in `.env.example`, but never put real URLs or passwords in tracked docs.
- The bot subscribes only when `WEBHOOK_URL` is configured. If `WEBHOOK_URL` is empty, the bot should behave exactly like Telegram-only mode.
- The startup logs should state whether webhook subscription is enabled or disabled. Do not include the webhook URL or passwords in Telegram startup messages.
- Use two passwords: one for upload, one for control. Upload and control endpoints must fail closed without a valid password.
- The webhook service should store uploaded files and event metadata locally so events survive restarts.
- The bot should poll webhook events with a fast long-poll flow instead of slow fixed-interval polling.
- After the bot downloads a webhook audio file, it should immediately ask the webhook service to delete that remote file so server-side audio does not accumulate.
- Put user-facing setup instructions for Shortcuts and Coolify in `docs/webhook.md`.

## Image Messages

- Telegram image handling is service preprocessing, not a model-callable tool.
- Support Telegram `photo` messages and image `document` messages.
- Download image files through the Telegram file API, pass them to `OllamaAgent.generate()` as base64 `images`, and use the caption as the prompt when present.
- If an image arrives without a caption, use a default prompt that asks the model to analyze the image.
- Do not register image handling in `src/tools/index.ts`.

## Tool Creation

Model-callable tools live in `src/tools/` and must follow the `ToolRuntime` interface in `src/tools/types.ts`.

When adding a tool:

- Create a focused file in `src/tools/`, following the shape used by `src/tools/calc.ts`, `src/tools/web.ts`, or `src/tools/ytDownload.ts`.
- Export a factory function named like `createExampleTool()` that returns a `ToolRuntime`.
- Define the Ollama tool schema in the returned `definition` field:
  - `type` should be `function`.
  - `function.name` should be short and stable, because the model calls it by name.
  - `function.description` should describe when to use the tool.
  - `function.parameters` should be an object schema with `required` and `properties` for arguments.
- Put the implementation in the returned async `run(args)` method.
- Choose a result policy with `resultMode` when needed: use `direct` when the tool output should be sent to Telegram as-is, and omit it or use `model` when the model should analyze the tool output before answering.
- If a tool should be available through Telegram inline mode, add an `inline` block with an order, title, description, and `buildArgs(query)` function. Keep inline tools safe to run while the user types, because Telegram may send inline queries repeatedly.
- If a tool has deterministic text commands that should bypass the LLM entirely, add a `directCommands` block with `buildArgs(text)`. Keep command parsing inside the tool module, not in `src/service.ts`.
- Validate and normalize all arguments inside the tool before doing work.
- Do not pass user text into shell commands. If a local process is needed, use safe argument arrays like the patterns in `src/tools/ytDownload.ts` and `src/tools/exec.ts`.
- Keep tool output concise. If output can grow, truncate it before returning it to the model.
- When a tool returns a Telegram document artifact, keep the artifact creation inside the tool or its helper module and keep the direct text payload small. Use `normalizeToolOutput()` and the document path in `src/telegram/status.ts`.
- Register the tool in `src/tools/index.ts` by importing the factory and adding it to the `tools` array in `createToolRegistry()`. If the tool needs the Ollama client or model name, pass them from this registry instead of creating duplicate global clients.
- Keep the `tools` list tool registered after the main registry map is built, because it reads the active registry to report only tools that are actually available in the current run.
- Keep optional external tools behind explicit config. For example, `web_search` and `web_fetch` are registered only when `TAVILY_API_KEY` is set and the startup health check passes.
- The `codex` tool runs `codex-proxy exec` through the configured shell and workspace from `CODEX_*` settings. It receives `context.signal`; keep that signal wired so `/stop` and `/stopall` terminate the spawned Codex process group.
- If the model needs extra guidance on when to call the tool, update the system prompt in `src/model/ollamaAgent.ts`.
- If user-facing behavior changes, update `README.md`.

## Human Research Tool

- Keep public human research code in `src/humanResearch/`.
- The `human_research` tool is for public professional or creator research only.
- Do not extend it to private addresses, phone numbers, family data, government IDs, private purchases, or other sensitive personal data.
- Prefer public sources such as official company sites, LinkedIn, GitHub, Product Hunt, Indie Hackers, public app-store pages, Gumroad/Lemon Squeezy, YouTube, Substack, and country-specific public company registries when relevant.
- The tool should work in stages: plan focused search questions, search them, summarize each answer, optionally run follow-up searches, then merge the final report.
- Classify the subject into an archetype first and use that archetype to decide which signals deserve emphasis.
- Keep one question mapped to one search query and one summarized answer.
- Include exact public profile URLs for relevant social and platform profiles when available.
- Include public location/contact clues, public commercial signals, public tools/platform signals, public content/audience signals, and recent dated public activity when the sources support them.
- Only emphasize commercial signals such as pricing, subscriptions, product sales, and public MRR when the archetype makes them relevant. For non-commercial archetypes, emphasize projects, repositories, talks, publications, and recent work instead.
- Synthetic test data for fake humans should stay in `src/humanResearch/synthetic.ts`.
- Validate the human research pipeline with the real local model through `npm run test:human-research`.
- Final delivery should stay direct and use a PDF Telegram document, not a large plain-text dump in chat.

## Tool Registration

There are two different tool scopes. Do not mix them:

- Main assistant tools are registered in `src/tools/index.ts`.
- Cron-only tools are defined inside `src/cron/` and must not be registered in `src/tools/index.ts`.

Main assistant tools:

- Use `src/tools/types.ts` and the `ToolRuntime` interface.
- Are visible to normal Telegram chat model calls through `src/model/ollamaAgent.ts`.
- Must be registered by importing their factory in `src/tools/index.ts` and adding them to `createToolRegistry()`.
- Can use `resultMode: direct` when their output should be sent to Telegram without a second model pass.
- Can omit `resultMode` or use `model` when the model should analyze tool output before answering.
- Can define `inline` metadata when they should be available through optional Telegram inline mode.
- Can define `directCommands` metadata when exact user commands should call the tool directly without asking the LLM to choose the tool first. For example, cron list/delete/disable/enable commands are registered on the cron tool itself.
- Do not add cron edit/update to `directCommands`; edit requests need the LLM to interpret the requested field changes.

Cron-only tools:

- Must stay out of `src/tools/index.ts`.
- Are only passed to cron review model calls in `src/cron/reviewAgent.ts`.
- Currently include only `send_message`.
- Must be tightly scoped because cron runs without an interactive user waiting in the chat.

## Cron Module

- Keep cron task registration state in the JSON storage path from `CRON_STORAGE_PATH`.
- Do not register cron-only tools like `send_message` in the main tool registry in `src/tools/index.ts`.
- Cron task execution may run local commands, but command execution must use argument arrays, not shell strings.
- Cron review must use a restricted model call with only the cron `send_message` tool available.
- The cron `send_message` tool should only notify the original task author and only when the task prompt asks for notification and the output satisfies that condition.

Cron flow:

- The main assistant receives a Telegram request and may call the main `cron` tool from `src/tools/cron.ts`.
- The `cron` tool creates, edits, deletes, lists, enables, or disables tasks in `CronTaskStorage`.
- Tasks are stored as JSON in the path configured by `CRON_STORAGE_PATH`; the default is `data/cron-tasks.json`.
- The runtime JSON task file is local state and ignored by Git. Keep `data/.gitkeep` tracked so the directory exists.
- Each task has an integer `id`, `enabled`, five-field `schedule`, `command`, `args`, `prompt`, original Telegram author, and last-run metadata.
- Human schedule phrases such as `every minute`, `every hour`, and `every day` are normalized by `src/cron/schedule.ts`.
- `CronScheduler` loads tasks from storage on every tick, checks the current minute, and avoids running the same task twice in one minute.
- `CronRunner` executes the configured command with `execFile`, expands `~` in the command path, captures stdout/stderr, and enforces the configured timeout.
- `CronReviewAgent` sends the task prompt plus command output to Ollama with only the cron-only `send_message` tool available when `CRON_ALLOW_SEND_MESSAGE_TOOL=true`.
- If `send_message` is called, it sends a Telegram message only to the task author using the fixed format `Cron #<id> Notification:\n<message>`.
- If the condition is not met, the review model should not call any tool and should return `no notification`.

Cron safety rules:

- Do not expose normal assistant tools such as web, file listing, download, or calculator inside cron review.
- Do not let cron notifications target arbitrary chats; use only the author stored on the task.
- Do not execute cron commands through a shell string.
- Keep task list output concise because it is sent directly to Telegram.
- Avoid creating enabled every-minute tasks in code or fixtures unless the user explicitly asks, because they can spam the chat.
