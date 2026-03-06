const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const REPLAY_COLUMNS = 'id, filename, game_date, map, game_mode, hero, hero_short, win, duration, player_name, created_at';
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

  stmts = {
    insert: db.prepare(`
      INSERT OR IGNORE INTO replays (filename, game_date, map, game_mode, hero, hero_short, win, duration, player_name)
      VALUES (@filename, @gameDate, @map, @gameMode, @hero, @heroShort, @win, @duration, @playerName)
    `),
    allProcessed: db.prepare('SELECT filename FROM processed_files'),
    markProcessed: db.prepare('INSERT OR IGNORE INTO processed_files (filename) VALUES (?)'),

    todayByMode: db.prepare(`
      SELECT ${REPLAY_COLUMNS} FROM replays
      WHERE date(game_date) = date('now', 'localtime') AND game_mode = ?
      ORDER BY game_date ASC
    `),
    todayAll: db.prepare(`
      SELECT ${REPLAY_COLUMNS} FROM replays
      WHERE date(game_date) = date('now', 'localtime')
      ORDER BY game_date ASC
    `),

    sessionByMode: db.prepare(`
      SELECT ${REPLAY_COLUMNS} FROM replays
      WHERE date(game_date) = ? AND game_mode = ?
      ORDER BY game_date ASC
    `),
    sessionAll: db.prepare(`
      SELECT ${REPLAY_COLUMNS} FROM replays
      WHERE date(game_date) = ?
      ORDER BY game_date ASC
    `),

    recentByMode: db.prepare(`
      SELECT ${REPLAY_COLUMNS}, date(game_date) AS session_date
      FROM replays
      WHERE game_mode = ?
        AND date(game_date) IN (
          SELECT DISTINCT date(game_date)
          FROM replays WHERE game_mode = ?
          ORDER BY date(game_date) DESC LIMIT ?
        )
      ORDER BY game_date ASC
    `),
    recentAll: db.prepare(`
      SELECT ${REPLAY_COLUMNS}, date(game_date) AS session_date
      FROM replays
      WHERE date(game_date) IN (
        SELECT DISTINCT date(game_date)
        FROM replays
        ORDER BY date(game_date) DESC LIMIT ?
      )
      ORDER BY game_date ASC
    `),

    availableModes: db.prepare(`
      SELECT DISTINCT game_mode FROM replays ORDER BY game_mode
    `),
  };

  return db;
}

function insertReplay(data) {
  return stmts.insert.run(data);
}

function getAllProcessedFilenames() {
  return new Set(stmts.allProcessed.all().map(r => r.filename));
}

function markFileProcessed(filename) {
  stmts.markProcessed.run(filename);
}

function getTodayGames(mode) {
  return mode === ALL_MODES
    ? stmts.todayAll.all()
    : stmts.todayByMode.all(mode);
}

function getSessionGames(date, mode) {
  return mode === ALL_MODES
    ? stmts.sessionAll.all(date)
    : stmts.sessionByMode.all(date, mode);
}

function getRecentSessions(limit, mode) {
  const rows = mode === ALL_MODES
    ? stmts.recentAll.all(limit)
    : stmts.recentByMode.all(mode, mode, limit);

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

function getAvailableModes() {
  return stmts.availableModes.all().map(r => r.game_mode);
}

module.exports = {
  ALL_MODES,
  initDatabase,
  computeStats,
  insertReplay,
  getAllProcessedFilenames,
  markFileProcessed,
  getTodayGames,
  getSessionGames,
  getRecentSessions,
  getAvailableModes,
};
