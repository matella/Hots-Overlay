'use strict';

/**
 * @file src/mongoSchema.js
 *
 * Mongoose schema definitions for the Hots-Overlay MongoDB backend.
 *
 * Document model: one Match document per game (one .StormReplay = one Match).
 * The SQLite schema stored one row per player per game; here all 10 players,
 * both teams, bans, talents, and the event timeline are embedded in a single
 * atomic document.
 *
 * Parser field mapping (hots-parser v7):
 *   result.match.date              → gameDate  (pass Date object directly)
 *   result.match.map               → map
 *   result.match.mode              → gameMode  (via GAME_MODE_STRINGS lookup)
 *   result.match.length            → duration  (Math.round((length - loopGameStart) / 16))
 *   result.match.bans["0"|"1"]     → teams[].bans  (map b => b.hero)
 *   result.match.takedowns[]       → events[]  (type: "kill")
 *   result.players[toon].team      → teamIndex (parser is 1-indexed: 1→0, 2→1)
 *   result.players[toon].win       → teams[].win
 *   result.players[toon].hero      → hero
 *   result.players[toon].name      → playerName
 *   result.players[toon].heroLevel → heroLevel
 *   result.players[toon].talents   → talents[] (object {"Tier1Choice": name} → [{tier,name}])
 *   result.players[toon].gameStats → stats     (Mixed, hero-specific)
 *
 * Note on fort_destroyed / objective events: hots-parser exposes these as
 * aggregated totals (result.match.structures, result.match.objective), not as
 * individual timed events. Timestamped entries for these types require raw
 * trackerevents parsing and are schema placeholders until that work is done.
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/**
 * One talent selection for a player.
 *
 * hots-parser returns talents as an object keyed by tier name:
 *   { "Tier1Choice": "TalentName", "Tier4Choice": "OtherTalent", ... }
 * We normalize to an array so each tier is a typed value object.
 *
 * Transformation:
 *   const TIER_MAP = {
 *     Tier1Choice: 1, Tier4Choice: 4, Tier7Choice: 7, Tier10Choice: 10,
 *     Tier13Choice: 13, Tier16Choice: 16, Tier20Choice: 20,
 *   };
 *   talents = Object.entries(raw)
 *     .filter(([k]) => TIER_MAP[k] != null)
 *     .map(([k, name]) => ({ tier: TIER_MAP[k], name }))
 *     .sort((a, b) => a.tier - b.tier);
 */
const TalentSchema = new Schema(
  {
    tier: {
      type: Number,
      required: true,
      enum: [1, 4, 7, 10, 13, 16, 20],
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false },
);

/**
 * One player's data within a team.
 *
 * toonHandle: Blizzard unique account ID (e.g. "2-Hero-1-12345678").
 *             Primary cross-game player key; equivalent to the SQLite toon_handle.
 * playerName: Battle.net display name at the time of the game (may change).
 * heroLevel:  Hero mastery level at time of the game (from player.heroLevel).
 * talents:    0–7 entries; may be fewer if the game ended before a talent tier.
 * stats:      End-of-game performance stats (Mixed because keys vary by hero/patch).
 */
const PlayerSchema = new Schema(
  {
    toonHandle: {
      type: String,
      required: true,
    },
    playerName: {
      type: String,
      required: true,
      trim: true,
    },
    hero: {
      type: String,
      required: true,
      trim: true,
    },
    heroShort: {
      type: String,
      required: true,
      trim: true,
    },
    heroLevel: {
      type: Number,
      min: 1,
      default: null,
    },
    talents: {
      type: [TalentSchema],
      default: [],
    },
    stats: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  { _id: false },
);

/**
 * One team within the match.
 *
 * teamIndex: 0 = blue team, 1 = red team.
 *            Normalize from parser's 1-indexed team values: player.team - 1.
 * bans:      Banned hero names. Only populated in draft modes (Hero League,
 *            Storm League, Unranked Draft). result.match.bans is keyed by
 *            string "0"/"1"; each entry has shape { hero, order, absolute }.
 *            HotS allows up to 3 bans per team (some formats up to 5).
 */
const TeamSchema = new Schema(
  {
    teamIndex: {
      type: Number,
      required: true,
      enum: [0, 1],
    },
    win: {
      type: Boolean,
      required: true,
    },
    bans: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => v.length <= 5,
        message: 'A team cannot have more than 5 bans',
      },
    },
    players: {
      type: [PlayerSchema],
      default: [],
      validate: {
        validator: (v) => v.length <= 5,
        message: 'A team cannot have more than 5 players',
      },
    },
  },
  { _id: false },
);

