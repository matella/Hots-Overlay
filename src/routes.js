const express = require('express');
const db = require('./database');
const config = require('./config');
const { getHeroImageUrl } = require('./heroNames');

const router = express.Router();

function resolveMode(query) {
  const mode = query.mode;
  if (!mode) return config.gameMode;
  if (mode.toLowerCase() === 'all') return db.ALL_MODES;
  const match = db.getAvailableModes().find(m => m.toLowerCase() === mode.toLowerCase());
  return match || mode;
}

function formatGame(row) {
  return {
    id: row.id,
    gameDate: row.game_date,
    map: row.map,
    gameMode: row.game_mode,
    hero: row.hero,
    heroShort: row.hero_short,
    heroImage: getHeroImageUrl(row.hero),
    win: Boolean(row.win),
    duration: row.duration,
  };
}

router.get('/today', (req, res) => {
  const mode = resolveMode(req.query);
  const games = db.getTodayGames(mode);
  const stats = db.computeStats(games);
  res.json({ games: games.map(formatGame), stats, mode });
});

router.get('/session/:date', (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  }
  const mode = resolveMode(req.query);
  const rawGames = db.getSessionGames(req.params.date, mode);
  const stats = db.computeStats(rawGames);
  res.json({ date: req.params.date, games: rawGames.map(formatGame), stats, mode });
});

router.get('/sessions', (req, res) => {
  const mode = resolveMode(req.query);
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  const sessions = db.getRecentSessions(limit, mode).map(session => ({
    ...session,
    games: session.games.map(formatGame),
  }));
  res.json({ sessions, mode });
});

router.get('/modes', (_req, res) => {
  res.json({ modes: db.getAvailableModes(), default: config.gameMode, labels: config.modeLabels });
});

module.exports = router;
