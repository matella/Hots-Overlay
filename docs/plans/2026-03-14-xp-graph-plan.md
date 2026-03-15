# XP Lead Graph — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a League-style XP lead graph with event timeline strip to the match detail view on both the Twitch overlay and public match page.

**Architecture:** Extract XP breakdown data from hots-parser into an `xpTimeline` array on the match document. A shared pure-Canvas drawing function (`public/js/xp-graph.js`) renders the graph. Both the overlay and public match page call the same function.

**Tech Stack:** Canvas 2D API (no libraries), Node.js parser, Mongoose/MongoDB

---

### Task 1: Fix team index bug in extractEvents

The `extractEvents` function at `src/parser.js:61` has the same `team - 1` bug we fixed for players. The parser already returns 0-indexed teams.

**Files:**
- Modify: `src/parser.js:61`

**Step 1: Fix the bug**

Change line 61 from:
```js
if (p && typeof p.team === 'number') playerTeam[toon] = p.team - 1;
```
to:
```js
if (p && typeof p.team === 'number') playerTeam[toon] = p.team;
```

**Step 2: Commit**

```bash
git add src/parser.js
git commit -m "fix: remove incorrect team index offset in extractEvents"
```

---

### Task 2: Add XP timeline extraction to parser

Extract XP lead data from `result.match.XPBreakdown` and add merc capture events.

**Files:**
- Modify: `src/parser.js` — add `extractXpTimeline` function, add merc events to `extractEvents`, include xpTimeline in matchDoc

**Step 1: Add extractXpTimeline function**

Add after `extractTalents` (after line 52), before `extractEvents`:

```js
function extractXpTimeline(xpBreakdown) {
  if (!Array.isArray(xpBreakdown) || xpBreakdown.length === 0) return [];

  // Group entries by time — each time has two entries (one per team)
  const byTime = new Map();
  for (const entry of xpBreakdown) {
    const t = entry.time;
    if (!byTime.has(t)) byTime.set(t, {});
    const bd = entry.breakdown || {};
    const total = (bd.MinionXP || 0) + (bd.CreepXP || 0) +
                  (bd.StructureXP || 0) + (bd.HeroXP || 0) + (bd.TrickleXP || 0);
    byTime.get(t)[entry.team] = total;
  }

  const timeline = [];
  for (const [time, teams] of byTime) {
    const t0 = teams[0] || 0;
    const t1 = teams[1] || 0;
    timeline.push({ time, lead: Math.round(t0 - t1) });
  }
  timeline.sort((a, b) => a.time - b.time);
  return timeline;
}
```

**Step 2: Add merc capture events to extractEvents**

Add after the objective events block (after line 126, before the sort at line 128):

```js
  // Merc capture events
  const mercs = result.match.mercs;
  if (mercs) {
    for (const teamIdx of [0, 1]) {
      const teamMercs = mercs[teamIdx];
      if (!teamMercs || !Array.isArray(teamMercs.events)) continue;
      for (const ev of teamMercs.events) {
        if (typeof ev.time !== 'number') continue;
        events.push({
          type: 'merc_capture',
          time: ev.time,
          team: ev.team ?? teamIdx,
          subject: null,
          target: null,
          details: { name: ev.type || 'Mercenary' },
        });
      }
    }
  }
```

**Step 3: Include xpTimeline in matchDoc**

In the `parseReplay` function, add xpTimeline extraction and include it in matchDoc.

After `const events = extractEvents(result);` (line 210), add:
```js
  const xpTimeline = extractXpTimeline(result.match.XPBreakdown);
```

In the matchDoc object (lines 219-234), add `xpTimeline` after `events`:
```js
    events,
    xpTimeline,
```

Also update the return statement (line 236) to include xpTimeline:
```js
  return { players, teams, gameFingerprint, events, xpTimeline, matchDoc };
```

**Step 4: Commit**

```bash
git add src/parser.js
git commit -m "feat: extract XP timeline and merc events from replays"
```

---

### Task 3: Update MongoDB schema

Add `xpTimeline` field to MatchSchema, and add `merc_capture` as a recognized event type.

**Files:**
- Modify: `src/db/match.model.js`

**Step 1: Add XpTimelineSchema and update MatchSchema**

Add after EventSchema (after line 50):
```js
const XpPointSchema = new Schema(
  {
    time: { type: Number },
    lead: { type: Number },
  },
  { _id: false },
);
```

Add `xpTimeline` field to MatchSchema (after the `events` field on line 66):
```js
    xpTimeline: { type: [XpPointSchema], default: [] },
```

Export `XpPointSchema` alongside other schemas.

**Step 2: Commit**

```bash
git add src/db/match.model.js
git commit -m "feat: add xpTimeline schema to Match model"
```

---

### Task 4: Update API routes to return xpTimeline

Both `/matches/:id` and `/matches/lookup` need to return xpTimeline and events.

