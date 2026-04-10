# macOS Service Setup

This guide explains how to run the bot as a macOS user LaunchAgent. A user LaunchAgent starts after your macOS user logs in and can automatically restart the bot if it exits.

Use placeholders in this guide:

- `PROJECT_DIR`: absolute path to this repository, for example `/Users/your-name/path/to/my-local-bro`
- `NPM_BIN`: absolute path to `npm`, from `command -v npm`
- `SERVICE_LABEL`: LaunchAgent label, for example `com.example.my-local-bro.bot`
- `PLIST_PATH`: `~/Library/LaunchAgents/SERVICE_LABEL.plist`

## 1. Find Paths

From the project directory:

```sh
pwd
command -v npm
```

Example values:

```text
PROJECT_DIR=/Users/your-name/path/to/my-local-bro
NPM_BIN=/Users/your-name/.nvm/versions/node/vXX/bin/npm
SERVICE_LABEL=com.example.my-local-bro.bot
PLIST_PATH=~/Library/LaunchAgents/com.example.my-local-bro.bot.plist
```

## 2. Create LaunchAgents Directory

```sh
mkdir -p ~/Library/LaunchAgents
```

## 3. Create the Plist

Create `~/Library/LaunchAgents/com.example.my-local-bro.bot.plist` and replace `PROJECT_DIR` and `NPM_BIN` with your real absolute paths:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.example.my-local-bro.bot</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>source ~/.zshrc &gt;/dev/null 2&gt;&amp;1; cd PROJECT_DIR &amp;&amp; exec NPM_BIN start</string>
  </array>

  <key>WorkingDirectory</key>
  <string>PROJECT_DIR</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>PROJECT_DIR/logs/launchd.out.log</string>

  <key>StandardErrorPath</key>
  <string>PROJECT_DIR/logs/launchd.err.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>

  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
```

Why the XML escapes matter:

- Use `&gt;` instead of `>` inside XML text.
- Use `&amp;` instead of `&` inside XML text.
- `2&gt;&amp;1` becomes `2>&1` after launchd reads the plist.
- `&amp;&amp;` becomes `&&` after launchd reads the plist.

## 4. Validate the Plist

```sh
plutil -lint ~/Library/LaunchAgents/com.example.my-local-bro.bot.plist
```

Expected result:

```text
...: OK
```

## 5. Load and Start

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.my-local-bro.bot.plist
```

If the service is already loaded, use restart instead:

```sh
launchctl kickstart -k gui/$(id -u)/com.example.my-local-bro.bot
```

## 6. Check Status

```sh
launchctl print gui/$(id -u)/com.example.my-local-bro.bot
```

Useful compact check:

```sh
launchctl print gui/$(id -u)/com.example.my-local-bro.bot | rg "state =|pid =|job state|last exit code"
```

You want to see:

```text
state = running
job state = running
```

## 7. Restart After Project Changes

After changing project code, `.env`, `.env.example`, tool registration, or service behavior, restart the LaunchAgent:

```sh
launchctl kickstart -k gui/$(id -u)/com.example.my-local-bro.bot
```

The bot sends a Telegram startup notification to the allowed owner IDs after it starts.

## 8. Stop Without Removing

```sh
launchctl kill TERM gui/$(id -u)/com.example.my-local-bro.bot
```

If `KeepAlive=true`, launchd may start it again. To stop it and keep it stopped, unload it instead.

## 9. Unload and Remove

Unload the service:

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.example.my-local-bro.bot.plist
```

Remove the plist:

```sh
rm ~/Library/LaunchAgents/com.example.my-local-bro.bot.plist
```

## 10. Logs

The LaunchAgent writes stdout/stderr to the paths from the plist:

```text
PROJECT_DIR/logs/launchd.out.log
PROJECT_DIR/logs/launchd.err.log
```

The application also writes hourly logs under:

```text
PROJECT_DIR/logs/YYYY/MM/DD/HH.log
```

Check recent logs:

```sh
tail -100 PROJECT_DIR/logs/launchd.out.log
tail -100 PROJECT_DIR/logs/launchd.err.log
find PROJECT_DIR/logs -type f | sort | tail -5
```

## 11. Avoid Duplicate Bot Instances

Telegram long polling allows only one active poller per bot token. Before starting the LaunchAgent, stop any manual bot process that is running in a terminal.

Check for likely manual processes:

```sh
pgrep -fl "tsx src/index.ts|npm start"
```

If two instances run at once, Telegram can return this error:

```text
Conflict: terminated by other getUpdates request; make sure that only one bot instance is running
```

Fix it by stopping the manual process and keeping only the LaunchAgent instance.
