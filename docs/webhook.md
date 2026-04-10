# Webhook Audio Setup

This project includes a separate webhook service for audio uploads. The local bot does not need to expose itself to the internet. Instead:

- the webhook service runs on your server,
- your iPhone Shortcut uploads audio to that webhook,
- the local bot polls the webhook for new events,
- the local bot downloads the audio, asks the webhook to delete the remote file, transcribes it, and sends the result back to Telegram.

This keeps the bot local while still letting you send voice notes from outside Telegram.

## Architecture

- `npm run webhook:start` runs the webhook HTTP server.
- `npm start` runs the Telegram bot.
- Set `WEBHOOK_URL` in the bot `.env` only when you want the bot to subscribe to webhook events.
- If `WEBHOOK_URL` is empty, the bot works exactly as before, with Telegram only.

## Passwords

Use two different passwords:

- `WEBHOOK_UPLOAD_PASSWORD`: used only by the client that uploads audio.
- `WEBHOOK_CONTROL_PASSWORD`: used by the bot to poll events, download files, list files, and delete files.

Do not reuse these passwords for anything else.

## Webhook Server Env

Example values:

```text
WEBHOOK_BIND_HOST=0.0.0.0
WEBHOOK_PORT=3000
WEBHOOK_AUDIO_DIR=data/webhook-audio
WEBHOOK_STORAGE_PATH=data/webhook-state.json
WEBHOOK_UPLOAD_PASSWORD=replace-this-upload-secret
WEBHOOK_CONTROL_PASSWORD=replace-this-control-secret
WEBHOOK_MAX_AUDIO_BYTES=20971520
```

The webhook stores uploaded files in `WEBHOOK_AUDIO_DIR` and stores event/file metadata in `WEBHOOK_STORAGE_PATH`.

## Bot Env

Example values:

```text
WEBHOOK_URL=https://your-webhook-host.example.com
WEBHOOK_UPLOAD_PASSWORD=replace-this-upload-secret
WEBHOOK_CONTROL_PASSWORD=replace-this-control-secret
WEBHOOK_POLL_TIMEOUT_SECONDS=25
```

The local bot only needs `WEBHOOK_URL` and the two shared passwords. It does not need `WEBHOOK_AUDIO_DIR`, `WEBHOOK_STORAGE_PATH`, or `WEBHOOK_PORT`.

## HTTP Endpoints

Upload:

```text
POST /api/webhook/audio
```

Control:

```text
GET    /api/webhook/events
GET    /api/webhook/files
GET    /api/webhook/files/:id
DELETE /api/webhook/files/:id
GET    /healthz
```

Use the header:

```text
X-Webhook-Password: <secret>
```

The webhook also accepts `Authorization: Bearer <secret>`.

## iPhone Shortcuts: Simple Setup

Recommended shortcut flow:

1. Add `Record Audio`.
2. Add `Get Contents of URL`.
3. Set URL to:

```text
https://your-webhook-host.example.com/api/webhook/audio
```

4. Set method to `POST`.
5. Add header:

```text
X-Webhook-Password: replace-this-upload-secret
```

6. Optional header:

```text
X-Webhook-Source: iphone-shortcuts
```

7. Set `Request Body` to `File`.
8. Use the output of `Record Audio` as that file.

Apple documents that `Get Contents of URL` can send `JSON`, `Form`, or `File` bodies. For this webhook, `File` is the simplest configuration because it sends the recorded audio directly.

The webhook also accepts:

- JSON with `audioBase64`
- multipart form with `audio` or `file`

But the plain `File` body is the easiest Shortcut setup.

`X-Webhook-File-Name` is not required. If you do not send a file name, the webhook generates one automatically from the upload id and mime type. That is the safer default for Shortcuts because repeated uploads do not reuse the same storage path.

## Audio Format Notes

The webhook does not depend on one specific audio container. It stores the uploaded bytes as-is, tracks the provided file name and mime type, and the bot passes the file to the local Whisper helper.

That means you do not need to pre-convert the file in Shortcuts. If your Shortcut sends `m4a`, `caf`, `ogg`, or another common audio format, the bot still routes it through the same Whisper-based transcription flow.

## Coolify Setup

Deploy only the webhook service to Coolify. The Telegram bot can stay on your local machine.

### 1. Create the Coolify app

