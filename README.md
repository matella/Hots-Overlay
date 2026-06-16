**English** · [Français](README.fr.md)

# HotS Overlay

The **replay uploader** for Heroes of the Storm: a small client that watches your replay folder and
uploads new `.StormReplay` files to a [Storm Codex](https://github.com/matella/storm-codex) server,
which parses them and powers stats, match pages and OBS overlays.

> **Recommended setup:** run the all-in-one self-hosted bundle —
> **[storm-codex-suite](https://github.com/matella/storm-codex-suite)** (one `docker compose up`) —
> then point this uploader at it.

## The uploader

It runs on your **gaming PC**, backfills your existing replays, then watches for new games. The
**server URL**, **upload token** and **replay folder** are all set at runtime — **nothing is baked
into the binary**, so the same build works against any server.

Two ways to run it:

- **Headless Docker** (`ghcr.io/matella/hots-uploader`) — for all-Docker setups. Configure via the
  `SERVER_URL`, `AUTH_TOKEN` and `REPLAY_DIR` environment variables (the `storm-codex-suite` compose
  has an `uploader` profile that wires these for you).
- **Native Windows app** (GUI, system tray, auto-start) — no prebuilt `.exe` is published (it would
  bake in a server/token). Build it from `client-rs/`:
  ```powershell
  cargo build --release            # binary in client-rs/target/release/
  # optional installer (needs Inno Setup `iscc` in PATH):
  .\client-rs\build-uploader.ps1 -Server "http://<server-ip>:5102" -Token "<your-token>" -Installer
  ```

### First run
1. Launch the app, open **Settings**.
2. Set the **Server URL** (e.g. `http://<server-ip>:5102`) and **upload token** (created in the
   server's *Admin → Upload tokens*).
3. Add your **replay folder** (see below) and **Save**. Settings persist locally.

It sits in the system tray and uploads new replays automatically; if the server goes offline, uploads
resume when it comes back.

### Where to find your replay folder
HotS saves replays to:
```
C:\Users\<YourName>\Documents\Heroes of the Storm\Accounts\<AccountNumber>\<ToonHandle>\Replays\Multiplayer
```
Point the uploader at `…\Heroes of the Storm\Accounts` and it discovers every account/toon under it.

## Tech stack
**Uploader** (`client-rs/`): Rust, egui/eframe, ureq, notify, tray-icon, Inno Setup installer.

## Legacy: standalone overlay server

This repo also contains the project's **original** all-in-one server — a Node.js/Express + MongoDB
app (`server.js`, `src/`, `public/`) with its own OBS overlay and a **Twitch extension**
(`twitch-extension/`), originally deployed on Azure. It is **superseded by Storm Codex** (Rust +
PostgreSQL, richer stats and overlays) and kept here for reference. If you still want to run it, see
[`SETUP.md`](SETUP.md) and [`DEVELOPMENT.md`](DEVELOPMENT.md).

## Acknowledgements
Replay parsing logic descends from [hots-parser](https://github.com/ebshimizu/hots-parser) by
[@ebshimizu](https://github.com/ebshimizu) (MIT). Talent data from
[heroes-talents](https://github.com/heroespatchnotes/heroes-talents). Heroes of the Storm™ is a
trademark of Blizzard Entertainment, Inc. This project is not affiliated with Blizzard.
