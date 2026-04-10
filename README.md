# My Local Bro

My Local Bro is a local-first Telegram AI tool manager for a trusted allow-list. It runs the assistant and its tools on your own machine with Ollama, so private prompts, runtime settings, task state, and logs stay under your control. The project is focused on speed: queued message handling keeps requests ordered, direct tool results avoid unnecessary model passes, and Telegram status updates make long tasks visible while they run. It is designed for practical self-hosting, debugging, and extending local automations without turning the bot into a public service.

## Use Cases

- Search who the current CEO of Google is, where he was born, and what the population of that city is.
- Search several companies at once, such as the CEOs of Google, Microsoft, and Apple, and summarize the result.
- Research a public professional profile by name and email, collect exact public social/profile URLs, products, pricing or public MRR signals, recent activity, and receive the result as a PDF report.
- Translate a message between languages directly in Telegram without opening another app.
- Fix grammar and wording before sending a message, post, or email.
- Ask what time it is on your machine, in London, and in New York.
- List files in a local folder such as `~/Downloads` before deciding what to open or clean up.
- Download a video from a URL and get the saved file path back in chat.
- Set a one-time reminder like `in 1 hour call the store` and receive it later even if the bot was restarted in between.
- Create a cron task that runs a script every minute, reviews the output, and sends a Telegram notification only when a condition is met.
- Send a voice message or webhook audio note, have it transcribed locally, then use the recognized text as a normal bot request.
- Hand off a coding or implementation task to Codex from Telegram and get the result back without leaving the chat.

## What It Does

- Runs locally with Ollama and answers only Telegram users listed in `.env`.
- Keeps work private by default: secrets, runtime settings, task state, and logs stay local.
- Focuses on speed with queued message handling, direct tool results, and visible Telegram status updates.
- Understands text, images, and Telegram voice messages.
- Can subscribe to a separate audio webhook for uploads from iPhone Shortcuts or another client.
- Manages tools for translation, grammar fixes, current time lookup, web search/fetch, local file listing, video downloads, reminders, cron tasks, Codex delegation, and active tool discovery.
- Can produce public human-research PDF reports from name/email/company clues using search plus local LLM summarization.
- Lets you switch between supported local Gemma models and Whisper voice models from the Telegram menu.
- Stores hourly logs by year, month, day, and hour for debugging.
- Can run as a macOS LaunchAgent so it starts again after login/restart.

## Documentation

- [Technical details](docs/technical.md) explains tools, message handling, cron tasks, logs, config, project layout, and current limitations.
- [macOS service setup](docs/macos-service.md) explains how to register, start, restart, inspect, and remove the bot as a LaunchAgent.
- [Webhook audio setup](docs/webhook.md) explains the separate webhook service, iPhone Shortcut upload setup, Coolify deployment, and bot subscription flow.
- [Agent rules](AGENTS.md) explains code organization rules for future AI/code agents working on this project.

## Privacy

The bot token and allow-list live in `.env`, which is ignored by Git. Do not commit real tokens, user IDs, local runtime task state, or logs.

## Footer: Commands

Install dependencies:

```sh
npm install
```

Pull the default local model:

```sh
npm run pull:model
```

Check TypeScript:

```sh
npm run typecheck
```

Start the bot manually:

```sh
npm start
```

Run in watch mode while editing:

```sh
npm run dev
```