1. In Coolify, create a new application from this Git repo.
2. Use the repository branch you want to deploy.
3. Use a Node.js-style application, not a static site.

### 2. Set the run command

Use this start command:

```sh
npm install && npm run webhook:start
```

If Coolify separates install/build/start fields, use:

- Install command:

```sh
npm install
```

- Build command:

```sh
echo "no build step"
```

- Start command:

```sh
npm run webhook:start
```

### 3. Set the port

Expose the webhook port used by the server:

```text
3000
```

That should match:

```text
WEBHOOK_PORT=3000
```

### 4. Set the webhook env vars in Coolify

Add these environment variables to the Coolify app:

```text
WEBHOOK_BIND_HOST=0.0.0.0
WEBHOOK_PORT=3000
WEBHOOK_AUDIO_DIR=data/webhook-audio
WEBHOOK_STORAGE_PATH=data/webhook-state.json
WEBHOOK_UPLOAD_PASSWORD=replace-this-upload-secret
WEBHOOK_CONTROL_PASSWORD=replace-this-control-secret
WEBHOOK_MAX_AUDIO_BYTES=20971520
```

Notes:

- `WEBHOOK_UPLOAD_PASSWORD` and `WEBHOOK_CONTROL_PASSWORD` must match the values in the local bot `.env`.
- `WEBHOOK_AUDIO_DIR` and `WEBHOOK_STORAGE_PATH` are server-local paths inside the deployment.
- You do not need Telegram bot token settings on the webhook deployment unless you also decide to run the bot there, which is not the intended setup.

### 5. Attach a public domain

Attach your public domain to the Coolify app, for example:

```text
https://your-webhook-host.example.com
```

After deployment, the upload endpoint will be:

```text
https://your-webhook-host.example.com/api/webhook/audio
```

### 6. Verify the webhook service

Open:

```text
https://your-webhook-host.example.com/healthz
```

Expected response:

```json
{"ok":true}
```

If `/healthz` does not return `{"ok":true}`, do not point the bot or Shortcut to it yet.

### 7. Configure the local bot

On the machine where the Telegram bot runs, set these in local `.env`:

```text
WEBHOOK_URL=https://your-webhook-host.example.com
WEBHOOK_UPLOAD_PASSWORD=replace-this-upload-secret
WEBHOOK_CONTROL_PASSWORD=replace-this-control-secret
WEBHOOK_POLL_TIMEOUT_SECONDS=25
```

Then restart the bot service:

```sh
launchctl kickstart -k gui/$(id -u)/com.my-local-bro.bot
```

Expected bot logs after restart:

```text
Webhook enabled
Webhook subscription enabled
```

If the webhook is not reachable yet, the bot will log retry errors until the remote service is healthy.

### 8. Configure the iPhone Shortcut

Use the same public domain and the upload password from the Coolify app.

Minimal request target:

```text
https://your-webhook-host.example.com/api/webhook/audio
```

Minimal required header:

```text
X-Webhook-Password: replace-this-upload-secret
```

## Behavior in Telegram

When the local bot receives a webhook audio event, it:

1. sends a Telegram status that webhook audio was received and will be transcribed,
2. edits that message with the recognized transcript,
3. processes the transcript like a normal request,
4. returns the final result in Telegram.

The startup Telegram message does not include the webhook URL or passwords.

## Local Testing

Start the webhook:

```sh
npm run webhook:start
```

Upload a file:

```sh
curl -X POST \
  -H "X-Webhook-Password: replace-this-upload-secret" \
  -H "Content-Type: audio/mp4" \
  -H "X-Webhook-File-Name: sample.m4a" \
  --data-binary @sample.m4a \
  http://127.0.0.1:3000/api/webhook/audio
```

Read events:

```sh
curl -H "X-Webhook-Password: replace-this-control-secret" \
  "http://127.0.0.1:3000/api/webhook/events?cursor=0&timeout=1"
```

List files:

```sh
curl -H "X-Webhook-Password: replace-this-control-secret" \
  http://127.0.0.1:3000/api/webhook/files
```

Download one file:

```sh
curl -H "X-Webhook-Password: replace-this-control-secret" \
  http://127.0.0.1:3000/api/webhook/files/1 --output downloaded.bin
```

Delete one file:

```sh
curl -X DELETE -H "X-Webhook-Password: replace-this-control-secret" \
  http://127.0.0.1:3000/api/webhook/files/1
```
