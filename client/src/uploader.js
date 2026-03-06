const fs = require('fs');
const path = require('path');
const eventBus = require('./eventBus');

// In packaged Electron, __dirname is inside app.asar (read-only).
const isPackaged = __dirname.includes('app.asar');
const DATA_DIR = isPackaged
  ? path.join(path.dirname(process.execPath), 'data')
  : path.resolve(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'uploaded.json');
const MAX_RECENT = 50;

let serverUrl = '';
let authToken = null;
let uploaded = new Set();
let inflight = new Set();
let recentUploads = [];
let serverConnected = false;
let bulkProgress = null;

function loadUploaded() {
  try {
    uploaded = new Set(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch {
    uploaded = new Set();
  }
}

function saveUploaded() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify([...uploaded]));
}

function addRecent(filename, status) {
  recentUploads.unshift({ filename, status, timestamp: new Date().toISOString() });
  if (recentUploads.length > MAX_RECENT) recentUploads.pop();
}

function init(url, token) {
  serverUrl = url.replace(/\/$/, '');
  authToken = token || null;
  loadUploaded();
}

async function uploadFile(filePath) {
  const filename = path.basename(filePath);
  if (uploaded.has(filename) || inflight.has(filename)) return;

  inflight.add(filename);
  eventBus.emit('upload:start', { filename });

  const url = `${serverUrl}/api/upload`;
  const fileBuffer = await fs.promises.readFile(filePath);

  const boundary = `----HotsUpload${Date.now()}${Math.random().toString(36).slice(2)}`;
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="replay"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(header), fileBuffer, Buffer.from(footer)]);

  const headers = { 'Content-Type': `multipart/form-data; boundary=${boundary}` };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      if (res.status === 409) {
        uploaded.add(filename);
        inflight.delete(filename);
        saveUploaded();
        addRecent(filename, 'duplicate');
        eventBus.emit('upload:duplicate', { filename });
        console.log(`Duplicate: ${filename}`);
        return 'duplicate';
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      uploaded.add(filename);
      inflight.delete(filename);
      saveUploaded();
      addRecent(filename, 'success');
      eventBus.emit('upload:success', { filename });
      console.log(`Uploaded: ${filename}`);
      return true;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        const delay = attempt * 2000;
        console.warn(`Upload failed (attempt ${attempt}/3): ${filename} — retrying in ${delay / 1000}s...`);
        eventBus.emit('upload:fail', { filename, error: err.message, attempt, maxAttempts: 3 });
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  inflight.delete(filename);
  addRecent(filename, 'failed');
  eventBus.emit('upload:fail', { filename, error: lastErr.message, attempt: 3, maxAttempts: 3 });
  console.error(`Failed to upload ${filename} after 3 attempts:`, lastErr.message);
  return false;
}

async function scanAndUpload(replayDir) {
  const files = fs.readdirSync(replayDir).filter(f => f.endsWith('.StormReplay'));
  const toUpload = files.filter(f => !uploaded.has(f));

  if (toUpload.length === 0) {
    console.log(`All ${files.length} replays already uploaded.`);
    return;
  }

  console.log(`Uploading ${toUpload.length} new replays (${uploaded.size} already uploaded)...`);
  bulkProgress = { done: 0, failed: 0, duplicates: 0, total: toUpload.length };
  eventBus.emit('upload:progress', { ...bulkProgress });

  for (const file of toUpload) {
    const result = await uploadFile(path.join(replayDir, file));
    bulkProgress.done++;
    if (result === 'duplicate') bulkProgress.duplicates++;
    else if (!result) bulkProgress.failed++;
    eventBus.emit('upload:progress', { ...bulkProgress });
    if (bulkProgress.done % 50 === 0 || bulkProgress.done === bulkProgress.total) {
      console.log(`  ${bulkProgress.done}/${bulkProgress.total}`);
    }
  }

  bulkProgress = null;
}

function startConnectivityCheck() {
  async function check() {
    try {
      const res = await fetch(`${serverUrl}/api/modes`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!serverConnected) {
        serverConnected = true;
        eventBus.emit('server:connected', { serverUrl });
      }
    } catch {
      if (serverConnected) {
        serverConnected = false;
        eventBus.emit('server:disconnected', { serverUrl });
      }
    }
  }
  check();
  setInterval(check, 30000);
}

function getStatus() {
  return {
    serverConnected,
    serverUrl,
    uploadedCount: uploaded.size,
    recentUploads,
    bulkProgress,
  };
}

function isReady() {
  return Boolean(serverUrl);
}

module.exports = { init, uploadFile, scanAndUpload, startConnectivityCheck, getStatus, isReady };
