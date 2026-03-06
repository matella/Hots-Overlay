require('dotenv').config();
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
  port: parseInt(process.env.PORT, 10) || 3000,
  dbPath: path.resolve(process.env.DB_PATH || './data/overlay.db'),
  gameMode: process.env.GAME_MODE || 'Storm League',
  modeLabels,
});

for (const key of ['replayDir', 'toonHandle']) {
  if (!config[key]) throw new Error(`Missing required env var for config.${key}. Check your .env file.`);
}

module.exports = config;
