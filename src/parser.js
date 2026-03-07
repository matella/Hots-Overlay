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

  // Step 1: verify file exists and is readable
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    const msg = `File stat failed: ${err.message}`;
    console.warn(`[parser] ${filename}: ${msg}`);
    return { error: msg };
  }
  console.log(`[parser] ${filename}: file exists, ${stat.size} bytes`);

  // Step 2: read first 4 bytes to verify file magic
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    console.log(`[parser] ${filename}: magic bytes = ${buf.toString('hex')}`);
  } catch (err) {
    console.warn(`[parser] ${filename}: could not read magic bytes: ${err.message}`);
  }

  // Step 3: call hots-parser
  let result;
  try {
    console.log(`[parser] ${filename}: calling Parser.processReplay...`);
    result = Parser.processReplay(filePath, { getBMData: false, overrideVerifiedBuild: true });
    console.log(`[parser] ${filename}: parser returned status=${result.status}`);
  } catch (err) {
    const msg = `Parser exception: ${err.message}`;
    console.warn(`[parser] ${filename}: ${msg}`);
    console.warn(`[parser] ${filename}: stack: ${err.stack}`);
    return { error: msg };
  }

  // Step 4: check parser status
  if (result.status !== Parser.ReplayStatus.OK) {
    const statusName = Object.entries(Parser.ReplayStatus)
      .find(([, v]) => v === result.status)?.[0] || 'unknown';
    const msg = `Bad parser status: ${result.status} (${statusName})`;
    console.warn(`[parser] ${filename}: ${msg}`);
    return { error: msg };
  }

  // Step 5: extract match data
  console.log(`[parser] ${filename}: status OK, extracting match data...`);
  const gameDate = result.match.date instanceof Date
    ? result.match.date.toISOString()
    : String(result.match.date);
  const map = result.match.map;
  const gameMode = GAME_MODE_STRINGS[result.match.mode] || 'Unknown';
  const duration = result.match.length || null;
  console.log(`[parser] ${filename}: map=${map}, mode=${gameMode}, date=${gameDate}, duration=${duration}`);

  // Step 6: extract player data
  const playerCount = result.players ? Object.keys(result.players).length : 0;
  console.log(`[parser] ${filename}: found ${playerCount} players in result`);

  const players = [];
  for (const [toonHandle, player] of Object.entries(result.players)) {
    if (!player || !player.hero) {
      console.log(`[parser] ${filename}: skipping player ${toonHandle} (no hero)`);
      continue;
    }

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
    const msg = `No valid players found (${playerCount} total in replay)`;
    console.warn(`[parser] ${filename}: ${msg}`);
    return { error: msg };
  }

  console.log(`[parser] ${filename}: parsed OK, ${players.length} players extracted`);
  return { players };
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
      const result = parseReplay(path.join(replayDir, file));
      if (result.players) {
        for (const playerData of result.players) {
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