**Files:**
- Modify: `src/routes.js:358-366` (lookup endpoint response)
- Modify: `src/routes.js:395-407` (match by id response)

**Step 1: Add xpTimeline and events to lookup response**

In the lookup endpoint response (line 358-366), add:
```js
    res.json({
      id: match._id,
      gameDate: match.gameDate,
      map: match.map,
      mapImage: getMapImageUrl(match.map),
      gameMode: match.gameMode,
      duration: match.duration,
      teams,
      events: match.events || [],
      xpTimeline: match.xpTimeline || [],
    });
```

**Step 2: Add xpTimeline to match-by-id response**

In the `/matches/:id` response (line 395-407), add `xpTimeline`:
```js
    res.json({
      id: match._id,
      fingerprint: match.fingerprint,
      filename: match.filename,
      gameDate: match.gameDate,
      map: match.map,
      mapImage: getMapImageUrl(match.map),
      gameMode: match.gameMode,
      duration: match.duration,
      hasReplay: !!(match.replayPath && fs.existsSync(match.replayPath)),
      teams,
      events: match.events || [],
      xpTimeline: match.xpTimeline || [],
    });
```

**Step 3: Commit**

```bash
git add src/routes.js
git commit -m "feat: return xpTimeline and events from match API endpoints"
```

---

### Task 5: Re-parse all replays

Re-import all replays to populate xpTimeline and merc events in MongoDB.

**Step 1: Write and run re-parse script**

Create `tmp_reparse.js`:
```js
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('./src/config');
const { Match } = require('./src/db/match.model');
const { parseReplay } = require('./src/parser');
const fs = require('fs');
const path = require('path');

function findReplays(dir, results, depth) {
  if (depth > 8) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.endsWith('.StormReplay')) results.push(full);
      else if (e.isDirectory()) findReplays(full, results, depth + 1);
    }
  } catch {}
}

async function main() {
  await mongoose.connect(config.mongoUri);
  await Match.deleteMany({});
  const replayDir = process.env.REPLAY_DIR || path.join(process.env.USERPROFILE, 'Documents/Heroes of the Storm/Accounts');
  const replays = [];
  findReplays(replayDir, replays, 0);
  console.log('Found', replays.length, 'replays');
  let ok = 0, fail = 0;
  for (const rp of replays) {
    try {
      const result = parseReplay(rp);
      if (result.error) { fail++; continue; }
      await Match.findOneAndUpdate(
        { fingerprint: result.matchDoc.fingerprint },
        result.matchDoc,
        { upsert: true }
      );
      ok++;
    } catch { fail++; }
  }
  console.log('Done:', ok, 'ok,', fail, 'failed');
  // Verify
  const m = await Match.findOne({ 'xpTimeline.0': { $exists: true } });
  if (m) console.log('XP timeline points:', m.xpTimeline.length, 'events:', m.events.length);
  else console.log('WARNING: no matches with xpTimeline found');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
```

Run: `node tmp_reparse.js`
Expected: All replays re-imported with xpTimeline populated.

Delete `tmp_reparse.js` after.

---

### Task 6: Build the Canvas graph component

Create `public/js/xp-graph.js` — a standalone script that draws the XP lead graph with event strip.

**Files:**
- Create: `public/js/xp-graph.js`

**Step 1: Write the graph drawing function**

The file exposes a global `drawXpGraph(canvas, data, options)` function.

`data` shape:
```js
{
  xpTimeline: [{ time, lead }],   // XP lead at 60s intervals
  events: [{ type, time, team }], // all match events
  duration: 1200,                  // match duration in seconds
  myTeam: 0                       // which team index is "mine" (for color direction)
}
```

Implementation requirements:
- Canvas fills container width, height = width / 3
- Use `devicePixelRatio` for crisp rendering on HiDPI displays
- **Graph area** (top 75%):
  - Draw subtle horizontal grid lines at XP intervals
  - Draw center zero-line slightly brighter
  - Plot XP lead as a filled area curve: blue above zero (my team ahead), red below (enemy ahead)
  - Y-axis labels on left margin (format: 1k, 2k, etc.)
  - X-axis labels along bottom (5:00, 10:00, etc.)
- **Event strip** (next 15%):
  - Single horizontal band
  - Dots positioned at event time, colored by type:
    - `kill`: `#60a5fa` (blue)
    - `kill` where team !== myTeam (death): `#f87171` (red)
    - `objective`: `#fbbf24` (gold)
    - `fort_destroyed`: `#fb923c` (orange)
    - `merc_capture`: `#4ade80` (green)
  - Dot radius: 3px default, 4px for structures
- **Legend** (bottom 10%):
  - Row of colored dots with text labels
- **Hover tooltip**:
  - Listen to `mousemove` on canvas
  - Show a tooltip (positioned div, not canvas-drawn) when hovering near an event dot
  - Tooltip shows event type, time, and details

**Step 2: Commit**

