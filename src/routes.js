const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('./database');
const config = require('./config');
const { getHeroImageUrl } = require('./heroNames');
const { getMapImageUrl } = require('./mapImages');
const { parseReplay } = require('./parser');
const { verifyExtensionJWT } = require('./twitch');

const router = express.Router();

let broadcast = () => {};
function init(broadcastFn) { broadcast = broadcastFn; }

// --- Extension JWT middleware (optional — verifies Twitch viewer identity if header present) ---
function optionalExtJwt(req, res, next) {
  const token = req.headers['x-extension-jwt'];
  if (token && config.twitch && config.twitch.extensionSecret) {
    try {
      req.twitchAuth = verifyExtensionJWT(token);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid extension JWT' });
    }
  }
  next();
}

// --- Auth middleware (upload routes only) ---
function checkAuth(req, res, next) {
  if (!config.authToken) return next();
  const header = req.headers.authorization || '';
  const expected = `Bearer ${config.authToken}`;
  if (header.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected)))
    return next();
  res.status(401).json({ error: 'Unauthorized' });
}

const upload = multer({
  dest: config.replayDir,
  fileFilter: (_req, file, cb) => {
    cb(null, file.originalname.endsWith('.StormReplay'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

function resolveMode(query) {
  const mode = query.mode;
  if (!mode) return config.gameMode;
  if (mode.toLowerCase() === 'all') return db.ALL_MODES;
  const match = db.getAvailableModes().find(m => m.toLowerCase() === mode.toLowerCase());
  return match || mode;
}

// Returns an array of toon_handles, or null.
// Supports: ?player=name, ?player=toon1,toon2, ?player=all
function resolvePlayer(query) {
  const player = query.player;
  if (!player) return config.toonHandle ? [config.toonHandle] : null;
  if (player.toLowerCase() === 'all') return null; // null = all players (no filter)
  const parts = player.split(',').map(p => p.trim()).filter(Boolean);
  const resolved = [];
  for (const p of parts) {
    const toon = db.resolveToonHandle(p);
    resolved.push(toon || p);
  }
  return resolved;
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
  const players = resolvePlayer(req.query);
  const mode = resolveMode(req.query);
  const games = db.getTodayGames(players, mode);
  const stats = db.computeStats(games);
  res.json({ games: games.map(formatGame), stats, mode, player: players });
});

router.get('/session/:date', (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  }
  const players = resolvePlayer(req.query);
  const mode = resolveMode(req.query);
  const rawGames = db.getSessionGames(players, req.params.date, mode);
  const stats = db.computeStats(rawGames);
  res.json({ date: req.params.date, games: rawGames.map(formatGame), stats, mode, player: players });
});

router.get('/sessions', (req, res) => {
  const players = resolvePlayer(req.query);
  const mode = resolveMode(req.query);
  const parsed = parseInt(req.query.limit, 10);
  const limit = Math.min(Number.isNaN(parsed) ? 10 : parsed, 50);
  const sessions = db.getRecentSessions(players, limit, mode).map(session => ({
    ...session,
    games: session.games.map(formatGame),
  }));
  res.json({ sessions, mode, player: players });
});

router.get('/recent', (req, res) => {
  const players = resolvePlayer(req.query);
  const mode = resolveMode(req.query);
  const parsedLimit = parseInt(req.query.limit, 10);
  const limit = Math.min(Number.isNaN(parsedLimit) ? 10 : parsedLimit, 10);
  const games = db.getLastNGames(players, limit, mode);
  const stats = db.computeStats(games);
  res.json({ games: games.map(formatGame), stats, mode, player: players });
});

// Returns recent games grouped with all 10 heroes (both teams) per game.
// Used by the Twitch Extension video overlay sidebar.
// Requires a single player to determine "my team" vs "their team".
router.get('/recent-full', optionalExtJwt, (req, res) => {
  const players = resolvePlayer(req.query);
  if (!players || players.length !== 1) {
    return res.status(400).json({ error: 'Exactly one player required. Use ?player= or set TOON_HANDLE.' });
  }
  const toonHandle = players[0];
  const mode = resolveMode(req.query);
  const parsedLimit = parseInt(req.query.limit, 10);
  const limit = Math.min(Number.isNaN(parsedLimit) ? 10 : parsedLimit, 10);

  const rawGames = db.getRecentGroupedGames(toonHandle, mode, limit);

  const games = rawGames.map(g => {
    const myTeam = g.players
      .filter(p => p.win === g.myWin)
      .map(p => ({
        toonHandle: p.toonHandle,
        playerName: p.playerName,
        hero: p.hero,
        heroShort: p.heroShort,
        heroImage: getHeroImageUrl(p.hero),
        isMe: p.isMe,
      }));
    const theirTeam = g.players
      .filter(p => p.win !== g.myWin)
      .map(p => ({
        toonHandle: p.toonHandle,
        playerName: p.playerName,
        hero: p.hero,
        heroShort: p.heroShort,
        heroImage: getHeroImageUrl(p.hero),
        isMe: false,
      }));
    return {
      gameDate: g.gameDate,
      map: g.map,
      mapImage: getMapImageUrl(g.map),
      gameMode: g.gameMode,
      duration: g.duration,
      result: g.myWin ? 'win' : 'defeat',
      myTeam,
      theirTeam,
    };
  });

  const statsGames = rawGames.map(g => ({ win: Boolean(g.myWin) }));
  const stats = db.computeStats(statsGames);
  res.json({ games, stats, mode, player: toonHandle });
});

const BUILD_ID = new Date().toISOString();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', build: BUILD_ID });
});

router.get('/modes', (_req, res) => {
  res.json({ modes: db.getAvailableModes(), default: config.gameMode, labels: config.modeLabels });
});

router.get('/players', (_req, res) => {
  res.json({ players: db.getAvailablePlayers(), default: config.toonHandle });
});

// Validate filename to prevent path traversal
function isValidFilename(filename) {
  return /^[a-zA-Z0-9 ._\-()]+\.StormReplay$/.test(filename) && !filename.includes('..');
}

function cleanupTempFile(filePath, dest) {
  if (filePath !== dest) {
    try { fs.unlinkSync(filePath); } catch {}
  }
}

function processReplayFile(filename, filePath, res) {
  const dest = path.join(config.replayDir, filename);

  if (db.replayExists(filename)) {
    console.log(`[upload] ${filename}: duplicate`);
    cleanupTempFile(filePath, dest);
    return res.status(409).json({ status: 'duplicate', filename });
  }

  try {
    if (filePath !== dest) {
      fs.renameSync(filePath, dest);
    }
  } catch (err) {
    console.error(`[upload] ${filename}: rename failed: ${err.message}`);
    cleanupTempFile(filePath, dest);
    return res.status(500).json({ status: 'error', filename, error: `Rename failed: ${err.message}` });
  }

  let destSize;
  try {
    destSize = fs.statSync(dest).size;
  } catch (err) {
    console.error(`[upload] ${filename}: stat failed: ${err.message}`);
    return res.status(500).json({ status: 'error', filename, error: `Stat failed: ${err.message}` });
  }

  const parseResult = parseReplay(dest);

  if (parseResult.error) {
    console.warn(`[upload] ${filename}: parse failed — ${parseResult.error}`);
    db.markFileProcessed(filename);
    return res.json({ status: 'ok', filename, parsed: false, destSize, parseError: parseResult.error });
  }

  // Check for duplicate game by fingerprint (same game uploaded from different file)
  if (parseResult.gameFingerprint && db.gameExists(parseResult.gameFingerprint)) {
    console.log(`[upload] ${filename}: duplicate game (fingerprint match)`);
    db.markFileProcessed(filename);
    try { fs.unlinkSync(dest); } catch {}
    return res.status(409).json({ status: 'duplicate', filename, reason: 'game_fingerprint' });
  }

  const parsedPlayers = parseResult.players;
  let insertedCount = 0;
  for (const playerData of parsedPlayers) {
    try {
      const result = db.insertReplay(playerData);
      insertedCount += result.changes;
    } catch (err) {
      console.error(`[upload] insert failed for ${playerData.toonHandle}: ${err.message}`);
    }
  }

  db.markFileProcessed(filename);
  if (parseResult.gameFingerprint) {
    db.storeGameFingerprint(parseResult.gameFingerprint, filename);
  }

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

  console.log(`[upload] ${filename}: parsed, ${insertedCount} players inserted`);
  res.json({ status: 'ok', filename, parsed: true, players: insertedCount });
}

// Multipart upload (for curl / browser forms)
router.post('/upload', checkAuth, upload.single('replay'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No .StormReplay file provided.' });
  }
  if (!isValidFilename(req.file.originalname)) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'Invalid filename.' });
  }
  processReplayFile(req.file.originalname, req.file.path, res);
});

