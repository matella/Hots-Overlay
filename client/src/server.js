const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const routes = require('./routes');
const eventBus = require('./eventBus');
const uploader = require('./uploader');
const { getWatcherStatus } = require('./watcher');
const settings = require('./settings');

const WS_EVENTS = [
  'upload:start', 'upload:success', 'upload:fail', 'upload:duplicate', 'upload:progress',
  'watcher:started', 'watcher:error',
  'server:connected', 'server:disconnected',
];

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', routes);

  // Catch-all JSON error handler (prevents Express from returning HTML errors)
  app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: err.message || 'Internal server error.' });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  // Forward eventBus events to all WebSocket clients
  for (const event of WS_EVENTS) {
    eventBus.on(event, (data) => {
      const msg = JSON.stringify({ type: event, ...data });
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(msg);
      }
    });
  }

  // Send current state to newly connected clients
  wss.on('connection', (ws) => {
    const status = uploader.getStatus();
    ws.send(JSON.stringify({
      type: 'init',
      ...status,
      watcherStatus: getWatcherStatus(),
      replayDir: settings.getReplayDir(),
    }));
  });

  return server;
}

module.exports = { createServer };
