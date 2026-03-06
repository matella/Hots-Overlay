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

## Preview

```
┌─────────────────────────────────────────┐
│  Storm League – 5W – 3L | 62.5%        │
│  [🟢][🟢][🔴][🟢][🔴][🟢][🟢][🔴]    │
└─────────────────────────────────────────┘
```

## Quick Start

```bash
npm install
cp .env.example .env   # Edit .env with your paths
npm start
```

Then add `http://localhost:3001` as an OBS Browser Source (800x120, transparent background).

See [SETUP.md](SETUP.md) for detailed instructions.

## URL Parameters

Control the displayed mode via the `?mode=` URL parameter (case-insensitive):

| URL | Shows |
|-----|-------|
| `http://localhost:3001` | Default mode (Storm League) |
| `http://localhost:3001?mode=storm+league` | Storm League only |
| `http://localhost:3001?mode=custom` | Custom games only |
| `http://localhost:3001?mode=all` | All modes (with badges) |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/today?mode=` | Today's games and stats |
| `GET /api/session/:date?mode=` | Games for a specific date (YYYY-MM-DD) |
| `GET /api/sessions?mode=&limit=10` | Recent sessions with stats |
| `GET /api/modes` | Available modes, default, and labels |

## Configuration

All configuration is in `.env`. See [.env.example](.env.example) for all options.

| Variable | Required | Description |
|----------|----------|-------------|
| `REPLAY_DIR` | Yes | Path to your HotS replay folder |
| `TOON_HANDLE` | Yes | Your ToonHandle (e.g. `2-Hero-1-2844614`) |
| `PORT` | No | Server port (default: `3000`) |
| `GAME_MODE` | No | Default game mode (default: `Storm League`) |
| `DB_PATH` | No | SQLite database path (default: `./data/overlay.db`) |
| `MODE_LABEL_*` | No | Custom display labels (e.g. `MODE_LABEL_Custom=Scrims`) |

## Tech Stack

- **Runtime**: Node.js
- **Replay parsing**: [hots-parser](https://github.com/ebshimizu/hots-parser)
- **Database**: SQLite via better-sqlite3
- **Server**: Express + WebSocket (ws)
- **File watching**: chokidar
- **Frontend**: Vanilla HTML/CSS/JS
- **Hero images**: GitHub CDN (heroespatchnotes/heroes-talents)
