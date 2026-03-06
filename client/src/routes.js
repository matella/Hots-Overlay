const express = require('express');
const fs = require('fs');
const settings = require('./settings');
const uploader = require('./uploader');
const { startWatcher, getWatcherStatus } = require('./watcher');

const router = express.Router();

// Optional browse handler — set by main.js when running in Electron
let browseHandler = null;
function setBrowseHandler(fn) { browseHandler = fn; }

router.get('/status', (_req, res) => {
  const status = uploader.getStatus();
  res.json({
    ...status,
    watcherStatus: getWatcherStatus(),
    replayDir: settings.getReplayDir(),
    replayDirSource: settings.getReplayDirSource(),
  });
});

router.get('/settings', (_req, res) => {
  res.json({
    replayDir: settings.getReplayDir() || '',
    replayDirSource: settings.getReplayDirSource(),
    canBrowse: Boolean(browseHandler),
  });
});

router.put('/settings', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body.' });
  }
  const { replayDir } = req.body;
  if (!replayDir || typeof replayDir !== 'string') {
    return res.status(400).json({ error: 'replayDir is required.' });
  }

  const dir = replayDir.trim();
  if (!fs.existsSync(dir)) {
    return res.status(400).json({ error: 'Directory does not exist.' });
  }

  settings.saveSettings({ replayDir: dir });

  // Apply immediately: start watching, then scan existing replays in background
  if (uploader.isReady()) {
    startWatcher(dir, (filePath) => uploader.uploadFile(filePath));
    uploader.scanAndUpload(dir).catch((err) => console.error('Scan error:', err));
  }

  res.json({ status: 'ok', message: 'Settings saved.' });
});

router.post('/browse', async (_req, res) => {
  if (!browseHandler) {
    return res.status(501).json({ error: 'Browse not available (headless mode).' });
  }
  try {
    const dir = await browseHandler();
    if (dir) {
      res.json({ path: dir });
    } else {
      res.json({ path: null });
    }
  } catch {
    res.status(500).json({ error: 'Failed to open folder picker.' });
  }
});

module.exports = router;
module.exports.setBrowseHandler = setBrowseHandler;
