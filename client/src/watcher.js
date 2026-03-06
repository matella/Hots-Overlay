const path = require('path');
const chokidar = require('chokidar');
const eventBus = require('./eventBus');

let status = 'stopped';
let currentWatcher = null;

function startWatcher(replayDir, onNewReplay) {
  // Stop any existing watcher before starting a new one
  stopWatcher();

  currentWatcher = chokidar.watch(
    path.join(replayDir, '*.StormReplay'),
    {
      persistent: true,
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 1000 },
    }
  );

  currentWatcher.on('add', (filePath) => {
    const filename = path.basename(filePath);
    console.log(`New replay detected: ${filename}`);
    onNewReplay(filePath);
  });

  currentWatcher.on('error', (err) => {
    console.error('Watcher error:', err);
    status = 'error';
    eventBus.emit('watcher:error', { error: err.message });
  });

  status = 'watching';
  eventBus.emit('watcher:started', { dir: replayDir });
  return currentWatcher;
}

function stopWatcher() {
  if (currentWatcher) {
    currentWatcher.close();
    currentWatcher = null;
    status = 'stopped';
  }
}

function getWatcherStatus() {
  return status;
}

module.exports = { startWatcher, stopWatcher, getWatcherStatus };
