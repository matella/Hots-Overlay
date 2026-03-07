console.log('[startup] Loading modules...');
const express = require('express');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const path = require('path');
const config = require('./src/config');
console.log(`[startup] Config loaded — port=${config.port}, replayDir=${config.replayDir}`);
const db = require('./src/database');
const { parseReplay, scanAndParseAll } = require('./src/parser');
const { startWatcher } = require('./src/watcher');
const { getHeroImageUrl } = require('./src/heroNames');
const routes = require('./src/routes');

fs.mkdirSync(config.replayDir, { recursive: true });
console.log('[startup] Initializing database...');
db.initDatabase();
console.log('[startup] Database ready');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', routes);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function onNewReplay(filePath) {
  const filename = path.basename(filePath);
  if (db.isFileProcessed(filename)) return;

  const result = parseReplay(filePath);
  if (!result.players) {
    db.markFileProcessed(filename);
    return;
  }

  for (const playerData of result.players) {
    db.insertReplay(playerData);
  }
  db.markFileProcessed(filename);

  for (const p of result.players) {
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

routes.init(broadcast);

// Start listening immediately so health checks pass while replays are scanning
server.listen(config.port, async () => {
  console.log(`Overlay: http://localhost:${config.port}`);

  console.log('Scanning replays...');
  const result = await scanAndParseAll(config.replayDir, (done, total) => {
    if (done % 100 === 0 || done === total) {
      console.log(`  ${done}/${total}`);
    }
  });
  console.log(`Done: ${result.newlyParsed} new, ${result.alreadyCached} cached`);

  startWatcher(config.replayDir, onNewReplay);
  console.log('Watching for new replays...');
});
