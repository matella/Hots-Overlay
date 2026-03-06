const path = require('path');
const chokidar = require('chokidar');

function startWatcher(replayDir, onNewReplay) {
  const watcher = chokidar.watch(
    path.join(replayDir, '*.StormReplay'),
    {
      persistent: true,
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 5000,
        pollInterval: 1000,
      },
    }
  );

  watcher.on('add', (filePath) => {
    console.log(`New replay detected: ${path.basename(filePath)}`);
    onNewReplay(filePath);
  });

  watcher.on('error', (err) => console.error('Watcher error:', err));

  return watcher;
}

module.exports = { startWatcher };
