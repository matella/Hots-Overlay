const path = require('path');

// Load .env for development / headless mode (optional — packaged builds use defaults.json)
const isPackaged = __dirname.includes('app.asar');
if (!isPackaged) {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}

const settings = require('./src/settings');
const uploader = require('./src/uploader');
const { startWatcher } = require('./src/watcher');
const { createServer } = require('./src/server');

async function start() {
  const SERVER_URL = settings.getServerUrl();
  const AUTH_TOKEN = settings.getAuthToken();
  const CLIENT_PORT = parseInt(process.env.CLIENT_PORT, 10) || 3002;

  // Always start the web server (even without SERVER_URL, so user can see the UI)
  const server = createServer();
  await new Promise((resolve) => {
    server.listen(CLIENT_PORT, () => {
      console.log(`Client UI: http://localhost:${CLIENT_PORT}`);
      resolve();
    });
  });

  if (!SERVER_URL) {
    console.log('No server URL configured.');
    console.log(`Open http://localhost:${CLIENT_PORT} to set it in Settings.`);
    return { server, port: CLIENT_PORT };
  }

  // Initialize uploader and start connectivity check
  uploader.init(SERVER_URL, AUTH_TOKEN);
  uploader.startConnectivityCheck();
  console.log(`Server: ${SERVER_URL}`);

  const replayDir = settings.getReplayDir();
  if (!replayDir) {
    console.log('No replay directory configured.');
    console.log(`Open http://localhost:${CLIENT_PORT} to set it in Settings.`);
    return { server, port: CLIENT_PORT };
  }

  console.log(`Replays: ${replayDir}`);

  // Start watching immediately, scan existing replays in background
  startWatcher(replayDir, (filePath) => uploader.uploadFile(filePath));
  uploader.scanAndUpload(replayDir).catch((err) => console.error('Scan error:', err));
  return { server, port: CLIENT_PORT };
}

// Auto-run when executed directly (headless mode)
if (require.main === module) {
  start().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { start };
