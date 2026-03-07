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

Use one of these URLs depending on what you want to display (replace `your-server` with your actual server address):

### Today's games (default)

Shows wins and losses from today's session:
```
https://your-server.example.com
```

### Today's games for a specific mode

```
https://your-server.example.com?mode=storm+league
https://your-server.example.com?mode=custom
https://your-server.example.com?mode=all
```

### Recent games (last 10)

Shows your last 10 games regardless of date:
```
https://your-server.example.com?view=recent
```

### Recent games for a specific mode

```
https://your-server.example.com?view=recent&mode=storm+league
```

### Specific player

If your server tracks multiple players, specify which one:
```
https://your-server.example.com?player=matella
https://your-server.example.com?player=2-Hero-1-2844614
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

## Tech Stack

**Server**: Node.js, Express, SQLite (better-sqlite3), WebSocket, hots-parser, Docker
**Client**: Rust, egui/eframe, ureq, notify, tray-icon, Inno Setup installer
