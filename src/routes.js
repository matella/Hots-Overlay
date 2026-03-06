const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('./database');
const config = require('./config');
const { getHeroImageUrl } = require('./heroNames');
const { parseReplay } = require('./parser');

const router = express.Router();

let broadcast = () => {};
function init(broadcastFn) { broadcast = broadcastFn; }

const upload = multer({
  dest: config.replayDir,
  fileFilter: (_req, file, cb) => {
    cb(null, file.originalname.endsWith('.StormReplay'));
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
});

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

function checkAuth(req, res, next) {
  if (!config.authToken) return next();
  const header = req.headers.authorization;
  if (header === `Bearer ${config.authToken}`) return next();
  res.status(401).json({ error: 'Invalid or missing auth token.' });
}

router.post('/upload', checkAuth, upload.single('replay'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No .StormReplay file provided.' });
  }

  const filename = req.file.originalname;
  const dest = path.join(config.replayDir, filename);
  fs.renameSync(req.file.path, dest);

  // Parse immediately instead of relying on the file watcher
  const parsed = parseReplay(dest);
  if (!parsed) {
    db.markFileProcessed(filename);
    return res.json({ status: 'ok', filename, parsed: false });
  }

  db.insertReplay(parsed);
  db.markFileProcessed(filename);

  broadcast({
    type: 'new_game',
    game: {
      gameDate: parsed.gameDate,
      map: parsed.map,
      gameMode: parsed.gameMode,
      hero: parsed.hero,
      heroShort: parsed.heroShort,
      heroImage: getHeroImageUrl(parsed.hero),
      win: Boolean(parsed.win),
      duration: parsed.duration,
    },
  });

  res.json({ status: 'ok', filename, parsed: true });
});

module.exports = router;
module.exports.init = init;
