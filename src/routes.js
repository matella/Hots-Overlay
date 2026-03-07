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

function resolvePlayer(query) {
  const player = query.player;
  if (!player) return config.toonHandle;
  const resolved = db.resolveToonHandle(player);
  return resolved || player;
}

function formatGame(row) {
  return {
    id: row.id,
    toonHandle: row.toon_handle,
    playerName: row.player_name,
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
  const player = resolvePlayer(req.query);
  const mode = resolveMode(req.query);
  const games = db.getTodayGames(player, mode);
  const stats = db.computeStats(games);
  res.json({ games: games.map(formatGame), stats, mode, player });
});

router.get('/session/:date', (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  }
  const player = resolvePlayer(req.query);
  const mode = resolveMode(req.query);
  const rawGames = db.getSessionGames(player, req.params.date, mode);
  const stats = db.computeStats(rawGames);
  res.json({ date: req.params.date, games: rawGames.map(formatGame), stats, mode, player });
});

router.get('/sessions', (req, res) => {
  const player = resolvePlayer(req.query);
  const mode = resolveMode(req.query);
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  const sessions = db.getRecentSessions(player, limit, mode).map(session => ({
    ...session,
    games: session.games.map(formatGame),
  }));
  res.json({ sessions, mode, player });
});

router.get('/recent', (req, res) => {
  const player = resolvePlayer(req.query);
  const mode = resolveMode(req.query);
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 10);
  const games = db.getLastNGames(player, limit, mode);
  const stats = db.computeStats(games);
  res.json({ games: games.map(formatGame), stats, mode, player });
});

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/modes', (_req, res) => {
  res.json({ modes: db.getAvailableModes(), default: config.gameMode, labels: config.modeLabels });
});

router.get('/players', (_req, res) => {
  res.json({ players: db.getAvailablePlayers(), default: config.toonHandle });
});

function checkAuth(req, res, next) {
  if (!config.authToken) return next();
  const header = req.headers.authorization;
  if (header === `Bearer ${config.authToken}`) return next();
  res.status(401).json({ error: 'Invalid or missing auth token.' });
}

function processReplayFile(filename, filePath, res) {
  if (db.replayExists(filename)) {
    return res.status(409).json({ status: 'duplicate', filename });
  }

  const dest = path.join(config.replayDir, filename);
  if (filePath !== dest) fs.renameSync(filePath, dest);

  const parsedPlayers = parseReplay(dest);
  if (!parsedPlayers) {
    const size = fs.statSync(dest).size;
    console.warn(`[upload] Parse failed for ${filename} (${size} bytes)`);
    db.markFileProcessed(filename);
    return res.json({ status: 'ok', filename, parsed: false });
  }

  for (const playerData of parsedPlayers) {
    db.insertReplay(playerData);
  }
  db.markFileProcessed(filename);

  for (const p of parsedPlayers) {
    broadcast({
      type: 'new_game',
      game: {
        toonHandle: p.toonHandle,
        playerName: p.playerName,
        gameDate: p.gameDate,
        map: p.map,
        gameMode: p.gameMode,
        hero: p.hero,
        heroShort: p.heroShort,
        heroImage: getHeroImageUrl(p.hero),
        win: Boolean(p.win),
        duration: p.duration,
      },
    });
  }

  res.json({ status: 'ok', filename, parsed: true });
}

// Multipart upload (for curl / browser forms)
router.post('/upload', checkAuth, upload.single('replay'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No .StormReplay file provided.' });
  }
  processReplayFile(req.file.originalname, req.file.path, res);
});

// Debug: test body reception without parsing
const rawBodyDebug = express.raw({ type: 'application/octet-stream', limit: '10mb' });
router.post('/upload-debug', rawBodyDebug, (req, res) => {
  const len = req.body ? req.body.length : 0;
  const first4 = req.body ? req.body.slice(0, 4).toString('hex') : 'none';
  res.json({ receivedBytes: len, first4hex: first4, contentType: req.headers['content-type'] });
});

// Raw binary upload (for the Rust client — avoids multipart/busboy issues with proxies)
// Collect raw body from stream to avoid express.raw() middleware issues with proxies
router.post('/upload-raw', checkAuth, (req, res) => {
  const filename = req.headers['x-filename'];
  if (!filename || !filename.endsWith('.StormReplay')) {
    return res.status(400).json({ error: 'Missing or invalid X-Filename header.' });
  }

  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (!body.length) {
      return res.status(400).json({ error: 'Empty request body.' });
    }

    console.log(`[upload-raw] ${filename}: received ${body.length} bytes, content-type=${req.headers['content-type']}`);

    const tempPath = path.join(config.replayDir, `_upload_${Date.now()}`);
    fs.writeFileSync(tempPath, body);
    processReplayFile(filename, tempPath, res);
  });
  req.on('error', err => {
    console.error(`[upload-raw] Stream error for ${filename}:`, err.message);
    res.status(500).json({ error: 'Upload stream error.' });
  });
});

module.exports = router;
module.exports.init = init;
