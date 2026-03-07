const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const REPLAY_COLUMNS = 'id, filename, toon_handle, game_date, map, game_mode, hero, hero_short, win, duration, player_name, created_at';
const ALL_MODES = 'all';

let db;
let stmts;

function computeStats(games) {
  const wins = games.filter(g => g.win).length;
  const losses = games.length - wins;
  return {
    wins,
    losses,
    winRate: games.length > 0 ? (wins / games.length) * 100 : 0,
  };
}

function initDatabase() {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS replays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      game_date TEXT NOT NULL,
      map TEXT NOT NULL,
      game_mode TEXT NOT NULL,
      hero TEXT NOT NULL,
      hero_short TEXT NOT NULL,
      win INTEGER NOT NULL CHECK(win IN (0, 1)),
      duration INTEGER,
      player_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_replays_game_date ON replays(game_date);
    CREATE INDEX IF NOT EXISTS idx_replays_game_mode ON replays(game_mode);
    CREATE TABLE IF NOT EXISTS processed_files (
      filename TEXT PRIMARY KEY NOT NULL
    );
  `);

  // Migration: add toon_handle column (changes UNIQUE constraint to compound key)
  const hasColumn = db.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('replays') WHERE name = 'toon_handle'"
  ).get().cnt > 0;

  if (!hasColumn) {
    console.log('Migrating database: adding toon_handle column...');
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE replays_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          toon_handle TEXT NOT NULL,
          game_date TEXT NOT NULL,
          map TEXT NOT NULL,
          game_mode TEXT NOT NULL,
          hero TEXT NOT NULL,
          hero_short TEXT NOT NULL,
          win INTEGER NOT NULL CHECK(win IN (0, 1)),
          duration INTEGER,
          player_name TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(filename, toon_handle)
        );
      `);

      db.prepare(`
        INSERT INTO replays_new
          (id, filename, toon_handle, game_date, map, game_mode, hero, hero_short, win, duration, player_name, created_at)
        SELECT
          id, filename, ?, game_date, map, game_mode, hero, hero_short, win, duration, player_name, created_at
        FROM replays
      `).run(config.toonHandle);

      db.exec(`
        DROP TABLE replays;
        ALTER TABLE replays_new RENAME TO replays;
        CREATE INDEX idx_replays_game_date ON replays(game_date);
        CREATE INDEX idx_replays_game_mode ON replays(game_mode);
        CREATE INDEX idx_replays_toon_handle ON replays(toon_handle);
        CREATE INDEX idx_replays_player_name ON replays(player_name);
      `);

      // Clear processed files so replays get re-parsed for all players
      db.exec('DELETE FROM processed_files');
    });
    migrate();
    console.log('Migration complete. Replays will be re-parsed for all players.');
  }

  // Compound index for queries filtering by toon_handle + game_mode
  db.exec('CREATE INDEX IF NOT EXISTS idx_replays_toon_mode ON replays(toon_handle, game_mode)');

  stmts = {
    insert: db.prepare(`
      INSERT OR IGNORE INTO replays (filename, toon_handle, game_date, map, game_mode, hero, hero_short, win, duration, player_name)
      VALUES (@filename, @toonHandle, @gameDate, @map, @gameMode, @hero, @heroShort, @win, @duration, @playerName)
    `),
    getByFilename: db.prepare('SELECT filename FROM replays WHERE filename = ?'),
    allProcessed: db.prepare('SELECT filename FROM processed_files'),
    isProcessed: db.prepare('SELECT 1 FROM processed_files WHERE filename = ?'),
    markProcessed: db.prepare('INSERT OR IGNORE INTO processed_files (filename) VALUES (?)'),

    todayByMode: db.prepare(`
      SELECT ${REPLAY_COLUMNS} FROM replays
      WHERE toon_handle = ? AND date(game_date) = date('now', 'localtime') AND game_mode = ?
      ORDER BY game_date ASC
    `),
    todayAll: db.prepare(`
      SELECT ${REPLAY_COLUMNS} FROM replays
      WHERE toon_handle = ? AND date(game_date) = date('now', 'localtime')
      ORDER BY game_date ASC
    `),

    sessionByMode: db.prepare(`
      SELECT ${REPLAY_COLUMNS} FROM replays
      WHERE toon_handle = ? AND date(game_date) = ? AND game_mode = ?
      ORDER BY game_date ASC
    `),
    sessionAll: db.prepare(`
      SELECT ${REPLAY_COLUMNS} FROM replays
      WHERE toon_handle = ? AND date(game_date) = ?
      ORDER BY game_date ASC
    `),

    recentByMode: db.prepare(`
      SELECT ${REPLAY_COLUMNS}, date(game_date) AS session_date
      FROM replays
      WHERE toon_handle = ? AND game_mode = ?
        AND date(game_date) IN (
          SELECT DISTINCT date(game_date)
          FROM replays WHERE toon_handle = ? AND game_mode = ?
          ORDER BY date(game_date) DESC LIMIT ?
        )
      ORDER BY game_date ASC
    `),
    recentAll: db.prepare(`
      SELECT ${REPLAY_COLUMNS}, date(game_date) AS session_date
      FROM replays
      WHERE toon_handle = ?
        AND date(game_date) IN (
          SELECT DISTINCT date(game_date)
          FROM replays WHERE toon_handle = ?
          ORDER BY date(game_date) DESC LIMIT ?
        )
      ORDER BY game_date ASC
    `),

    lastNByMode: db.prepare(`
      SELECT ${REPLAY_COLUMNS} FROM replays
      WHERE toon_handle = ? AND game_mode = ?
      ORDER BY game_date DESC LIMIT ?
    `),
    lastNAll: db.prepare(`
      SELECT ${REPLAY_COLUMNS} FROM replays
      WHERE toon_handle = ?
      ORDER BY game_date DESC LIMIT ?
    `),

    availableModes: db.prepare(`
      SELECT DISTINCT game_mode FROM replays ORDER BY game_mode
    `),

    resolveToonHandle: db.prepare(`
      SELECT DISTINCT toon_handle FROM replays
      WHERE toon_handle = ? OR player_name = ? COLLATE NOCASE
      LIMIT 1
    `),

    availablePlayers: db.prepare(`
      SELECT DISTINCT toon_handle, player_name FROM replays ORDER BY player_name
    `),
  };

  return db;
}

