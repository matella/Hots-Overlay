const path = require('path');
const fs = require('fs');
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

  let result;
  try {
    result = Parser.processReplay(filePath, { getBMData: false, overrideVerifiedBuild: true });
  } catch {
    return null;
  }

  if (result.status !== Parser.ReplayStatus.OK) return null;

  const gameDate = result.match.date instanceof Date
    ? result.match.date.toISOString()
    : String(result.match.date);
  const map = result.match.map;
  const gameMode = GAME_MODE_STRINGS[result.match.mode] || 'Unknown';
  const duration = result.match.length || null;

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

  return players.length > 0 ? players : null;
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
  for (const file of toParse) {
    try {
      const results = parseReplay(path.join(replayDir, file));
      if (results) {
        for (const playerData of results) {
          db.insertReplay(playerData);
        }
      }
      db.markFileProcessed(file);
    } catch (err) {
      console.error(`Failed to process ${file}:`, err.message);
    }

    done++;
    if (onProgress) onProgress(done, toParse.length);

    // Yield to the event loop every 5 files so HTTP health checks can respond
    if (done % 5 === 0) await yieldToEventLoop();
  }

  return { total: files.length, newlyParsed: done, alreadyCached: files.length - toParse.length };
}

module.exports = { parseReplay, scanAndParseAll };
