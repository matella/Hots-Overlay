# Setup Guide

## Option A: Local Setup (server + HotS on the same machine)

### Prerequisites

- **Node.js** 18 or later — [download](https://nodejs.org/)
- **Heroes of the Storm** installed with replay files on disk
- **OBS Studio** (or any streaming software that supports Browser Sources)

### 1. Install Dependencies

```bash
cd Overlay
npm install
```

This installs: hots-parser, better-sqlite3, express, ws, chokidar, multer, dotenv.

> **Note:** `better-sqlite3` requires a native build. On Windows, you may need the "Desktop development with C++" workload from Visual Studio Build Tools. If `npm install` fails on better-sqlite3, run:
> ```bash
> npm install --global windows-build-tools
> ```

### 2. Configure Environment

Copy the example and edit it:

```bash
cp .env.example .env
```

#### Finding your replay path and ToonHandle

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

#### Custom mode labels

To rename how a game mode is displayed (e.g. show "Scrims" instead of "Custom"):

```env
MODE_LABEL_Custom=Scrims
```

### 3. Start the Server

```bash
npm start
```

On first run, the server will scan all existing replay files. This may take a minute or two depending on how many replays you have. Parsed results are cached in the SQLite database (`data/overlay.db`), so subsequent starts are instant.

You should see output like:

```
Overlay: http://localhost:3001
Scanning replays...
  100/1991
  ...
Done: 1991 new, 0 cached
Watching for new replays...
```

For development with auto-restart on file changes:

```bash
npm run dev
```

### 4. Add to OBS

1. In OBS, add a new **Browser Source**
2. Set the URL to: `http://localhost:3001`
3. Set dimensions to **800 x 120**
4. Check **"Shutdown source when not visible"** (optional, saves resources)
5. The background is transparent — position the overlay wherever you want on your scene

#### Filtering by game mode

Use the `?mode=` URL parameter in the OBS Browser Source URL:

- **Storm League only** (default): `http://localhost:3001`
- **Custom/Scrims only**: `http://localhost:3001?mode=custom`
- **All modes**: `http://localhost:3001?mode=all`

The mode parameter is case-insensitive.

> **Tip:** You can create multiple Browser Sources in OBS with different mode parameters and toggle between them with scene switching.

---

## Option B: Docker Setup (remote server + client on your PC)

Use this when the server runs on a different machine (VPS, home server, etc.) and you want to send replays from your gaming PC.

### Server Side (Docker)

#### Prerequisites

- **Docker** and **Docker Compose** installed on the server

#### 1. Clone the repository on your server

```bash
git clone <your-repo-url> hots-overlay
cd hots-overlay
```

#### 2. Configure environment

Create a `.env` file in the project root:

```env
TOON_HANDLE=2-Hero-1-2844614
PORT=3001
AUTH_TOKEN=your-secret-token
MODE_LABEL_Custom=Scrims
```

> `REPLAY_DIR` is set automatically in the Docker container (`/app/replays`). You don't need to set it.

#### 3. Start the container

```bash
docker compose up -d
```

The overlay is now accessible at `http://your-server:3001`.

To check logs:

```bash
docker compose logs -f
```

To rebuild after updates:

```bash
docker compose up -d --build
```

#### Data persistence

The SQLite database is stored in a Docker volume (`overlay-data`). Your game history survives container restarts and rebuilds.

### Client Side (your gaming PC)

#### Prerequisites

- **Node.js** 18 or later on your PC

#### 1. Install the client

```bash
cd client
npm install
```

#### 2. Configure the client

```bash
cp .env.example .env
```

Edit `client/.env`:

```env
REPLAY_DIR=C:\Users\<you>\Documents\Heroes of the Storm\Accounts\<account>\<toon>\Replays\Multiplayer
SERVER_URL=http://your-server:3001
AUTH_TOKEN=your-secret-token
```

> `AUTH_TOKEN` must match the server's `AUTH_TOKEN`.

#### 3. Start the client

```bash
npm start
```

On first run, the client uploads all existing replays to the server. This may take a while with many files. Uploaded filenames are tracked in `client/data/uploaded.json`, so subsequent starts only upload new files.

You should see output like:

```
Server: http://your-server:3001
Replays: C:\Users\matella\Documents\...
Uploading 1991 new replays (0 already uploaded)...
  50/1991
  100/1991
  ...
Watching for new replays...
```

After the initial sync, the client watches for new replays and uploads them automatically.

#### 4. Add to OBS

Same as the local setup, but use the remote server URL:

1. Add a **Browser Source** in OBS
2. URL: `http://your-server:3001` (or `http://your-server:3001?mode=custom`, etc.)
3. Dimensions: **800 x 120**

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No games shown | Check that `TOON_HANDLE` matches your account |
| "Missing required env var" error | Make sure `.env` exists with `REPLAY_DIR` and `TOON_HANDLE` |
| Overlay not updating after a game | HotS writes the replay after the score screen. Wait ~10 seconds |
| Hero images not loading | Check the console for hero name warnings |
| `better-sqlite3` install fails | Install Windows Build Tools (see above) |
| Port already in use | Change `PORT` in `.env` |
| Overlay shows wrong mode | Check the `?mode=` URL parameter |
| Client upload fails (401) | `AUTH_TOKEN` in client `.env` must match server's |
| Client upload fails (connection refused) | Check `SERVER_URL` and that the server is running |
| Docker container won't start | Run `docker compose logs` to see the error |
| Want to re-upload all replays | Delete `client/data/uploaded.json` and restart the client |

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
│   └── routes.js            # API routes (including upload)
├── public/
│   ├── index.html           # Overlay HTML
│   ├── css/overlay.css      # Styles
│   └── js/overlay.js        # Frontend logic
├── client/                  # Upload client (runs on your PC)
│   ├── client.js            # Watches replays, uploads to server
│   ├── package.json
│   ├── .env.example
│   └── data/uploaded.json   # Tracks uploaded files (created at runtime)
├── data/
│   └── overlay.db           # SQLite database (created at runtime)
├── Dockerfile               # Server container image
├── docker-compose.yml       # Docker orchestration
├── .env                     # Server configuration (not committed)
├── .env.example             # Configuration template
└── package.json
```
