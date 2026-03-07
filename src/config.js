require('dotenv').config({ quiet: true });
const path = require('path');

// Mode display name overrides: MODE_LABEL_Custom=Scrims in .env
const modeLabels = {};
for (const [key, val] of Object.entries(process.env)) {
  const match = key.match(/^MODE_LABEL_(.+)$/);
  if (match) modeLabels[match[1]] = val;
}

const config = Object.freeze({
  replayDir: process.env.REPLAY_DIR,
  toonHandle: process.env.TOON_HANDLE,
  port: parseInt(process.env.WEBSITES_PORT || process.env.PORT, 10) || 8080,
  dbPath: path.resolve(process.env.DB_PATH || './data/overlay.db'),
  gameMode: process.env.GAME_MODE || 'Storm League',
  authToken: process.env.AUTH_TOKEN || null,
  modeLabels,
});

if (!config.replayDir) throw new Error('Missing required env var REPLAY_DIR. Check your .env file.');
if (!config.toonHandle) console.warn('Warning: TOON_HANDLE not set. Use ?player= URL param to specify a player.');

module.exports = config;
