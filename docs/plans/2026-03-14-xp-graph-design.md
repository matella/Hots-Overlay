# XP Lead Graph — Design

## Goal

Add a League-of-Legends-style XP lead graph to the match detail view, showing the experience advantage over time with an event timeline strip below it. Appears on both the Twitch overlay and the public match page.

## Data Pipeline

### Parser (`src/parser.js`)

Extract from `result.match.XPBreakdown` (available every 60s per team):
- Compute total XP per team at each timestamp by summing `MinionXP + CreepXP + StructureXP + HeroXP + TrickleXP`
- Compute XP lead: `team0Total - team1Total` (positive = team 0 ahead)

Extract timeline events from existing parser data:
- **Kills**: from `result.match.takedowns` — `{time, team, subject, target}`
- **Objectives**: from `result.match.objective` — `{time, team, details}`
- **Structures**: from `result.match.structures` — fort/keep destruction events
- **Mercs**: from `result.match.mercs` — `{time, team}`

### Schema (`src/db/match.model.js`)

Add to MatchSchema:
- `xpTimeline: [{ time: Number, lead: Number }]` — XP lead at each 60s interval
- Events array already exists, ensure kills/objectives/structures/mercs are all captured with `type` field

### API

`/api/matches/lookup` already returns full match data. Include `xpTimeline` and `events` in response.

## Graph Component

### Architecture

Single shared file: `public/js/xp-graph.js` with a `drawXpGraph(canvas, data)` function. Both pages include it via `<script>` tag. Pure Canvas 2D API — no libraries.

### Layout

Canvas with ~3:1 aspect ratio, fills container width.

**Main area (~80% height)**: XP lead curve
- Center horizontal line = 0 (even XP)
- Above center = your team ahead (blue fill)
- Below center = enemy ahead (red fill)
- Filled area between curve and zero line
- Y-axis labels on left (e.g. 2k, 4k)
- X-axis labels on bottom (e.g. 5:00, 10:00)
- Subtle grid lines

**Event strip (~20% height)**: Single timeline row
- Dots at time positions, colored by event type:
  - Kill: blue
  - Death: red
  - Objective: yellow/gold
  - Structure: orange
  - Merc: green
- Dot size scales with importance (keep > fort)
- Hover tooltip showing event details

**Legend row**: Below event strip, colored dots with labels

### Styling

Dark theme matching overlay aesthetic:
- Dark background
- Subtle grid lines
- Semi-transparent blue/red fills
- White/light axis labels

## Integration

### Overlay (`overlay.js`)
- Append canvas after team sections in `openDetail()`
- Data from existing `fetchMatchDetails()` response
- Renders once data arrives

### Public match page (`match.html`)
- Canvas between match header and team rosters
- Same `drawXpGraph()` function, wider container

## Constraints

- No external dependencies (pure Canvas 2D)
- Works inside Twitch extension iframe (no CSP issues)
- No interactivity beyond hover tooltips
