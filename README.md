# HotS Overlay

A real-time OBS overlay for Heroes of the Storm that displays your win/loss history as a row of hero portraits with a win rate counter. Parses `.StormReplay` files directly — no API needed.

## Preview

```
+-------------------------------------------+
|  Storm League - 5W - 3L | 62.5%          |
|  [W][W][L][W][L][W][W][L]                |
+-------------------------------------------+
```

## How It Works

```
Your PC                          Remote Server (Docker)
+-----------------+              +----------------------+
|  HotS Replay    |   uploads   |  Node.js Server      |
|  Client (Rust)  | ----------> |  - Replay parser     |
|                 |    HTTP     |  - SQLite database   |
|  Watches replay |             |  - WebSocket updates |
|  folder, uploads|             |  - OBS overlay       |
|  new .StormReplay             |                      |
|  files          |             |  http://server:8080  |
+-----------------+              +----------------------+
                                          |
                                   OBS Browser Source
```

The **desktop client** runs on your gaming PC and watches your replay folder. When a new `.StormReplay` file appears, it uploads it to the **server**. The server parses the replay, stores the results in SQLite, and pushes updates to OBS via WebSocket.

## Installation (Desktop Client)

1. Download `HotSReplayClient-1.0.0-setup.exe` from the [latest release](https://github.com/matella/Hots-Overlay/releases/latest)
2. Run the installer — it will install with optional desktop shortcut and auto-start with Windows
3. Launch **HotS Replay Client**
4. Click **Settings** and set your **Replay Directory** to your HotS replay folder (see below)
5. Click **Save** — the client will start uploading your 10 most recent replays and watch for new ones

The client runs in the system tray and automatically uploads new replays as you play. If the server goes offline, uploads resume automatically when it comes back.

The only setting exposed in the app is the **Replay Directory**. The server URL and auth token are baked into the binary at compile time.

### Where to find your replay folder

HotS saves replays to:
```
C:\Users\<YourName>\Documents\Heroes of the Storm\Accounts\<AccountNumber>\<ToonHandle>\Replays\Multiplayer
```
The `<ToonHandle>` looks like `2-Hero-1-1234567`. This is also the value you need for the server's `TOON_HANDLE` setting.

## OBS Browser Source Setup

Add a **Browser Source** in OBS with the following settings:
- **Width**: `800`
- **Height**: `120`
- **Custom CSS**: leave empty
- Check **"Shutdown source when not visible"** (optional)

Use one of these URLs depending on what you want to display:

### Today's games (default)

Shows wins and losses from today's session:
```
https://hots-overlay.azurewebsites.net
```

### Today's games for a specific mode

```
https://hots-overlay.azurewebsites.net?mode=storm+league
https://hots-overlay.azurewebsites.net?mode=custom
https://hots-overlay.azurewebsites.net?mode=all
```

### Recent games (last 10)

Shows your last 10 games regardless of date:
```
https://hots-overlay.azurewebsites.net?view=recent
```

### Recent games for a specific mode

```
https://hots-overlay.azurewebsites.net?view=recent&mode=storm+league
```

### Specific player

If your server tracks multiple players, specify which one:
```
https://hots-overlay.azurewebsites.net?player=matella
https://hots-overlay.azurewebsites.net?player=2-Hero-1-2844614
```

### URL Parameters Reference

All parameters are case-insensitive and can be combined:

| Parameter | Description | Values |
|-----------|-------------|--------|
| `mode` | Filter by game mode | `storm+league`, `custom`, `quick+match`, `all` |
| `view` | What to display | `today` (default), `recent` (last 10 games) |
| `player` | Which player to show | Player name or ToonHandle |

## Server Setup

### Docker (recommended)

```bash
cp .env.example .env   # Edit with your TOON_HANDLE
docker compose up -d
```

### Local (no Docker)

```bash
npm install
cp .env.example .env   # Edit with your paths and TOON_HANDLE
npm start
```

### Server Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `TOON_HANDLE` | Yes | Your ToonHandle (e.g. `2-Hero-1-2844614`) — found in your replay folder path |
| `REPLAY_DIR` | Yes | Path to replay folder (local) or upload dir (Docker: `/app/replays`) |
| `PORT` | No | Server port (default: `8080`) |
| `GAME_MODE` | No | Default game mode shown in overlay (default: `Storm League`) |
| `DB_PATH` | No | SQLite database path (default: `./data/overlay.db`) |
| `AUTH_TOKEN` | No | Shared secret for upload endpoints |
| `TZ` | No | Timezone for Docker (default: `America/New_York`) |
| `MODE_LABEL_*` | No | Custom display labels (e.g. `MODE_LABEL_Custom=Scrims`) |

## API

Interactive API documentation is available at `/api/docs` on your server.

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server health check |
| `GET /api/today?player=&mode=` | Today's games and stats |
| `GET /api/recent?player=&mode=&limit=` | Last N games (default 10) |
| `GET /api/session/:date?player=&mode=` | Games for a specific date (YYYY-MM-DD) |
| `GET /api/sessions?player=&mode=&limit=` | Recent sessions with stats |
| `GET /api/modes` | Available game modes |
| `GET /api/players` | Available players |
| `POST /api/upload` | Upload replay (multipart form) |
| `POST /api/upload-raw` | Upload replay (raw binary, X-Filename header) |

## Twitch Extension EBS (Extension Backend Service)

The server also acts as the EBS for the HotS Overlay Twitch Extension. It verifies Twitch extension JWTs and broadcasts session stats to viewers via Twitch PubSub.

### Public HTTPS endpoint

The EBS is deployed to Azure Web App at:

```
https://hots-overlay.azurewebsites.net
```

This HTTPS endpoint is required by Twitch for extensions. Deployment is automatic on every push to `main` via the GitHub Actions workflow at `.github/workflows/main_hots-overlay.yml`.

### Required secrets

Set these as **GitHub repository secrets** (used by the CI/CD workflow to configure Azure App Settings):

| Secret | Description |
|--------|-------------|
| `TWITCH_CLIENT_ID` | Extension Client ID — from Twitch Developer Console > Extensions > your extension > Settings tab |
| `TWITCH_EXTENSION_SECRET` | Base64-encoded Extension Secret — same Settings tab |
| `TWITCH_BROADCASTER_ID` | Numeric Twitch user ID of the broadcaster (channel owner) |

The workflow propagates these to Azure App Settings automatically on each deploy. You can also set them manually in the Azure Portal under **Configuration > Application settings**.

### CORS

The server automatically allows cross-origin requests from all `*.ext-twitch.tv` origins (where Twitch extension panels and overlays are served) and from `localhost` for local extension testing. No additional configuration is required.

### Health check

```
GET /api/health
→ { "status": "ok", "build": "<timestamp>" }
```

Azure checks this endpoint every 10 seconds. The Docker health check uses the same endpoint.

### Architecture

```
Twitch Extension Frontend          EBS (this server)
(*.ext-twitch.tv)                  (hots-overlay.azurewebsites.net)
+------------------------+         +---------------------------+
| Panel / Video Overlay  | ──────> | GET /api/recent-full      |
|  - shows heroes        | JWT     |  - verifies Twitch JWT    |
|  - shows W/L stats     |         |  - returns game data      |
+------------------------+         |                           |
                                   | Twitch PubSub ──────────> viewers
                                   |  - broadcasts session stats
                                   |    on each new game       |
                                   +---------------------------+
```

## Tech Stack

**Server**: Node.js, Express, SQLite (better-sqlite3), WebSocket, hots-parser, Docker
**Client**: Rust, egui/eframe, ureq, notify, tray-icon, Inno Setup installer
