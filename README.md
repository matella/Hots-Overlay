# HotS Overlay

A real-time OBS overlay for Heroes of the Storm that displays your win/loss history as a row of hero portraits with a win rate counter. Parses `.StormReplay` files directly — no API needed.

## Features

- Hero portrait tiles with green (win) / red (loss) borders
- Live win rate counter (W-L | %)
- Auto-detects new replays and updates the overlay in real time via WebSocket
- Game mode filtering (Storm League, Custom/Scrims, All, etc.)
- Mode badges when viewing all modes
- Case-insensitive mode selection via URL parameters
- Transparent background for OBS Browser Source
- SQLite database to avoid re-parsing thousands of replay files
- **Docker support** for remote deployment
- **Upload client** to send replays from your PC to a remote server

## Preview

```
+-------------------------------------------+
|  Storm League - 5W - 3L | 62.5%          |
|  [W][W][L][W][L][W][W][L]                |
+-------------------------------------------+
```

## Quick Start (Local)

```bash
npm install
cp .env.example .env   # Edit .env with your paths
npm start
```

Then add `http://localhost:3001` as an OBS Browser Source (800x120, transparent background).

## Quick Start (Docker + Remote)

```bash
# On the server
cp .env.example .env   # Set TOON_HANDLE and optionally AUTH_TOKEN
docker compose up -d

# On your PC
cd client
npm install
cp .env.example .env   # Set REPLAY_DIR, SERVER_URL, AUTH_TOKEN
npm start
```

OBS Browser Source points to `http://your-server:3001`.

See [SETUP.md](SETUP.md) for detailed instructions.

## URL Parameters

Control the displayed mode via the `?mode=` URL parameter (case-insensitive):

| URL | Shows |
|-----|-------|
| `http://server:3001` | Default mode (Storm League) |
| `http://server:3001?mode=storm+league` | Storm League only |
| `http://server:3001?mode=custom` | Custom games only |
| `http://server:3001?mode=all` | All modes (with badges) |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/today?mode=` | Today's games and stats |
| `GET /api/session/:date?mode=` | Games for a specific date (YYYY-MM-DD) |
| `GET /api/sessions?mode=&limit=10` | Recent sessions with stats |
| `GET /api/modes` | Available modes, default, and labels |
| `POST /api/upload` | Upload a `.StormReplay` file (multipart, auth optional) |

## Configuration

### Server (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `REPLAY_DIR` | Yes | Path to replay folder (local) or upload dir (Docker) |
| `TOON_HANDLE` | Yes | Your ToonHandle (e.g. `2-Hero-1-2844614`) |
| `PORT` | No | Server port (default: `3000`) |
| `GAME_MODE` | No | Default game mode (default: `Storm League`) |
| `DB_PATH` | No | SQLite database path (default: `./data/overlay.db`) |
| `AUTH_TOKEN` | No | Shared secret for upload endpoint |
| `MODE_LABEL_*` | No | Custom display labels (e.g. `MODE_LABEL_Custom=Scrims`) |

### Client (`client/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `REPLAY_DIR` | Yes | Path to your local HotS replay folder |
| `SERVER_URL` | Yes | URL of the overlay server |
| `AUTH_TOKEN` | No | Must match server's `AUTH_TOKEN` |

## Tech Stack

- **Runtime**: Node.js
- **Replay parsing**: [hots-parser](https://github.com/ebshimizu/hots-parser)
- **Database**: SQLite via better-sqlite3
- **Server**: Express + WebSocket (ws)
- **File watching**: chokidar
- **File uploads**: multer
- **Frontend**: Vanilla HTML/CSS/JS
- **Hero images**: GitHub CDN (heroespatchnotes/heroes-talents)
- **Containerization**: Docker
