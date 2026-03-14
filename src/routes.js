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
const { Match } = require('./db/match.model');
const { loadHeroesForMatch, resolveTalent } = require('./talentIcons');

const router = express.Router();

let broadcast = () => {};
function init(broadcastFn) { broadcast = broadcastFn; }

// --- Extension JWT middleware (required — verifies Twitch viewer identity via Authorization header) ---
function requireExtJwt(req, res, next) {
  const header = req.headers['x-extension-jwt'] || req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header || null;
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });
  try {
    const decoded = verifyExtensionJWT(token);
    req.twitchAuth = { channel_id: decoded.channel_id, user_id: decoded.user_id, role: decoded.role };
  } catch (e) {
    return res.status(401).json({ error: 'Invalid extension JWT' });
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

function flattenMatchesToGames(matches, players) {
  const rows = [];
  for (const match of matches) {
    for (const team of match.teams) {
      for (const player of team.players) {
        if (players && !players.includes(player.toonHandle)) continue;
        rows.push({
          id: match._id,
          toonHandle: player.toonHandle,
          playerName: player.playerName,
          gameDate: match.gameDate,
          map: match.map,
          gameMode: match.gameMode,
          hero: player.hero,
          heroShort: player.heroShort,
          heroImage: getHeroImageUrl(player.hero),
          win: team.win,
          duration: match.duration,
        });
      }
    }
  }
  return rows;
}

router.get('/today', async (req, res) => {
  try {
    const players = resolvePlayer(req.query);
    const mode = resolveMode(req.query);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const query = { gameDate: { $gte: startOfDay, $lte: endOfDay } };
    if (mode !== db.ALL_MODES) query.gameMode = mode;
    if (players) query['teams.players.toonHandle'] = { $in: players };

    const matches = await Match.find(query).sort({ gameDate: -1 });
    const games = flattenMatchesToGames(matches, players);
    const stats = db.computeStats(games);
    res.json({ games, stats, mode, player: players });
  } catch (err) {
    console.error(`[today] error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/session/:date', async (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  }
  try {
    const players = resolvePlayer(req.query);
    const mode = resolveMode(req.query);

    const [year, month, day] = req.params.date.split('-').map(Number);
    const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);

    const query = { gameDate: { $gte: startOfDay, $lte: endOfDay } };
    if (mode !== db.ALL_MODES) query.gameMode = mode;
    if (players) query['teams.players.toonHandle'] = { $in: players };

    const matches = await Match.find(query).sort({ gameDate: -1 });
    const games = flattenMatchesToGames(matches, players);
    const stats = db.computeStats(games);
    res.json({ date: req.params.date, games, stats, mode, player: players });
  } catch (err) {
    console.error(`[session] error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sessions', (req, res) => {
  const players = resolvePlayer(req.query);
  const mode = resolveMode(req.query);
  const parsed = parseInt(req.query.limit, 10);
  const limit = Math.min(Number.isNaN(parsed) ? 10 : parsed, 50);
  const sessions = db.getRecentSessions(players, limit, mode).map(session => ({
    ...session,
    games: session.games.map(g => ({
      id: g.id,
      toonHandle: g.toon_handle,
      playerName: g.player_name,
      gameDate: g.game_date,
      map: g.map,
      gameMode: g.game_mode,
      hero: g.hero,
      heroShort: g.hero_short,
      heroImage: getHeroImageUrl(g.hero),
      win: Boolean(g.win),
      duration: g.duration,
    })),
  }));
  res.json({ sessions, mode, player: players });
});

router.get('/recent', async (req, res) => {
  try {
    const players = resolvePlayer(req.query);
    const mode = resolveMode(req.query);
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isNaN(parsedLimit) ? 10 : parsedLimit, 10);

    const query = {};
    if (mode !== db.ALL_MODES) query.gameMode = mode;
    if (players) query['teams.players.toonHandle'] = { $in: players };

    const matches = await Match.find(query).sort({ gameDate: -1 }).limit(limit);
    const games = flattenMatchesToGames(matches, players);
    const stats = db.computeStats(games);
    res.json({ games, stats, mode, player: players });
  } catch (err) {
    console.error(`[recent] error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Returns recent games grouped with all 10 heroes (both teams) per game.
// Used by the Twitch Extension video overlay sidebar.
// Requires a single player to determine "my team" vs "their team".
router.get('/recent-full', requireExtJwt, (req, res) => {
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

router.get('/matches', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 20), 100);
  const skip  = (page - 1) * limit;

  const filter = {};

  // Player filter — resolve name → toonHandle using existing db helper
  if (req.query.player && req.query.player.toLowerCase() !== 'all') {
    const toons = req.query.player.split(',')
      .map(p => { const t = db.resolveToonHandle(p.trim()); return t || p.trim(); })
      .filter(Boolean);
    if (toons.length) filter['teams.players.toonHandle'] = { $in: toons };
  }

  // Mode filter
  if (req.query.mode && req.query.mode.toLowerCase() !== 'all') {
    filter.gameMode = req.query.mode;
  }

  // Date range filter (ISO strings or YYYY-MM-DD)
  if (req.query.from || req.query.to) {
    filter.gameDate = {};
    if (req.query.from) filter.gameDate.$gte = new Date(req.query.from);
    if (req.query.to)   filter.gameDate.$lte = new Date(req.query.to);
  }

  try {
    const [total, docs] = await Promise.all([
      Match.countDocuments(filter),
      Match.find(filter).sort({ gameDate: -1 }).skip(skip).limit(limit).lean(),
    ]);

    const matches = docs.map(doc => ({
      id:          doc._id,
      fingerprint: doc.fingerprint,
      gameDate:    doc.gameDate,
      map:         doc.map,
      mapImage:    getMapImageUrl(doc.map),
      gameMode:    doc.gameMode,
      duration:    doc.duration,
      teams: (doc.teams || []).map(team => ({
        teamIndex: team.teamIndex,
        win:       team.win,
        bans:      team.bans || [],
        players:   (team.players || []).map(p => ({
          toonHandle: p.toonHandle,
          playerName: p.playerName,
          hero:       p.hero,
          heroShort:  p.heroShort,
          heroImage:  getHeroImageUrl(p.hero),
        })),
      })),
    }));

    res.json({ matches, total, page, pages: Math.ceil(total / limit), limit });
  } catch (err) {
    console.error('[matches] query failed:', err.message);
    res.status(500).json({ error: 'Failed to query matches' });
  }
});

// Lookup a match by gameDate + map + duration (for extension detail view)
router.get('/matches/lookup', async (req, res) => {
  const { gameDate, map, duration } = req.query;
  if (!gameDate || !map) return res.status(400).json({ error: 'gameDate and map required' });

  const filter = {
    map,
    gameDate: new Date(gameDate),
  };
  if (duration) filter.duration = parseFloat(duration);

  try {
    const match = await Match.findOne(filter).lean();
    if (!match) return res.status(404).json({ error: 'Match not found' });

    // Load talent icons for all heroes in this match
    const heroNames = match.teams.flatMap(t => t.players.map(p => p.hero));
    await loadHeroesForMatch(heroNames);

    const teams = match.teams.map(team => ({
      teamIndex: team.teamIndex,
      win: team.win,
      bans: (team.bans || []).map(hero => ({ hero, heroImage: getHeroImageUrl(hero) })),
      players: (team.players || []).map(p => ({
        toonHandle: p.toonHandle,
        playerName: p.playerName,
        hero: p.hero,
        heroShort: p.heroShort,
        heroImage: getHeroImageUrl(p.hero),
        talents: (p.talents || []).map(resolveTalent),
      })),
    }));

    res.json({
      id: match._id,
      gameDate: match.gameDate,
      map: match.map,
      mapImage: getMapImageUrl(match.map),
      gameMode: match.gameMode,
      duration: match.duration,
      teams,
      events: match.events || [],
      xpTimeline: match.xpTimeline || [],
    });
  } catch (err) {
    console.error('[matches/lookup] failed:', err.message);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

router.get('/matches/:id', async (req, res) => {
  const { id } = req.params;
  if (!require('mongoose').Types.ObjectId.isValid(id)) {
    return res.status(404).json({ error: 'Match not found' });
  }
  const match = await Match.findById(id).lean().exec();
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const teams = match.teams.map(team => ({
    teamIndex: team.teamIndex,
    win: team.win,
    bans: (team.bans || []).map(hero => ({ hero, heroImage: getHeroImageUrl(hero) })),
    players: (team.players || []).map(p => ({
      toonHandle: p.toonHandle,
      playerName: p.playerName,
      hero: p.hero,
      heroShort: p.heroShort,
      heroImage: getHeroImageUrl(p.hero),
      talents: p.talents || [],
    })),
  }));

  res.json({
    id: match._id,
    fingerprint: match.fingerprint,
    filename: match.filename,
    gameDate: match.gameDate,
    map: match.map,
    mapImage: getMapImageUrl(match.map),
    gameMode: match.gameMode,
    duration: match.duration,
    hasReplay: !!(match.replayPath && fs.existsSync(match.replayPath)),
    teams,
    events: match.events || [],
    xpTimeline: match.xpTimeline || [],
  });
});

router.get('/matches/:id/replay', checkAuth, async (req, res) => {
  try {
    const match = await Match.findById(req.params.id).select('replayPath filename');
    if (!match || !match.replayPath) {
      return res.status(404).json({ error: 'Replay file not available on this server' });
    }
    if (!fs.existsSync(match.replayPath)) {
      return res.status(404).json({ error: 'Replay file not available on this server' });
    }
    const filename = match.filename || path.basename(match.replayPath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(match.replayPath).pipe(res);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ error: 'Match not found' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
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

async function processReplayFile(filename, filePath, res) {
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
    let matchId = null;
    try {
      const existing = await Match.findOne({ fingerprint: parseResult.gameFingerprint }, '_id').lean();
      matchId = existing?._id ?? null;
    } catch {}
    return res.status(409).json({ status: 'duplicate', filename, reason: 'game_fingerprint', matchId });
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

  console.log(`[upload] ${filename}: parsed, ${insertedCount} players inserted`);

  let matchId = null;
  if (parseResult.matchDoc) {
    try {
      const savedDoc = await Match.findOneAndUpdate(
        { fingerprint: parseResult.gameFingerprint },
        { $setOnInsert: parseResult.matchDoc },
        { upsert: true, new: true }
      );
      matchId = savedDoc?._id ?? null;
      for (const team of savedDoc.teams) {
        for (const player of team.players) {
          broadcast({
            type: 'new_game',
            game: {
              id: savedDoc._id.toString(),
              toonHandle: player.toonHandle,
              playerName: player.playerName,
              gameDate: savedDoc.gameDate,
              map: savedDoc.map,
              gameMode: savedDoc.gameMode,
              hero: player.hero,
              heroShort: player.heroShort,
              heroImage: getHeroImageUrl(player.hero),
              win: Boolean(team.win),
              duration: savedDoc.duration,
            },
          });
        }
      }
    } catch (err) {
      console.error(`[upload] MongoDB upsert failed for ${filename}: ${err.message}`);
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
    }
  } else {
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
  }

  res.json({ status: 'ok', matchId, gamesAdded: insertedCount, duplicate: false });
}

// Multipart upload (for curl / browser forms)
router.post('/upload', checkAuth, upload.single('replay'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No .StormReplay file provided.' });
  }
  if (!isValidFilename(req.file.originalname)) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: 'Invalid filename.' });
  }
  await processReplayFile(req.file.originalname, req.file.path, res);
});

// Raw binary upload (for the Rust client)
const rawUploadParser = express.raw({ type: '*/*', limit: '10mb' });
router.post('/upload-raw', checkAuth, rawUploadParser, async (req, res) => {
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

  await processReplayFile(filename, tempPath, res);
});

module.exports = router;
module.exports.init = init;
