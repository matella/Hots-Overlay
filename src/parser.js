const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Parser = require('hots-parser');
const config = require('./config');
const db = require('./database');
const { normalizeHeroName } = require('./heroNames');
const { Match } = require('./db/match.model');

const MAP_OBJECTIVE_NAMES = {
  'Cursed Hollow': 'Tribute',
  'Dragon Shire': 'Dragon Knight',
  'Garden of Terror': 'Garden Terror',
  'Infernal Shrines': 'Punisher',
  'Tomb of the Spider Queen': 'Spider Queen',
  'Sky Temple': 'Temple',
  'Towers of Doom': 'Altar',
  "Blackheart's Bay": 'Coin',
  'Warhead Junction': 'Nuke',
  'Volskaya Foundry': 'Triglav Protector',
  'Alterac Pass': 'Cavalry',
};

const GAME_MODE_STRINGS = {
  50001: 'Quick Match',
  50021: 'Versus AI',
  50031: 'Brawl',
  50041: 'Practice',
  50051: 'Unranked Draft',
  50061: 'Hero League',
  50071: 'Team League',
  50091: 'Storm League',
  '-1': 'Custom',
};

const TIER_MAP = {
  Tier1Choice: 1,
  Tier2Choice: 4,
  Tier3Choice: 7,
  Tier4Choice: 10,
  Tier5Choice: 13,
  Tier6Choice: 16,
  Tier7Choice: 20,
};

function extractTalents(rawTalents) {
  if (!rawTalents || typeof rawTalents !== 'object') return [];
  return Object.entries(rawTalents)
    .filter(([k, name]) => TIER_MAP[k] != null && name != null)
    .map(([k, name]) => ({ tier: TIER_MAP[k], name }))
    .sort((a, b) => a.tier - b.tier);
}

function extractXpTimeline(xpBreakdown) {
  if (!Array.isArray(xpBreakdown) || xpBreakdown.length === 0) return [];
  const byTime = new Map();
  for (const entry of xpBreakdown) {
    const t = entry.time;
    if (!byTime.has(t)) byTime.set(t, {});
    const bd = entry.breakdown || {};
    const total = (bd.MinionXP || 0) + (bd.CreepXP || 0) +
                  (bd.StructureXP || 0) + (bd.HeroXP || 0) + (bd.TrickleXP || 0);
    byTime.get(t)[entry.team] = total;
  }
  const timeline = [];
  for (const [time, teams] of byTime) {
    const t0 = teams[0] || 0;
    const t1 = teams[1] || 0;
    timeline.push({ time, lead: Math.round(t0 - t1) });
  }
  timeline.sort((a, b) => a.time - b.time);
  return timeline;
}

