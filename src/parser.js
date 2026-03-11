const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Parser = require('hots-parser');
const config = require('./config');
const db = require('./database');
const { normalizeHeroName } = require('./heroNames');

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

function parseReplay(filePath) {
  const filename = path.basename(filePath);

  try {
    fs.statSync(filePath);
  } catch (err) {
    return { error: `File stat failed: ${err.message}` };
  }

  let result;
  try {
    result = Parser.processReplay(filePath, { getBMData: false, overrideVerifiedBuild: true });
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

  return { players, gameFingerprint };
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