```bash
git add public/js/xp-graph.js
git commit -m "feat: add pure-Canvas XP lead graph component"
```

---

### Task 7: Integrate graph into public match page

Add the XP graph section to `public/match.html` and call `drawXpGraph` from `public/js/match.js`.

**Files:**
- Modify: `public/match.html:53-60` — add graph section between talents and timeline
- Modify: `public/js/match.js` — add `renderXpGraph` call

**Step 1: Add HTML section**

In `public/match.html`, after the talents section (after line 53) and before the timeline section (line 55), insert:
```html
      <!-- XP Lead Graph -->
      <section class="section-card" id="section-xp-graph">
        <h2 class="section-title">XP Advantage</h2>
        <div class="xp-graph-container">
          <canvas id="xp-graph-canvas"></canvas>
        </div>
      </section>
```

Add the script tag before `match.js` (before line 65):
```html
  <script src="/js/xp-graph.js"></script>
```

**Step 2: Add CSS for the graph container**

In the match page's existing stylesheet (or inline in match.html `<style>` if that's the pattern), add:
```css
.xp-graph-container {
  position: relative;
  width: 100%;
}
.xp-graph-container canvas {
  width: 100%;
  display: block;
}
```

**Step 3: Call drawXpGraph in match.js**

Add a `renderXpGraph(match)` function in `public/js/match.js` that:
1. Gets the canvas element `#xp-graph-canvas`
2. Determines which team is "mine" (team with the streamer's player, or team 0 by default)
3. Calls `drawXpGraph(canvas, { xpTimeline: match.xpTimeline, events: match.events, duration: match.duration, myTeam })`
4. If no xpTimeline data, hides the section

Call it from wherever the other render functions are called (alongside `renderTimeline`).

**Step 4: Commit**

```bash
git add public/match.html public/js/match.js
git commit -m "feat: integrate XP graph into public match page"
```

---

### Task 8: Integrate graph into Twitch overlay detail view

Add the XP graph canvas to the overlay's match detail view.

**Files:**
- Modify: `public/extension/video_overlay.html` — add xp-graph.js script tag
- Modify: `public/extension/js/overlay.js` — render graph in detail view
- Modify: `public/extension/css/overlay.css` — add graph container styles

**Step 1: Add script tag to overlay HTML**

In `public/extension/video_overlay.html`, before the overlay.js script tag (before line 17):
```html
  <script src="/js/xp-graph.js"></script>
```

Note: The overlay loads scripts from the extension's hosted files. The path may need to be `../js/xp-graph.js` or an absolute URL depending on how the extension is served. During local test it should work as a relative path from the server root.

**Step 2: Add graph rendering in overlay.js**

In `fetchMatchDetails()` (around line 259-298), after the team re-rendering is complete, add:
```js
      // Render XP graph if data available
      if (match.xpTimeline && match.xpTimeline.length > 0) {
        var graphSection = document.createElement('div');
        graphSection.className = 'xp-graph-section';
        var graphCanvas = document.createElement('canvas');
        graphCanvas.id = 'overlay-xp-graph';
        graphSection.appendChild(graphCanvas);
        detailView.appendChild(graphSection);

        var isWin = myWin && myWin.result === 'win';
        var myTeamIdx = 0;
        if (match.teams) {
          for (var ti = 0; ti < match.teams.length; ti++) {
            if ((isWin && match.teams[ti].win) || (!isWin && !match.teams[ti].win)) {
              myTeamIdx = match.teams[ti].teamIndex;
              break;
            }
          }
        }

        drawXpGraph(graphCanvas, {
          xpTimeline: match.xpTimeline,
          events: match.events || [],
          duration: match.duration,
          myTeam: myTeamIdx
        });
      }
```

**Step 3: Add CSS for overlay graph**

In `public/extension/css/overlay.css`, add:
```css
/* ─── XP Graph ──────────────────────────────────────────────────── */
.xp-graph-section {
  position: relative;
  background: rgba(10, 10, 20, 0.6);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 8px;
  margin-top: 4px;
}

.xp-graph-section canvas {
  width: 100%;
  display: block;
}
```

**Step 4: Commit**

```bash
git add public/extension/video_overlay.html public/extension/js/overlay.js public/extension/css/overlay.css
git commit -m "feat: integrate XP graph into Twitch overlay detail view"
```

---

### Task 9: Verify end-to-end

**Step 1: Start the server**

```bash
node server.js
```

**Step 2: Test public match page**

Open a match detail page in the browser. Verify:
- XP graph section appears between talents and timeline
- Graph shows blue/red filled areas
- Event strip shows colored dots
- Hover tooltips work

**Step 3: Test Twitch overlay**

Open the local test overlay. Click a match card. Verify:
- XP graph appears below team sections in detail view
- Graph renders correctly within 420px width
- Scrolling works if content overflows

**Step 4: Final commit if any tweaks needed**
