# HotS Overlay

A real-time streaming overlay for Heroes of the Storm. Displays match history, hero builds, and XP graphs as an OBS browser source or Twitch extension. Parses `.StormReplay` files directly — no API needed.

## How It Works

```
Your PC                          Remote Server (Azure / Docker)
+-----------------+              +---------------------------+
|  HotS Replay    |   uploads   |  Node.js Server           |
|  Client (Rust)  | ----------> |  - Replay parser          |
|                 |    HTTP     |  - MongoDB database       |
|  Watches replay |             |  - WebSocket updates      |
|  folder, uploads|             |  - OBS overlay            |
|  new .StormReplay             |  - Twitch Extension EBS   |
|  files          |             |                           |
+-----------------+              +---------------------------+
                                     |               |
                              OBS Browser      Twitch Extension
                              Source           (Video Overlay)
```

The **desktop client** runs on your gaming PC and watches your replay folder. When a new `.StormReplay` file appears, it uploads it to the **server**. The server parses the replay, extracts player stats, talent builds, XP timelines and match events, stores everything in MongoDB, and pushes updates to connected overlays.

## Features

- **Match history sidebar** — horizontal game cards with map backgrounds, hero icons, and win/loss badges
- **Match detail view** — click any game to see full team rosters with talent build icons
- **XP lead graph** — interactive Canvas chart showing XP advantage over time, with event markers (kills, deaths, objectives, structures, mercs)
- **Auto-hide overlay** — appears on hover, fades out when mouse leaves
- **Twitch Extension** — video overlay that works on any Twitch channel
- **OBS Browser Source** — standalone overlay for local streaming
- **Public match pages** — shareable match history and detail pages at `/history.html` and `/match.html`

## Installation (Desktop Client)

1. Download `HotSReplayClient-setup.exe` from the [latest release](https://github.com/matella/Hots-Overlay/releases/latest)
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

## Twitch Extension

The overlay runs as a **Video - Fullscreen** Twitch extension. Viewers see a sidebar with recent match cards that auto-hides when the mouse leaves the stream area.

### Extension features

- **Game list** — recent matches as horizontal cards with map background, hero icons, result badge, duration, and game mode
- **Match detail** — click a card to see full rosters with hero portraits and talent build icons (fetched from [heroes-talents](https://github.com/heroespatchnotes/heroes-talents))
- **XP lead graph** — pure Canvas 2D chart with filled regions (blue = ahead, red = behind), event timeline strip, hover crosshair with tooltips
- **Auto-hide** — overlay appears for 8 seconds on load, stays visible on hover, fades out when mouse leaves
- **Configuration panel** — streamer sets player name and game mode via Extension Configuration Service

### Extension file structure

The extension frontend is packaged as a zip for Twitch Asset Hosting:

```
extension.zip
├── video_overlay.html    (CSS inlined, external JS)
├── config.html           (CSS inlined, external JS)
└── js/
    ├── overlay.js        (main overlay logic)
    ├── config.js         (config panel logic)
    └── xp-graph.js       (Canvas 2D graph component)
```

CSS is inlined in `<style>` tags (Twitch CDN serves `.css` as `text/plain`). JS remains as external files (Twitch CSP blocks inline scripts).

### Twitch Developer Console setup

1. **Extension type**: Video - Fullscreen
2. **Asset Hosting**: Upload `extension.zip`, assign to Video - Fullscreen Viewer slot
3. **Capabilities > Allowlist for URL Fetching Domains**: Add `hots-overlay.azurewebsites.net`
4. **Move to Hosted Test** or **Published** when ready

## OBS Browser Source Setup

Add a **Browser Source** in OBS with the following settings:
- **Width**: `800`
- **Height**: `120`
- **Custom CSS**: leave empty

Use one of these URLs depending on what you want to display:

### Today's games (default)

```
https://hots-overlay.azurewebsites.net
```

### Filtered by mode or player

```
https://hots-overlay.azurewebsites.net?mode=storm+league
https://hots-overlay.azurewebsites.net?view=recent&mode=custom
https://hots-overlay.azurewebsites.net?player=2-Hero-1-2844614
```

### URL Parameters Reference

| Parameter | Description | Values |
|-----------|-------------|--------|
| `mode` | Filter by game mode | `storm+league`, `custom`, `quick+match`, `all` |
| `view` | What to display | `today` (default), `recent` (last 10 games) |
| `player` | Which player to show | Player name or ToonHandle |

## Public Pages

| Page | Description |
|------|-------------|
| `/history.html` | Browsable match history with filters |
| `/match.html?id=<matchId>` | Full match detail with teams, talents, and XP graph |

## Server Setup

### Docker (recommended)

```bash
cp .env.example .env   # Edit with your settings
docker compose up -d
```

Once running, the **Mongo Express** database UI is available at:
```
http://localhost:8081
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
| `MONGODB_URI` | Yes | MongoDB connection string |
| `PORT` | No | Server port (default: `8080`) |
| `GAME_MODE` | No | Default game mode shown in overlay (default: `Storm League`) |
| `AUTH_TOKEN` | No | Shared secret for upload endpoints |
| `TWITCH_CLIENT_ID` | No | Extension Client ID from Twitch Developer Console |
| `TWITCH_EXTENSION_SECRET` | No | Base64-encoded Extension Secret |
| `TWITCH_BROADCASTER_ID` | No | Numeric Twitch user ID of the broadcaster |
| `TZ` | No | Timezone for Docker (default: `America/New_York`) |

## API

Interactive API documentation is available at `/api/docs` on your server.

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server health check |
| `GET /api/today?player=&mode=` | Today's games and stats |
| `GET /api/recent?player=&mode=&limit=` | Last N games (default 10) |
| `GET /api/recent-full?player=&mode=&limit=` | Recent games with full hero/team data (used by Twitch extension) |
| `GET /api/matches` | Paginated match list with filters |
| `GET /api/matches/:id` | Full match detail |
| `GET /api/matches/:id/replay` | Download original replay file |
| `GET /api/matches/lookup?gameDate=&map=&duration=` | Find match by date/map/duration (returns talents + XP data) |
| `GET /api/session/:date?player=&mode=` | Games for a specific date (YYYY-MM-DD) |
| `GET /api/sessions?player=&mode=&limit=` | Recent sessions with stats |
| `GET /api/modes` | Available game modes |
| `GET /api/players` | Available players |
| `POST /api/upload` | Upload replay (multipart form) |
| `POST /api/upload-raw` | Upload replay (raw binary, X-Filename header) |

## Architecture

```
Twitch Extension Frontend          EBS (this server)
(*.ext-twitch.tv)                  (hots-overlay.azurewebsites.net)
+------------------------+         +---------------------------+
| Video Overlay          | ──────> | GET /api/recent-full      |
|  - match history cards | JWT     |  - verifies Twitch JWT    |
|  - talent builds       |         |  - returns game data      |
|  - XP lead graph       |         |                           |
+------------------------+         | GET /api/matches/lookup   |
                                   |  - talent icon resolution |
| Config Panel           |         |  - XP timeline + events   |
|  - player name         |         |                           |
|  - game mode           |         | Twitch PubSub ──────────> viewers
+------------------------+         |  - broadcasts session stats
                                   |    on each new game       |
                                   +---------------------------+
```

## Tech Stack

**Server**: Node.js, Express, MongoDB (Mongoose), WebSocket, hots-parser, Docker
**Client**: Rust, egui/eframe, ureq, notify, tray-icon, Inno Setup installer
**Extension**: Vanilla JS, Canvas 2D API, Twitch Extension Helper SDK
