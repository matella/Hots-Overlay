'use strict';

/**
 * Migration script: SQLite replays → MongoDB matches
 *
 * Reads rows from the SQLite `replays` table, groups them by game
 * (using fingerprints from `game_fingerprints`), reconstructs Match
 * documents, and inserts them into MongoDB.
 *
 * Only processes NEW data:
 *   - Skips games whose fingerprint is already fully present in MongoDB.
 *   - Completes games whose fingerprint exists in MongoDB but whose player
 *     data is incomplete (player count in Mongo < player count in SQLite).
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-mongo.js
 *   npm run migrate
 *
 * Environment variables (same as main app):
 *   DB_PATH      – path to overlay.db  (default: ./data/overlay.db)
 *   MONGODB_URI  – MongoDB connection   (default: mongodb://localhost:27017/hots-overlay)
 */

require('dotenv').config({ quiet: true });

const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const mongoose = require('mongoose');
const { Match } = require('../src/db/match.model');

const DB_PATH = path.resolve(process.env.DB_PATH || './data/overlay.db');
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hots-overlay';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeFingerprint(rows) {
  const first = rows[0];
  const sortedToons = rows.map(r => r.toon_handle).filter(Boolean).sort().join(',');
  const source = `${first.game_date}|${first.map}|${first.duration}|${sortedToons}`;
  return crypto.createHash('sha256').update(source).digest('hex');
}

function buildMatchDoc(fingerprint, filename, rows) {
  const first = rows[0];

  const winners = rows.filter(r => r.win === 1);
  const losers = rows.filter(r => r.win === 0);

  const toPlayer = r => ({
    toonHandle: r.toon_handle || '',
    playerName: r.player_name || '',
    hero: r.hero,
    heroShort: r.hero_short,
    talents: [],
  });

  return {
    fingerprint,
    filename,
    gameDate: new Date(first.game_date),
    map: first.map,
    gameMode: first.game_mode,
    duration: first.duration,
    teams: [
      { teamIndex: 0, win: true,  bans: [], players: winners.map(toPlayer) },
      { teamIndex: 1, win: false, bans: [], players: losers.map(toPlayer) },
    ],
    events: [],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --- Open SQLite -----------------------------------------------------------
  let sqliteDb;
  try {
    sqliteDb = new Database(DB_PATH, { readonly: true });
  } catch (err) {
    console.error(`[migrate] Failed to open SQLite at ${DB_PATH}: ${err.message}`);
    process.exit(1);
  }

  // --- Connect to MongoDB ----------------------------------------------------
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`[migrate] Connected to MongoDB: ${MONGO_URI}`);
  } catch (err) {
    console.error(`[migrate] Failed to connect to MongoDB: ${err.message}`);
    sqliteDb.close();
    process.exit(1);
  }

  // --- Load data from SQLite -------------------------------------------------
  const fingerprintRows = sqliteDb.prepare('SELECT fingerprint, filename FROM game_fingerprints').all();
  const fingerprintByFilename = new Map(fingerprintRows.map(r => [r.filename, r.fingerprint]));

  const replayRows = sqliteDb.prepare('SELECT * FROM replays').all();
  sqliteDb.close();

  console.log(`[migrate] Loaded ${replayRows.length} player rows from SQLite.`);

  // --- Group rows by filename (one game = one file) --------------------------
  const rowsByFilename = new Map();
  for (const row of replayRows) {
    if (!rowsByFilename.has(row.filename)) rowsByFilename.set(row.filename, []);
    rowsByFilename.get(row.filename).push(row);
  }

  // --- Deduplicate by fingerprint --------------------------------------------
  // Multiple replay files can represent the same game; keep only one.
  const gamesByFingerprint = new Map();
  let duplicatesSkipped = 0;

  for (const [filename, rows] of rowsByFilename) {
    const fingerprint = fingerprintByFilename.get(filename) || computeFingerprint(rows);
    if (gamesByFingerprint.has(fingerprint)) {
      duplicatesSkipped++;
      continue;
    }
    gamesByFingerprint.set(fingerprint, { fingerprint, filename, rows });
  }

  console.log(`[migrate] ${gamesByFingerprint.size} unique games to process (${duplicatesSkipped} duplicate files skipped).`);

  // --- Pre-fetch existing fingerprints from MongoDB --------------------------
  // Only load the fingerprint field — lightweight even for large collections.
  const existingFingerprints = new Set(
    (await Match.find({}, { fingerprint: 1, _id: 0 }).lean()).map(d => d.fingerprint),
  );
  console.log(`[migrate] ${existingFingerprints.size} games already in MongoDB.`);

  // --- Separate new vs. already-known games ----------------------------------
  const newGames = [];
  const existingGames = [];

  for (const game of gamesByFingerprint.values()) {
    if (!existingFingerprints.has(game.fingerprint)) {
      newGames.push(game);
    } else {
      existingGames.push(game);
    }
  }

  console.log(`[migrate] ${newGames.length} new games to insert, ${existingGames.length} already present.`);

  // --- Phase 1: Insert new games ---------------------------------------------
  let migrated = 0;
  let errors = 0;

  for (const { fingerprint, filename, rows } of newGames) {
    const matchDoc = buildMatchDoc(fingerprint, filename, rows);
    try {
      await Match.create(matchDoc);
      migrated++;
    } catch (err) {
      console.error(`[migrate] Error inserting ${filename}: ${err.message}`);
      errors++;
    }
  }

  // --- Phase 2: Complete incomplete existing records -------------------------
  // An existing record is "incomplete" if its total player count in MongoDB is
  // less than the number of rows we have for that game in SQLite.
  let completed = 0;
  let skipped = 0;

  if (existingGames.length > 0) {
    const existingFps = existingGames.map(g => g.fingerprint);
    const existingDocs = await Match.find(
      { fingerprint: { $in: existingFps } },
      { fingerprint: 1, teams: 1, _id: 0 },
    ).lean();

    const playerCountByFingerprint = new Map(
      existingDocs.map(doc => {
        const count = (doc.teams || []).reduce(
          (sum, t) => sum + (t.players ? t.players.length : 0),
          0,
        );
        return [doc.fingerprint, count];
      }),
    );

    for (const { fingerprint, filename, rows } of existingGames) {
      const existingPlayerCount = playerCountByFingerprint.get(fingerprint) ?? 0;
      if (existingPlayerCount < rows.length) {
        // Incomplete — update with full player data from SQLite
        const matchDoc = buildMatchDoc(fingerprint, filename, rows);
        try {
          await Match.updateOne({ fingerprint }, { $set: { teams: matchDoc.teams } });
          completed++;
        } catch (err) {
          console.error(`[migrate] Error completing ${filename}: ${err.message}`);
          errors++;
        }
      } else {
        skipped++;
      }
    }
  }

  // --- Report ----------------------------------------------------------------
  console.log('\n=== Migration complete ===');
  console.log(`  Migrated  : ${migrated}  (new records inserted)`);
  console.log(`  Completed : ${completed}  (existing records with missing players updated)`);
  console.log(`  Skipped   : ${skipped}  (already complete in MongoDB)`);
  console.log(`  Errors    : ${errors}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[migrate] Unexpected error:', err);
  process.exit(1);
});