/**
 * A single game event from the match timeline.
 *
 * "kill" — A hero death. Source: result.match.takedowns[].
 *   time:    Seconds since game start: Math.round((td.loop - loopGameStart) / 16)
 *   team:    teamIndex of the killing team (look up killers[0].player in players map)
 *   subject: toonHandle of the primary killer (td.killers[0]?.player)
 *   target:  toonHandle of the victim (td.victim.player)
 *
 * "fort_destroyed" — A fort/keep/core destroyed.
 *   NOTE: hots-parser exposes only aggregated structure totals, not per-event
 *   timestamps. This type is a schema placeholder; populate when raw
 *   trackerevents parsing is implemented.
 *   team:    teamIndex of the team that LOST the structure.
 *   name:    Structure type (e.g. "Fort", "Keep", "Core").
 *
 * "objective" — A map objective captured.
 *   NOTE: Same caveat as fort_destroyed — aggregates only in current parser.
 *   team:    teamIndex of the capturing team.
 *   name:    Objective name (map-specific, e.g. "Tribute", "Dragon Knight").
 *
 * All time values are in seconds (not game loops).
 */
const EventSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['kill', 'fort_destroyed', 'objective'],
    },
    time: {
      type: Number,
      required: true,
      min: 0,
    },
    team: {
      type: Number,
      enum: [0, 1, null],
      default: null,
    },
    subject: {
      type: String,
      default: null,
    },
    target: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      default: null,
    },
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// Top-level Match schema
// ---------------------------------------------------------------------------

/**
 * One Match document = one Heroes of the Storm game.
 *
 * fingerprint: SHA-256 hex of "${gameDate}|${map}|${duration}|${sortedToons}".
 *              Matches the algorithm in src/parser.js. Used for deduplication
 *              across different .StormReplay uploads of the same game.
 * replayPath:  Absolute path to the .StormReplay file on disk (may be null
 *              if uploaded remotely without a known local path).
 * duration:    Game length in seconds: Math.round((match.length - match.loopGameStart) / 16).
 * teams:       Always exactly 2 entries (teamIndex 0 = blue, 1 = red).
 * events:      Ordered chronologically by time. Initially populated with kill
 *              events from result.match.takedowns; fort/objective events require
 *              additional parser work.
 * timestamps:  Mongoose adds createdAt and updatedAt automatically.
 */
const MatchSchema = new Schema(
  {
    fingerprint: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: /^[a-f0-9]{64}$/,
    },

    filename: {
      type: String,
      required: true,
      trim: true,
    },

    replayPath: {
      type: String,
      default: null,
      trim: true,
    },

    gameDate: {
      type: Date,
      required: true,
    },

    map: {
      type: String,
      required: true,
      trim: true,
    },

    gameMode: {
      type: String,
      required: true,
      trim: true,
      enum: [
        'Quick Match',
        'Versus AI',
        'Brawl',
        'Practice',
        'Unranked Draft',
        'Hero League',
        'Team League',
        'Storm League',
        'Custom',
        'Unknown',
      ],
    },

    duration: {
      type: Number,
      required: true,
      min: 0,
    },

    teams: {
      type: [TeamSchema],
      required: true,
      validate: {
        validator: (v) => v.length === 2,
        message: 'A match must have exactly 2 teams',
      },
    },

    events: {
      type: [EventSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'matches',
  },
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// fingerprint already has a unique index from the field definition above.

// gameDate: date-range queries (today's games, session lookup).
MatchSchema.index({ gameDate: 1 }, { name: 'idx_gameDate' });

// gameMode: filtering and listing distinct modes.
MatchSchema.index({ gameMode: 1 }, { name: 'idx_gameMode' });

// toonHandle multikey: MongoDB auto-indexes through the nested arrays
// teams[].players[].toonHandle. Used for player-specific game history.
MatchSchema.index(
  { 'teams.players.toonHandle': 1 },
  { name: 'idx_toonHandle' },
);

// Compound multikey: toonHandle + gameMode — mirrors the SQLite
// idx_replays_toon_mode compound index for the most common filter pattern.
MatchSchema.index(
  { 'teams.players.toonHandle': 1, gameMode: 1 },
  { name: 'idx_toonHandle_gameMode' },
);

// ---------------------------------------------------------------------------
// ProcessedFile schema
// ---------------------------------------------------------------------------

/**
 * Tracks which .StormReplay filenames have been processed.
 * Replaces the SQLite processed_files table.
 *
 * status:  'ok'          — parsed and stored successfully as a Match
 *          'parse_error' — hots-parser returned an error; see error field
 *          'duplicate'   — fingerprint already existed; skipped
 * error:   Human-readable error message for parse_error status.
 */
const ProcessedFileSchema = new Schema(
  {
    filename: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['ok', 'parse_error', 'duplicate'],
      default: 'ok',
    },
    error: {
      type: String,
      default: null,
    },
  },
  { collection: 'processed_files' },
);

// ---------------------------------------------------------------------------
// Model exports
// ---------------------------------------------------------------------------

// Guard against re-registration when running under --watch (hot reload).
const Match = mongoose.models.Match || mongoose.model('Match', MatchSchema);
const ProcessedFile = mongoose.models.ProcessedFile
  || mongoose.model('ProcessedFile', ProcessedFileSchema);

module.exports = {
  Match,
  ProcessedFile,
  MatchSchema,
  TeamSchema,
  PlayerSchema,
  TalentSchema,
  EventSchema,
  ProcessedFileSchema,
};