function insertReplay(data) {
  return stmts.insert.run(data);
}

function runInTransaction(fn) {
  db.transaction(fn)();
}

function replayExists(filename) {
  return !!stmts.getByFilename.get(filename);
}

function getAllProcessedFilenames() {
  return new Set(stmts.allProcessed.all().map(r => r.filename));
}

function isFileProcessed(filename) {
  return !!stmts.isProcessed.get(filename);
}

function markFileProcessed(filename) {
  stmts.markProcessed.run(filename);
}

function getTodayGames(toonHandle, mode) {
  return mode === ALL_MODES
    ? stmts.todayAll.all(toonHandle)
    : stmts.todayByMode.all(toonHandle, mode);
}

function getSessionGames(toonHandle, date, mode) {
  return mode === ALL_MODES
    ? stmts.sessionAll.all(toonHandle, date)
    : stmts.sessionByMode.all(toonHandle, date, mode);
}

function getRecentSessions(toonHandle, limit, mode) {
  const rows = mode === ALL_MODES
    ? stmts.recentAll.all(toonHandle, toonHandle, limit)
    : stmts.recentByMode.all(toonHandle, mode, toonHandle, mode, limit);

  const sessionMap = new Map();
  for (const row of rows) {
    if (!sessionMap.has(row.session_date)) sessionMap.set(row.session_date, []);
    sessionMap.get(row.session_date).push(row);
  }

  return [...sessionMap.entries()].map(([date, games]) => ({
    date,
    ...computeStats(games),
    games,
  }));
}

function getLastNGames(toonHandle, limit, mode) {
  const rows = mode === ALL_MODES
    ? stmts.lastNAll.all(toonHandle, limit)
    : stmts.lastNByMode.all(toonHandle, mode, limit);
  return rows.reverse(); // oldest-first for frontend rendering
}

function getAvailableModes() {
  return stmts.availableModes.all().map(r => r.game_mode);
}

function resolveToonHandle(playerQuery) {
  if (!playerQuery) return null;
  const row = stmts.resolveToonHandle.get(playerQuery, playerQuery);
  return row ? row.toon_handle : null;
}

function getAvailablePlayers() {
  return stmts.availablePlayers.all();
}

module.exports = {
  ALL_MODES,
  initDatabase,
  computeStats,
  insertReplay,
  runInTransaction,
  replayExists,
  getAllProcessedFilenames,
  isFileProcessed,
  markFileProcessed,
  getTodayGames,
  getSessionGames,
  getRecentSessions,
  getLastNGames,
  getAvailableModes,
  resolveToonHandle,
  getAvailablePlayers,
};