// Raw binary upload (for the Rust client)
const rawUploadParser = express.raw({ type: '*/*', limit: '10mb' });
router.post('/upload-raw', checkAuth, rawUploadParser, (req, res) => {
  const rawFilename = req.headers['x-filename'];
  const filename = rawFilename ? decodeURIComponent(rawFilename) : null;
  if (!filename || !isValidFilename(filename)) {
    return res.status(400).json({ error: 'Missing or invalid X-Filename header.' });
  }

  const rawBody = req.body;
  if (!rawBody || !rawBody.length) {
    return res.status(400).json({ error: 'Empty request body.' });
  }

  // Decode base64 if the client sent encoded data
  let body;
  if (req.headers['x-content-encoding'] === 'base64') {
    body = Buffer.from(rawBody.toString('utf-8'), 'base64');
  } else {
    body = rawBody;
  }

  // Verify integrity if client sent a hash
  const clientHash = req.headers['x-content-sha256'];
  if (clientHash) {
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    if (clientHash !== bodyHash) {
      console.error(`[upload-raw] ${filename}: hash mismatch — client=${clientHash}, server=${bodyHash}`);
      return res.status(422).json({
        error: 'Hash mismatch — data corrupted in transit',
        clientHash,
        serverHash: bodyHash,
      });
    }
  }

  // Write to temp file
  const tempPath = path.join(config.replayDir, `_upload_${crypto.randomBytes(8).toString('hex')}`);
  try {
    fs.writeFileSync(tempPath, body);
  } catch (err) {
    console.error(`[upload-raw] ${filename}: write failed: ${err.message}`);
    return res.status(500).json({ error: `File write failed: ${err.message}` });
  }

  processReplayFile(filename, tempPath, res);
});

module.exports = router;
module.exports.init = init;
