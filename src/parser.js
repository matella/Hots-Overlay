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

  const player = result.players[config.toonHandle];
  if (!player || !player.hero) return null;

  return {
    filename,
    gameDate: result.match.date instanceof Date
      ? result.match.date.toISOString()
      : String(result.match.date),
    map: result.match.map,
    gameMode: GAME_MODE_STRINGS[result.match.mode] || 'Unknown',
    hero: player.hero,
    heroShort: normalizeHeroName(player.hero),
    win: player.win ? 1 : 0,
    duration: result.match.length || null,
    playerName: player.name,
  };
}

function scanAndParseAll(replayDir, onProgress) {
  const files = fs.readdirSync(replayDir)
    .filter(f => f.endsWith('.StormReplay'));

  const processed = db.getAllProcessedFilenames();
  const toParse = files.filter(f => !processed.has(f));

  let done = 0;
  for (const file of toParse) {
    try {
      const result = parseReplay(path.join(replayDir, file));
      if (result) db.insertReplay(result);
      db.markFileProcessed(file);
    } catch (err) {
      console.error(`Failed to process ${file}:`, err.message);
    }

    done++;
    if (onProgress) onProgress(done, toParse.length);
  }

  return { total: files.length, newlyParsed: done, alreadyCached: files.length - toParse.length };
}

module.exports = { parseReplay, scanAndParseAll };
