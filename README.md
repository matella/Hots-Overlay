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
2. Run the installer — it will install to `Program Files` with optional desktop shortcut and auto-start
3. Launch **HotS Replay Client**
4. Click **Settings** and set your **Replay Directory** to your HotS replay folder:
   ```
   C:\Users\<you>\Documents\Heroes of the Storm\Accounts\<account>\<toon>\Replays\Multiplayer
   ```
5. Click **Save** — the client will start uploading your most recent replays and watch for new ones

The client runs in the system tray and automatically uploads new replays as you play. If the server goes offline, uploads resume automatically when it comes back.

### Where to find your replay folder

HotS saves replays to:
```
C:\Users\<YourName>\Documents\Heroes of the Storm\Accounts\<AccountNumber>\<ToonHandle>\Replays\Multiplayer
```
The `<ToonHandle>` looks like `2-Hero-1-1234567`.

### Client settings

Settings are stored in `%LOCALAPPDATA%\HotS Replay Client\settings.json`. You can also configure the server URL and auth token by editing this file directly:

```json
{
  "serverUrl": "https://your-server.example.com",
  "authToken": "your-token-here",
  "replayDir": "C:\\Users\\you\\Documents\\Heroes of the Storm\\Accounts\\..."
}
```

## Server Setup (Docker)

```bash
cp .env.example .env   # Edit with your TOON_HANDLE
docker compose up -d
```

Then add your server URL as an OBS Browser Source (800x120, transparent background).

### Server Setup (Local / No Docker)

```bash
npm install
cp .env.example .env   # Edit with your paths and TOON_HANDLE
npm start
```

Then add `http://localhost:8080` as an OBS Browser Source.

## Server Configuration (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `TOON_HANDLE` | Yes | Your ToonHandle (e.g. `2-Hero-1-2844614`) — found in your replay folder path |
| `REPLAY_DIR` | Yes | Path to replay folder (local) or upload dir (Docker: `/app/replays`) |
| `PORT` | No | Server port (default: `8080`) |
| `GAME_MODE` | No | Default game mode (default: `Storm League`) |
| `DB_PATH` | No | SQLite database path (default: `./data/overlay.db`) |
| `AUTH_TOKEN` | No | Shared secret for upload endpoints |
| `TZ` | No | Timezone for Docker (default: `America/New_York`) |
| `MODE_LABEL_*` | No | Custom display labels (e.g. `MODE_LABEL_Custom=Scrims`) |

## OBS Overlay URL Parameters

Control the overlay display via URL query parameters (all case-insensitive):

| Parameter | Description | Example |
|-----------|-------------|---------|
| `mode` | Filter by game mode | `?mode=storm+league`, `?mode=all` |
| `player` | Show a specific player | `?player=matella` or `?player=2-Hero-1-2844614` |
| `view` | Display mode | `?view=recent` (last N games) or `?view=today` (default) |

Examples:
- `http://server:8080` — Today's games, default mode, default player
- `http://server:8080?mode=all&view=recent` — Recent games across all modes
- `http://server:8080?player=matella&mode=storm+league` — Storm League games for matella

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server health check |
| `GET /api/today?player=&mode=` | Today's games and stats |
| `GET /api/recent?player=&mode=&limit=` | Last N games (default 10) |
| `GET /api/session/:date?player=&mode=` | Games for a specific date |
| `GET /api/sessions?player=&mode=&limit=` | Recent sessions with stats |
| `GET /api/modes` | Available game modes |
| `GET /api/players` | Available players |
| `POST /api/upload` | Upload replay (multipart form) |
| `POST /api/upload-raw` | Upload replay (raw binary) |
| `GET /api/docs` | Interactive Swagger docs |

## Tech Stack

**Server**: Node.js, Express, SQLite (better-sqlite3), WebSocket, hots-parser, Docker
**Client**: Rust, egui/eframe, ureq, notify, tray-icon, Inno Setup installer
