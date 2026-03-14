console.log('[startup] Loading modules...');
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const path = require('path');
const config = require('./src/config');
console.log(`[startup] Config loaded — port=${config.port}, replayDir=${config.replayDir}`);
const db = require('./src/database');
const mongo = require('./src/db/connection');
const { Match } = require('./src/db/match.model');
const { parseReplay, scanAndParseAll } = require('./src/parser');
const { startWatcher } = require('./src/watcher');
const { getHeroImageUrl } = require('./src/heroNames');
const routes = require('./src/routes');
const ebs = require('./src/ebs');
const swaggerUi = require('swagger-ui-express');
const swaggerDoc = require('./src/swagger.json');

fs.mkdirSync(config.replayDir, { recursive: true });
console.log('[startup] Initializing database...');
db.initDatabase();
console.log('[startup] Database ready');

mongo.connect();

async function shutdown(signal) {
  console.log(`[server] ${signal} received, shutting down...`);
  await mongo.disconnect();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const app = express();

// Allow Twitch extension frontends (*.ext-twitch.tv) and local dev to call the EBS API
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // same-origin, curl, Azure health checks
    if (/^https:\/\/[^/]+\.ext-twitch\.tv$/.test(origin)) return callback(null, true);
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    callback(Object.assign(new Error('CORS: origin not allowed'), { status: 403 }));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Filename', 'X-Content-Encoding', 'X-Content-Sha256'],
}));

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

async function onNewReplay(filePath) {
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

  if (result.matchDoc) {
    try {
      const savedDoc = await Match.findOneAndUpdate(
        { fingerprint: result.gameFingerprint },
        { $setOnInsert: result.matchDoc },
        { upsert: true, new: true }
      );
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
      console.error(`[server] MongoDB upsert failed for ${filename}: ${err.message}`);
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
  } else {
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

  // Notify the in-process EBS directly (replaces the old WebSocket self-loop).
  if (config.twitch.broadcasterId && config.twitch.clientId && config.toonHandle) {
    ebs.notifyNewGame(
      `http://localhost:${config.port}`,
      config.twitch.broadcasterId,
      config.toonHandle,
      config.gameMode,
    );
  }

  // Forward a new_game event to an external EBS if EBS_URL is configured.
  if (config.ebsUrl) {
    ebs.webhookPost(config.ebsUrl, {
      type: 'new_game',
      games: result.players.map(p => ({
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
      })),
    }).catch(err => console.error('[server] EBS webhook POST failed:', err.message));
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

  if (config.twitch.broadcasterId && config.twitch.clientId && config.toonHandle) {
    ebs.startDataFetcher(
      `http://localhost:${config.port}`,
      config.twitch.broadcasterId,
      config.toonHandle,
      config.gameMode,
    );
  }
});
