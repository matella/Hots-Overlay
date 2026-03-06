const express = require('express');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const path = require('path');
const config = require('./src/config');
const db = require('./src/database');
const { parseReplay, scanAndParseAll } = require('./src/parser');
const { startWatcher } = require('./src/watcher');
const { getHeroImageUrl } = require('./src/heroNames');
const routes = require('./src/routes');

fs.mkdirSync(config.replayDir, { recursive: true });
db.initDatabase();

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

routes.init(broadcast);

server.listen(config.port, () => {
  console.log(`Overlay: http://localhost:${config.port}`);

  console.log('Scanning replays...');
  const result = scanAndParseAll(config.replayDir, (done, total) => {
    if (done % 100 === 0 || done === total) {
      console.log(`  ${done}/${total}`);
    }
  });
  console.log(`Done: ${result.newlyParsed} new, ${result.alreadyCached} cached`);

  startWatcher(config.replayDir, (filePath) => {
    const filename = path.basename(filePath);
    if (db.isFileProcessed(filename)) return;

    const parsed = parseReplay(filePath);
    if (!parsed) {
      db.markFileProcessed(filename);
      return;
    }

    db.insertReplay(parsed);
    db.markFileProcessed(filename);

    // Broadcast to all clients - they filter by their active mode
    broadcast({
      type: 'new_game',
      game: {
        gameDate: parsed.gameDate,
        map: parsed.map,
        gameMode: parsed.gameMode,
        hero: parsed.hero,
        heroShort: parsed.heroShort,
        heroImage: getHeroImageUrl(parsed.hero),
        win: Boolean(parsed.win),
        duration: parsed.duration,
      },
    });
  });

  console.log('Watching for new replays...');
});
