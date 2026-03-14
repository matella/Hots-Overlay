'use strict';

/**
 * Migration script: SQLite replays → MongoDB matches
 *
 * Reads all rows from the SQLite `replays` table, groups them by game
 * (using fingerprints from `game_fingerprints`), reconstructs Match
 * documents, and upserts them into MongoDB.
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

  // --- Upsert into MongoDB ---------------------------------------------------
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const { fingerprint, filename, rows } of gamesByFingerprint.values()) {
    const matchDoc = buildMatchDoc(fingerprint, filename, rows);
    try {
      const result = await Match.updateOne(
        { fingerprint },
        { $setOnInsert: matchDoc },
        { upsert: true },
      );
      if (result.upsertedCount > 0) {
        migrated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[migrate] Error upserting ${filename}: ${err.message}`);
      errors++;
    }
  }

  // --- Report ----------------------------------------------------------------
  console.log('\n=== Migration complete ===');
  console.log(`  Migrated : ${migrated}`);
  console.log(`  Skipped  : ${skipped}  (already in MongoDB)`);
  console.log(`  Errors   : ${errors}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('[migrate] Unexpected error:', err);
  process.exit(1);
});
