# Development Guide

This guide covers local development tooling for the Twitch extension.

---

## Prerequisites

Install these tools once on your development machine:

**macOS:**
```bash
brew install twitch-cli
brew install mkcert
```

**Windows (PowerShell):**
```powershell
winget install TwitchInteractive.TwitchCLI
winget install FiloSottile.mkcert
```

> If `winget` is unavailable, download binaries directly from [Twitch CLI releases](https://github.com/twitchdev/twitch-cli/releases) and [mkcert releases](https://github.com/FiloSottile/mkcert/releases) and add them to your PATH.

---

## Note on the Twitch Developer Rig

The Twitch Developer Rig was **deprecated in 2022** and is no longer maintained. The current
recommended approach for local extension development is:

- **Twitch CLI** — simulate PubSub messages, create test tokens, call Twitch APIs
- **Extension console "Local Test" mode** — load extension files directly from `https://localhost`
- **mkcert** — generate locally trusted certificates so browsers accept the local HTTPS server

---

## Local HTTPS Setup

Twitch's "Local Test" mode requires extension files to be served over HTTPS, even on localhost.

### 1. Install the mkcert root CA (one-time)

```bash
mkcert -install
```

This installs a local Certificate Authority into your system trust store so browsers won't
show certificate warnings for locally generated certs.

### 2. Generate certificates

From the project root:

```bash
# macOS / Linux
mkdir -p certs

# Windows (PowerShell or Command Prompt)
mkdir certs
```

```bash
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1
```

The `certs/` directory is in `.gitignore` — certificates are never committed.

### 3. Enable HTTPS in your `.env`

Add these lines to your `.env` (copy from `.env.example`):

```env
HTTPS_PORT=8443
SSL_KEY_PATH=./certs/localhost-key.pem
SSL_CERT_PATH=./certs/localhost.pem
```

### 4. Start the dev server

```bash
npm run dev
```

You should see both servers start:

```
Overlay (HTTPS): https://localhost:8443
Overlay: http://localhost:8080
```

Visit `https://localhost:8443` in your browser — it should load without certificate warnings.

---

## Testing the Extension Locally

1. Go to [dev.twitch.tv/console/extensions](https://dev.twitch.tv/console/extensions) and open your extension.
2. In the **"Local Test"** tab, set **Anchor** to `Component` and the **Base Testing URI** to:
   ```
   https://localhost:8443/extension/
   ```
3. Click **"Start Test Session"** and navigate to your Twitch channel to see the extension loaded
   from your local server.

Changes to files in `public/extension/` are served immediately (no build step) — just refresh
the extension in the Twitch console to pick up the latest files.

---

## Testing PubSub with Twitch CLI

### Configure the CLI (one-time)

```bash
twitch configure
```

Enter your Client ID and Client Secret from [dev.twitch.tv/console](https://dev.twitch.tv/console).

### Simulate a PubSub broadcast

Use the Twitch CLI to send a test `broadcast` message to your extension as if your EBS had sent it:

```bash
twitch extensions send-pubsub-message \
  --channel-id <YOUR_BROADCASTER_ID> \
  --client-id <YOUR_CLIENT_ID> \
  --extension-id <YOUR_EXTENSION_ID> \
  --message '{"type":"new_game","game":{"hero":"Genji","win":true,"map":"Towers of Doom","gameMode":"Storm League"}}'
```

Replace `<YOUR_BROADCASTER_ID>`, `<YOUR_CLIENT_ID>`, and `<YOUR_EXTENSION_ID>` with values from
your `.env` and the extension console.

You should see the overlay update in real time.

### Other useful Twitch CLI commands

```bash
# List available extension commands
twitch extensions --help

# Generate a test JWT for your extension (for manual API calls)
twitch extensions token --channel-id <ID> --client-id <ID>

# Check your configured credentials
twitch configure --list
```

---

## Hot-Reload Workflow

| Layer | How it reloads |
|-------|----------------|
| Server (`server.js`, `src/`) | Automatically — `npm run dev` uses `node --watch` |
| Extension frontend (`public/extension/`) | Manual refresh — files are static, served as-is |
| Main overlay (`public/`) | Manual refresh |

For the extension, after editing any file in `public/extension/`:
1. Save the file.
2. In the Twitch Extension console, click **Reload** (or refresh the browser tab running the test session).

---

## Quick-Reference

| Task | Command |
|------|---------|
| Start dev server (HTTP only) | `npm run dev` |
| Start dev server (HTTP + HTTPS) | Set `HTTPS_PORT` in `.env`, then `npm run dev` |
| Regenerate local certs | `mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1` |
| Send test PubSub message | `twitch extensions send-pubsub-message ...` (see above) |
| Build extension zip (macOS/Linux) | `cd public/extension && zip -r ../../extension.zip .` |
| Build extension zip (Windows) | `Compress-Archive -Path public\extension\* -DestinationPath extension.zip` |