function extractEvents(result) {
  const events = [];
  const loopGameStart = result.match.loopGameStart || 0;

  // Build toonHandle → 0-indexed team map
  const playerTeam = {};
  for (const [toon, p] of Object.entries(result.players || {})) {
    if (p && typeof p.team === 'number') playerTeam[toon] = p.team;
  }

  // Kill events
  for (const td of result.match.takedowns || []) {
    events.push({
      type: 'kill',
      time: Math.round((td.loop - loopGameStart) / 16),
      team: playerTeam[td.killers?.[0]?.player] ?? null,
      subject: td.killers?.[0]?.player ?? null,
      target: td.victim?.player ?? null,
    });
  }

  // Structure destruction events
  // Build lane map: for each (team, name) group, sort by Y ascending → bottom/mid/top
  const structures = Object.entries(result.match.structures || {});
  const laneMap = new Map();
  const groups = new Map();
  for (const [id, s] of structures) {
    const key = `${s.team}|${s.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id, y: s.y });
  }
  const LANE_LABELS = ['bottom', 'mid', 'top'];
  for (const members of groups.values()) {
    members.sort((a, b) => a.y - b.y);
    members.forEach(({ id }, i) => {
      const label = members.length === 1 ? 'mid'
        : members.length === 2 ? (i === 0 ? 'bottom' : 'top')
        : LANE_LABELS[Math.min(i, 2)];
      laneMap.set(id, label);
    });
  }
  for (const [id, s] of structures) {
    if (s.destroyedLoop === undefined || s.destroyed === undefined) continue;
    events.push({
      type: 'fort_destroyed',
      time: s.destroyed,
      team: s.team,
      subject: null,
      target: null,
      details: { name: s.name, lane: laneMap.get(id) ?? null },
    });
  }

  // Objective events
  const obj = result.match.objective;
  if (obj) {
    const objectiveName = MAP_OBJECTIVE_NAMES[result.match.map] || 'Objective';
    for (const teamIdx of [0, 1]) {
      const teamObj = obj[teamIdx];
      if (!teamObj || !Array.isArray(teamObj.events)) continue;
      for (const ev of teamObj.events) {
        if (typeof ev.time !== 'number') continue;
        events.push({
          type: 'objective',
          time: ev.time,
          team: ev.team ?? teamIdx,
          subject: null,
          target: null,
          details: { name: objectiveName },
        });
      }
    }
  }

  // Merc capture events
  const mercs = result.match.mercs;
  if (mercs) {
    for (const teamIdx of [0, 1]) {
      const teamMercs = mercs[teamIdx];
      if (!teamMercs || !Array.isArray(teamMercs.events)) continue;
      for (const ev of teamMercs.events) {
        if (typeof ev.time !== 'number') continue;
        events.push({
          type: 'merc_capture',
          time: ev.time,
          team: ev.team ?? teamIdx,
          subject: null,
          target: null,
          details: { name: ev.type || 'Mercenary' },
        });
      }
    }
  }

  events.sort((a, b) => a.time - b.time);
  return events;
}

function parseReplay(filePath) {
  // Resolve to absolute path and validate it exists
  const resolvedPath = path.resolve(filePath);
  const filename = path.basename(resolvedPath);

  // Validate the file has the expected replay extension
  if (!resolvedPath.endsWith('.StormReplay')) {
    return { error: 'Invalid file type: must be a .StormReplay file' };
  }

  // Validate the path is within the configured replay directory
  const replayDir = path.resolve(config.replayDir);
  const isWin = process.platform === 'win32';
  const normResolved = isWin ? resolvedPath.toLowerCase() : resolvedPath;
  const normDir = isWin ? replayDir.toLowerCase() : replayDir;
  if (!normResolved.startsWith(normDir + path.sep) && normResolved !== normDir) {
    return { error: 'Path traversal attempt blocked' };
  }

  try {
    fs.statSync(resolvedPath);
  } catch (err) {
    return { error: `File stat failed: ${err.message}` };
  }

  let result;
  try {
    result = Parser.processReplay(resolvedPath, { getBMData: false, overrideVerifiedBuild: true, legacyTalentKeys: false });
  } catch (err) {
    return { error: `Parser exception: ${err.message}` };
  }

  if (result.status !== Parser.ReplayStatus.OK) {
    const statusName = Object.entries(Parser.ReplayStatus)
      .find(([, v]) => v === result.status)?.[0] || 'unknown';
    return { error: `Bad parser status: ${result.status} (${statusName})` };
  }

  const gameDate = result.match.date instanceof Date
    ? result.match.date.toISOString()
    : String(result.match.date);
  const map = result.match.map;
  const gameMode = GAME_MODE_STRINGS[result.match.mode] || 'Unknown';
  const duration = result.match.length ?? null;

  const players = [];
  for (const [toonHandle, player] of Object.entries(result.players)) {
    if (!player || !player.hero) continue;

    players.push({
      filename,
      toonHandle,
      gameDate,
      map,
      gameMode,
      hero: player.hero,
      heroShort: normalizeHeroName(player.hero),
      win: player.win ? 1 : 0,
      duration,
      playerName: player.name,
      teamIndex: player.team != null ? player.team : null,
      talents: extractTalents(player.talents),
    });
  }

  if (players.length === 0) {
    return { error: `No valid players found` };
  }

  // Compute a game fingerprint from match data to detect duplicate games
  // even when uploaded from different replay files
  const sortedToons = Object.keys(result.players).sort().join(',');
  const fingerprintSource = `${gameDate}|${map}|${duration}|${sortedToons}`;
  const gameFingerprint = crypto.createHash('sha256').update(fingerprintSource).digest('hex');

  const teams = [0, 1].map(teamIndex => {
    const teamPlayers = players.filter(p => p.teamIndex === teamIndex);
    const win = teamPlayers.some(p => p.win === 1);
    return { teamIndex, win, players: teamPlayers, bans: [] };
  });

  // Extract bans per team (only populated in draft modes)
  if (result.match.bans) {
    for (const [teamKey, bansForTeam] of Object.entries(result.match.bans)) {
      const teamIndex = parseInt(teamKey, 10); // parser keys are "0" and "1"
      if ((teamIndex === 0 || teamIndex === 1) && Array.isArray(bansForTeam)) {
        teams[teamIndex].bans = bansForTeam
          .filter(b => b && b.hero)
          .sort((a, b) => a.order - b.order)
          .map(b => normalizeHeroName(b.hero));
      }
    }
  }

  const events = extractEvents(result);
  const xpTimeline = extractXpTimeline(result.match.XPBreakdown);

  const toSchemaPlayer = (p) => ({
    toonHandle: p.toonHandle,
    playerName: p.playerName,
    hero: p.hero,
    heroShort: p.heroShort,
    talents: p.talents,
  });
  const matchDoc = {
    fingerprint: gameFingerprint,
    filename,
    replayPath: resolvedPath,
    gameDate: new Date(gameDate),
    map,
    gameMode,
    duration,
    teams: teams.map(t => ({
      teamIndex: t.teamIndex,
      win: t.win,
      bans: t.bans,
      players: t.players.map(toSchemaPlayer),
    })),
    events,
    xpTimeline,
  };

  return { players, teams, gameFingerprint, events, xpTimeline, matchDoc };
}

function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

async function scanAndParseAll(replayDir, onProgress) {
  const resolvedDir = path.resolve(replayDir);
  const files = fs.readdirSync(resolvedDir)
    .filter(f => f.endsWith('.StormReplay'));

  const processed = db.getAllProcessedFilenames();
  const toParse = files.filter(f => !processed.has(f));

  let done = 0;
  const BATCH_SIZE = 50;
  for (let i = 0; i < toParse.length; i += BATCH_SIZE) {
    const batch = toParse.slice(i, i + BATCH_SIZE);

    // Parse all files in batch OUTSIDE the transaction (CPU-intensive)
    const parsed = [];
    for (const file of batch) {
      try {
        const result = parseReplay(path.join(resolvedDir, file));
        parsed.push({ file, result });
      } catch (err) {
        console.error(`Failed to process ${file}:`, err.message);
        parsed.push({ file, result: null });
      }
      done++;
      if (onProgress) onProgress(done, toParse.length);
    }

    // Only DB writes inside the transaction (fast, no CPU work)
    db.runInTransaction(() => {
      for (const { file, result } of parsed) {
        if (result && result.players) {
          // Skip duplicate games by fingerprint
          if (result.gameFingerprint && db.gameExists(result.gameFingerprint)) {
            db.markFileProcessed(file);
            continue;
          }
          for (const playerData of result.players) {
            db.insertReplay(playerData);
          }
          if (result.gameFingerprint) {
            db.storeGameFingerprint(result.gameFingerprint, file);
          }
        }
        db.markFileProcessed(file);
      }
    });

    // Upsert Match documents to MongoDB for all parsed games in this batch
    const mongoOps = [];
    for (const { file, result } of parsed) {
      if (result && result.matchDoc && result.gameFingerprint) {
        mongoOps.push(
          Match.findOneAndUpdate(
            { fingerprint: result.gameFingerprint },
            { $setOnInsert: result.matchDoc },
            { upsert: true }
          ).catch(err => console.error(`[parser] MongoDB upsert failed for ${file}: ${err.message}`))
        );
      }
    }
    if (mongoOps.length > 0) await Promise.all(mongoOps);

    await yieldToEventLoop();
  }

  return { total: files.length, newlyParsed: done, alreadyCached: files.length - toParse.length };
}

module.exports = { parseReplay, scanAndParseAll };
