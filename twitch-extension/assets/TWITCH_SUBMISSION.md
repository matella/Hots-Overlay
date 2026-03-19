# Twitch Extension Submission — HotS Overlay

## Store Listing Details

### Extension Name
HotS Overlay

### Short Description (140 chars max)
Real-time Heroes of the Storm overlay — shows match history, win/loss stats, hero portraits, and talent builds on stream.

### Full Description
HotS Overlay brings your Heroes of the Storm session to life on your Twitch stream. Viewers see your recent games as hero portrait tiles with win/loss indicators, session stats (W/L/win rate), and can click into any game for full team compositions and talent builds.

**Features:**
- Real-time updates — new games appear instantly as replays are saved
- Hero portrait tiles with green (win) / red (loss) glow borders
- Session stats: wins, losses, and win rate
- Click any game for detailed view: both teams, all heroes, full talent builds
- XP timeline graphs for each match
- Configurable game mode filter (Storm League, QM, ARAM, etc.)
- Responsive design that adapts to all viewer resolutions (480p–4K)
- Dark theme designed to blend with the game UI
- Safe zones avoid overlapping the HotS ability bar and score panel

**How it works:**
1. Broadcaster installs the companion desktop client (or self-hosts the server)
2. The client watches for new .StormReplay files and uploads them automatically
3. The overlay updates in real time via WebSocket and Twitch PubSub

**Open source:** https://github.com/matella/Hots-Overlay

### Category
Gaming

### Tags
heroes-of-the-storm, hots, moba, blizzard, overlay, stats, match-history

---

## Required Assets

| Asset | Size | File |
|-------|------|------|
| Extension Icon (large) | 100×100 PNG | `icon-100x100.png` |
| Extension Icon (small) | 24×24 PNG | `icon-24x24.png` |
| Screenshot | 1920×1080 | Open `screenshot-mockup.html` in browser, take screenshot |

### How to capture the screenshot
1. Open `screenshot-mockup.html` in Chrome
2. Press F12 → toggle device toolbar → set to 1920×1080
3. Take a full-page screenshot (Ctrl+Shift+P → "Capture screenshot")
4. Save as `screenshot-1920x1080.png`

---

## URLs & Contact

| Field | Value |
|-------|-------|
| **Privacy Policy URL** | `https://hots-overlay.azurewebsites.net/privacy.html` |
| **Support Contact** | `https://github.com/matella/Hots-Overlay/issues` |
| **Source Code** | `https://github.com/matella/Hots-Overlay` |
| **Terms of Service** | MIT License — https://github.com/matella/Hots-Overlay/blob/main/LICENSE |

---

## Extension Configuration

### Extension Type
- **Video Overlay** (primary) — portrait strip + interactive sidebar
- **Panel** (secondary) — detailed game list for channel page

### Viewer Capabilities
- Video overlay: Click hero tiles to view match details
- Panel: Browse recent games with full team compositions

### Broadcaster Configuration
- EBS Server URL (required)
- Player name or toon handle (required)
- Game mode filter (optional, defaults to Storm League)
- Overlay position (bottom-left, bottom-right, top-left, top-right)

### Content Security Policy
Extension frontend communicates with:
- `https://hots-overlay.azurewebsites.net` (EBS API)
- `wss://hots-overlay.azurewebsites.net` (WebSocket for real-time updates)
- Twitch PubSub (via `window.Twitch.ext.listen`)

### Allowlist Domains
- `hots-overlay.azurewebsites.net`

---

## Review Notes for Twitch

- Extension is **read-only** — it only displays game data, no user input beyond clicking tiles
- No ads, no monetization, no affiliate links
- Open-source under MIT license
- The extension does NOT require Bits or subscriptions
- Authentication: Bearer token protects upload endpoints only; all viewer-facing endpoints are public read-only
- CORS restricts browser API access to `*.ext-twitch.tv` and localhost
