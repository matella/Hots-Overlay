# Setup Guide

## Prerequisites

- **Node.js** 18 or later — [download](https://nodejs.org/)
- **Heroes of the Storm** installed with replay files on disk
- **OBS Studio** (or any streaming software that supports Browser Sources)

## 1. Install Dependencies

```bash
cd Overlay
npm install
```

This installs: hots-parser, better-sqlite3, express, ws, chokidar, dotenv.

> **Note:** `better-sqlite3` requires a native build. On Windows, you may need the "Desktop development with C++" workload from Visual Studio Build Tools. If `npm install` fails on better-sqlite3, run:
> ```bash
> npm install --global windows-build-tools
> ```

## 2. Configure Environment

Copy the example and edit it:

```bash
cp .env.example .env
```

### Finding your replay path and ToonHandle

1. Open your HotS replay folder. The default location is:
   ```
   C:\Users\<you>\Documents\Heroes of the Storm\Accounts\<account>\<toon>\Replays\Multiplayer
   ```
2. The `<toon>` part of the path (e.g. `2-Hero-1-2844614`) is your **ToonHandle**.
3. Set both values in `.env`:
   ```env
   REPLAY_DIR=C:\Users\<you>\Documents\Heroes of the Storm\Accounts\142414274\2-Hero-1-2844614\Replays\Multiplayer
   TOON_HANDLE=2-Hero-1-2844614
   ```

### Custom mode labels

To rename how a game mode is displayed (e.g. show "Scrims" instead of "Custom"):

```env
MODE_LABEL_Custom=Scrims
```

You can add multiple labels: `MODE_LABEL_<ModeName>=<DisplayLabel>`.

## 3. Start the Server

```bash
npm start
```

On first run, the server will scan all existing replay files. This may take a minute or two depending on how many replays you have. Parsed results are cached in the SQLite database (`data/overlay.db`), so subsequent starts are instant.

You should see output like:

```
Overlay: http://localhost:3001
Scanning replays...
  100/1991
  200/1991
  ...
Done: 1991 new, 0 cached
Watching for new replays...
```

For development with auto-restart on file changes:

```bash
npm run dev
```

## 4. Add to OBS

1. In OBS, add a new **Browser Source**
2. Set the URL to: `http://localhost:3001`
3. Set dimensions to **800 x 120**
4. Check **"Shutdown source when not visible"** (optional, saves resources)
5. The background is transparent — position the overlay wherever you want on your scene

### Filtering by game mode

Use the `?mode=` URL parameter in the OBS Browser Source URL:

- **Storm League only** (default): `http://localhost:3001`
- **Custom/Scrims only**: `http://localhost:3001?mode=custom`
- **All modes**: `http://localhost:3001?mode=all`

The mode parameter is case-insensitive, so `storm+league`, `Storm+League`, and `STORM+LEAGUE` all work.

> **Tip:** You can create multiple Browser Sources in OBS with different mode parameters and toggle between them with scene switching.

## 5. Verify It Works

1. Open `http://localhost:3001` in a browser — you should see your game history
2. Check the API: `http://localhost:3001/api/today` should return JSON with today's games
3. Play a game of HotS — after the replay file is written, the overlay updates automatically

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No games shown | Check that `REPLAY_DIR` points to the correct folder and `TOON_HANDLE` matches your account |
| "Missing required env var" error | Make sure `.env` exists and has `REPLAY_DIR` and `TOON_HANDLE` set |
| Overlay not updating after a game | HotS writes the replay after the score screen. Wait ~10 seconds. Check server console for "New replay detected" |
| Hero images not loading | Some heroes need overrides in `src/heroNames.js`. Check the console for warnings about unexpected characters |
| `better-sqlite3` install fails | Install Windows Build Tools: `npm install --global windows-build-tools` |
| Port already in use | Change `PORT` in `.env` to a different port |
| Overlay shows wrong mode | Check the `?mode=` URL parameter. Use `http://localhost:3001/api/modes` to see available modes |

## Project Structure

```
Overlay/
├── server.js               # Entry point: Express + WebSocket + orchestration
├── src/
│   ├── config.js            # Centralized config from .env
│   ├── database.js          # SQLite schema + queries
│   ├── parser.js            # Replay parsing (hots-parser wrapper)
│   ├── watcher.js           # File system watcher (chokidar)
│   ├── heroNames.js         # Hero name → image URL mapping
│   └── routes.js            # API routes
├── public/
│   ├── index.html           # Overlay HTML
│   ├── css/overlay.css      # Styles
│   └── js/overlay.js        # Frontend logic
├── data/
│   └── overlay.db           # SQLite database (created at runtime)
├── .env                     # Your configuration (not committed)
├── .env.example             # Configuration template
└── package.json
```
