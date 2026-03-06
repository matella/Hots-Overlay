const fs = require('fs');
const path = require('path');

// In packaged Electron, __dirname is inside app.asar (read-only).
// Use the exe's directory for writable user data instead.
const isPackaged = __dirname.includes('app.asar');
const DATA_DIR = isPackaged
  ? path.join(path.dirname(process.execPath), 'data')
  : path.resolve(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Build-time defaults (baked by scripts/configure.js → build/defaults.json)
// In packaged Electron: bundled as extraResource in resources/
// In development: lives in build/
const DEFAULTS_FILE = process.resourcesPath
  ? path.join(process.resourcesPath, 'defaults.json')
  : path.resolve(__dirname, '..', 'build', 'defaults.json');

let defaults = {};
try {
  defaults = JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8'));
} catch {
  // No defaults file — that's fine in dev mode (.env is used instead)
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  const current = loadSettings();
  const merged = { ...current, ...patch };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
}

// Priority: .env > settings.json > defaults.json

function getReplayDir() {
  return process.env.REPLAY_DIR || loadSettings().replayDir || null;
}

function getReplayDirSource() {
  if (process.env.REPLAY_DIR) return 'env';
  if (loadSettings().replayDir) return 'settings';
  return 'none';
}

function getServerUrl() {
  return process.env.SERVER_URL || loadSettings().serverUrl || defaults.serverUrl || null;
}

function getAuthToken() {
  return process.env.AUTH_TOKEN || loadSettings().authToken || defaults.authToken || null;
}

module.exports = {
  loadSettings,
  saveSettings,
  getReplayDir,
  getReplayDirSource,
  getServerUrl,
  getAuthToken,
};
