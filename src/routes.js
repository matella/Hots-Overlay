const express = require('express');
const crypto = require('crypto');
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

const BUILD_ID = new Date().toISOString();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', build: BUILD_ID });
});

// Diagnostic: last N upload results (kept in memory)
const uploadLog = [];
const MAX_UPLOAD_LOG = 50;
function logUploadResult(entry) {
  uploadLog.push({ ...entry, time: new Date().toISOString() });
  if (uploadLog.length > MAX_UPLOAD_LOG) uploadLog.shift();
}
router.get('/upload-log', (_req, res) => {
  res.json(uploadLog);
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
  console.log(`[upload] === Processing ${filename} ===`);
  console.log(`[upload] Step 1: checking if replay exists in DB...`);

  if (db.replayExists(filename)) {
    console.log(`[upload] ${filename}: duplicate, already in replays table`);
    logUploadResult({ filename, duplicate: true });
    return res.status(409).json({ status: 'duplicate', filename });
  }
  console.log(`[upload] ${filename}: not a duplicate, proceeding`);

  // Step 2: move temp file to final destination
  const dest = path.join(config.replayDir, filename);
  console.log(`[upload] Step 2: moving file to ${dest}`);
  console.log(`[upload]   source: ${filePath}`);
  console.log(`[upload]   source exists: ${fs.existsSync(filePath)}`);

  try {
    if (filePath !== dest) {
      const srcSize = fs.statSync(filePath).size;
      console.log(`[upload]   source size: ${srcSize} bytes`);
      fs.renameSync(filePath, dest);
      console.log(`[upload]   rename OK`);
    } else {
      console.log(`[upload]   source === dest, no rename needed`);
    }
  } catch (err) {
    console.error(`[upload] ${filename}: rename failed: ${err.message}`);
    return res.status(500).json({ status: 'error', filename, error: `Rename failed: ${err.message}` });
  }

  // Step 3: verify destination file
  let destSize;
  try {
    destSize = fs.statSync(dest).size;
    console.log(`[upload] Step 3: dest file verified, ${destSize} bytes`);
  } catch (err) {
    console.error(`[upload] ${filename}: dest file stat failed: ${err.message}`);
    return res.status(500).json({ status: 'error', filename, error: `Dest stat failed: ${err.message}` });
  }

  // Step 4: parse the replay
  console.log(`[upload] Step 4: parsing replay...`);
  const parseResult = parseReplay(dest);

  if (parseResult.error) {
    console.warn(`[upload] ${filename}: parse FAILED — ${parseResult.error}`);
    logUploadResult({ filename, parsed: false, destSize, parseError: parseResult.error });
    db.markFileProcessed(filename);
    return res.json({ status: 'ok', filename, parsed: false, destSize, parseError: parseResult.error });
  }

  const parsedPlayers = parseResult.players;
  console.log(`[upload] ${filename}: parse OK, ${parsedPlayers.length} players`);

  // Step 5: insert into database
  console.log(`[upload] Step 5: inserting ${parsedPlayers.length} player records...`);
  let insertedCount = 0;
  for (const playerData of parsedPlayers) {
    try {
      const result = db.insertReplay(playerData);
      console.log(`[upload]   inserted ${playerData.toonHandle} (${playerData.hero}) — changes=${result.changes}`);
      insertedCount += result.changes;
    } catch (err) {
      console.error(`[upload]   insert FAILED for ${playerData.toonHandle}: ${err.message}`);
    }
  }
  console.log(`[upload] ${filename}: ${insertedCount}/${parsedPlayers.length} rows inserted`);

  // Step 6: mark as processed
  db.markFileProcessed(filename);
  console.log(`[upload] Step 6: marked as processed`);

  // Step 7: broadcast to WebSocket clients
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
  console.log(`[upload] Step 7: broadcast sent`);
  console.log(`[upload] === Done ${filename} ===`);

  logUploadResult({ filename, parsed: true, players: insertedCount });
  res.json({ status: 'ok', filename, parsed: true, players: insertedCount });
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

// Diagnostic: compare file hash on disk with expected hash
router.get('/file-hash/:filename', checkAuth, (req, res) => {
  const filePath = path.join(config.replayDir, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  const data = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  const magic = data.slice(0, 16).toString('hex');
  res.json({ filename: req.params.filename, size: data.length, sha256: hash, first16hex: magic });
});

// Raw binary upload (for the Rust client — avoids multipart/busboy issues with proxies)
router.post('/upload-raw', checkAuth, (req, res) => {
  const filename = req.headers['x-filename'];
  if (!filename || !filename.endsWith('.StormReplay')) {
    return res.status(400).json({ error: 'Missing or invalid X-Filename header.' });
  }

  console.log(`[upload-raw] ${filename}: starting stream collection, content-length=${req.headers['content-length']}, content-type=${req.headers['content-type']}`);

  const chunks = [];
  req.on('data', chunk => {
    chunks.push(chunk);
  });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (!body.length) {
      console.warn(`[upload-raw] ${filename}: empty body received`);
      return res.status(400).json({ error: 'Empty request body.' });
    }

    const magic = body.slice(0, 4).toString('hex');
    console.log(`[upload-raw] ${filename}: received ${body.length} bytes, magic=${magic}, chunks=${chunks.length}`);

    // Write to temp file
    const tempPath = path.join(config.replayDir, `_upload_${Date.now()}`);
    try {
      fs.writeFileSync(tempPath, body);
      const writtenSize = fs.statSync(tempPath).size;
      console.log(`[upload-raw] ${filename}: wrote ${writtenSize} bytes to ${tempPath}`);
    } catch (err) {
      console.error(`[upload-raw] ${filename}: write failed: ${err.message}`);
      return res.status(500).json({ error: `File write failed: ${err.message}` });
    }

    processReplayFile(filename, tempPath, res);
  });
  req.on('error', err => {
    console.error(`[upload-raw] Stream error for ${filename}:`, err.message);
    res.status(500).json({ error: 'Upload stream error.' });
  });
});

module.exports = router;
module.exports.init = init;
