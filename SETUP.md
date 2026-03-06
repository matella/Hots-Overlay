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
TZ=America/New_York
MODE_LABEL_Custom=Scrims
```

> `REPLAY_DIR` is set automatically in the Docker container (`/app/replays`). You don't need to set it.
>
> `TZ` sets the container timezone (defaults to `America/New_York`). Set this to your local timezone so "today" matches your actual day. See [timezone list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

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

- **Windows 10 or later**

#### 1. Install the client

Download the installer from the [latest release](https://github.com/matella/Hots-Overlay/releases/latest) and run it.

The installer will:
- Install the client to Program Files
- Create a Start Menu shortcut
- Optionally create a desktop shortcut
- Optionally set the client to start with Windows

#### 2. Configure the client

Launch the client. On first run you'll see the settings panel. Configure:

1. **Server URL** — the address of your overlay server (e.g. `http://your-server:3001`)
2. **Replay Directory** — click **Browse** and navigate to your HotS replay folder:
   ```
   C:\Users\<you>\Documents\Heroes of the Storm\Accounts\<account>\<toon>\Replays\Multiplayer
   ```
3. **Auth Token** — must match the server's `AUTH_TOKEN` (leave empty if the server has no token set)

Click **Save** to connect. The client will:
- Verify the server connection (green "Connected" indicator)
- Scan your replay folder and upload any new files
- Start watching for new replays in real time

#### 3. How it works

- **System tray**: Minimizing the window hides it to the system tray. Click "Open Dashboard" in the tray menu to restore it.
- **Auto-upload**: New `.StormReplay` files are detected and uploaded automatically (with a 5-second stabilization wait to ensure the file is fully written).
- **Duplicate detection**: Files that have already been uploaded are skipped. The uploaded file list is stored in `%LOCALAPPDATA%\HotS Replay Client\uploaded.json`.
- **Offline resilience**: If the server goes offline, uploads are paused and automatically retried when it comes back. You can also click the **Rescan** button to manually trigger a re-upload of any missed files.
- **Activity log**: The dashboard shows recent upload activity with color-coded status dots:
  - Green = uploaded successfully
  - Orange = duplicate (already on server)
  - Red = failed (hover for error details)
  - Grey = skipped (server was offline)

Settings are stored in `%LOCALAPPDATA%\HotS Replay Client\settings.json`.

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
| Client shows "Disconnected" | Check the server URL in settings and that the server is running |
| Client uploads show as "Skipped" | Server is offline — they'll auto-retry when it reconnects |
| Docker container won't start | Run `docker compose logs` to see the error |
| Want to re-upload all replays | Delete `%LOCALAPPDATA%\HotS Replay Client\uploaded.json` and click Rescan |

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
├── client-rs/               # Native desktop client (Rust)
│   ├── src/
│   │   ├── main.rs          # Entry point, runtime setup
│   │   ├── app.rs           # GUI (egui/eframe)
│   │   ├── state.rs         # Shared state, events, types
│   │   ├── uploader.rs      # HTTP upload logic
│   │   ├── watcher.rs       # Filesystem watcher (notify)
│   │   ├── settings.rs      # Settings persistence
│   │   ├── tray.rs          # System tray icon
│   │   └── win_utils.rs     # Windows API FFI (show/hide window)
│   ├── assets/
│   │   ├── icon.ico         # App icon (Windows)
│   │   └── icon.png         # App icon (tray)
│   ├── build.rs             # Build script (icon, env vars)
│   ├── installer.iss        # Inno Setup installer script
│   └── Cargo.toml           # Rust dependencies
├── data/
│   └── overlay.db           # SQLite database (created at runtime)
├── Dockerfile               # Server container image
├── docker-compose.yml       # Docker orchestration
├── .env                     # Server configuration (not committed)
├── .env.example             # Configuration template
└── package.json
```
