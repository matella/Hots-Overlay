console.log('[startup] Loading modules...');
const express = require('express');
const http = require('http');
const https = require('https');
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
const twitch = require('./src/twitch');
const swaggerUi = require('swagger-ui-express');
const swaggerDoc = require('./src/swagger.json');

fs.mkdirSync(config.replayDir, { recursive: true });
console.log('[startup] Initializing database...');
db.initDatabase();
console.log('[startup] Database ready');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
app.use('/api', routes);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let wssHttps = null;

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const wsServer of [wss, wssHttps]) {
    if (!wsServer) continue;
    for (const client of wsServer.clients) {
      if (client.readyState === 1) {
        try { client.send(msg); } catch {}
      }
    }
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

  if (config.twitch.broadcasterId && config.twitch.clientId) {
    const grouped = db.getRecentGroupedGames(config.toonHandle, db.ALL_MODES, 1);
    if (grouped.length > 0) {
      twitch.sendPubSubMessage(config.twitch.broadcasterId, { type: 'new_game', game: grouped[0] })
        .catch(err => console.error('[twitch] PubSub failed:', err.message));
    }
  }
}

routes.init(broadcast);

if (config.httpsPort && config.sslKeyPath && config.sslCertPath) {
  try {
    const sslOptions = {
      key: fs.readFileSync(config.sslKeyPath),
      cert: fs.readFileSync(config.sslCertPath),
    };
    const httpsServer = https.createServer(sslOptions, app);
    wssHttps = new WebSocketServer({ server: httpsServer });
    httpsServer.listen(config.httpsPort, () => {
      console.log(`Overlay (HTTPS): https://localhost:${config.httpsPort}`);
    });
  } catch (err) {
    console.warn('[https] Could not start HTTPS server:', err.message);
  }
}

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
