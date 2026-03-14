const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Parser = require('hots-parser');
const config = require('./config');
const db = require('./database');
const { normalizeHeroName } = require('./heroNames');

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
  Tier4Choice: 4,
  Tier7Choice: 7,
  Tier10Choice: 10,
  Tier13Choice: 13,
  Tier16Choice: 16,
  Tier20Choice: 20,
};

function extractTalents(rawTalents) {
  if (!rawTalents || typeof rawTalents !== 'object') return [];
  return Object.entries(rawTalents)
    .filter(([k, name]) => TIER_MAP[k] != null && name != null)
    .map(([k, name]) => ({ tier: TIER_MAP[k], name }))
    .sort((a, b) => a.tier - b.tier);
}

function extractEvents(result) {
  const events = [];
  const loopGameStart = result.match.loopGameStart || 0;

  // Build toonHandle → 0-indexed team map
  const playerTeam = {};
  for (const [toon, p] of Object.entries(result.players || {})) {
    if (p && typeof p.team === 'number') playerTeam[toon] = p.team - 1;
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

  events.sort((a, b) => a.time - b.time);
  return events;
}

function parseReplay(filePath) {
  const filename = path.basename(filePath);

  try {
    fs.statSync(filePath);
  } catch (err) {
    return { error: `File stat failed: ${err.message}` };
  }

  let result;
  try {
    result = Parser.processReplay(filePath, { getBMData: false, overrideVerifiedBuild: true, legacyTalentKeys: false });
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
      teamIndex: player.team != null ? player.team - 1 : null,
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

  return { players, teams, gameFingerprint, events };
}

function yieldToEventLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

async function scanAndParseAll(replayDir, onProgress) {
  const files = fs.readdirSync(replayDir)
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
        const result = parseReplay(path.join(replayDir, file));
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
    await yieldToEventLoop();
  }

  return { total: files.length, newlyParsed: done, alreadyCached: files.length - toParse.length };
}

module.exports = { parseReplay, scanAndParseAll };
