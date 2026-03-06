require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const REPLAY_DIR = process.env.REPLAY_DIR;
const SERVER_URL = process.env.SERVER_URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN || null;
const DATA_FILE = path.resolve(__dirname, 'data', 'uploaded.json');

for (const [key, val] of [['REPLAY_DIR', REPLAY_DIR], ['SERVER_URL', SERVER_URL]]) {
  if (!val) {
    console.error(`Missing required env var: ${key}. Check your .env file.`);
    process.exit(1);
  }
}

// --- Tracking ---

function loadUploaded() {
  try {
    return new Set(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch {
    return new Set();
  }
}

function saveUploaded(set) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify([...set]));
}

const uploaded = loadUploaded();

// --- Upload ---

async function uploadFile(filePath) {
  const filename = path.basename(filePath);
  if (uploaded.has(filename)) return;

  const url = `${SERVER_URL.replace(/\/$/, '')}/api/upload`;
  const fileBuffer = fs.readFileSync(filePath);

  // Build multipart/form-data manually (no extra dependency)
  const boundary = `----HotsUpload${Date.now()}`;
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="replay"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(header), fileBuffer, Buffer.from(footer)]);

  const headers = { 'Content-Type': `multipart/form-data; boundary=${boundary}` };
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      uploaded.add(filename);
      saveUploaded(uploaded);
      console.log(`Uploaded: ${filename}`);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        const delay = attempt * 2000;
        console.warn(`Upload failed (attempt ${attempt}/3): ${filename} — retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  console.error(`Failed to upload ${filename} after 3 attempts:`, lastErr.message);
}

// --- Initial scan ---

async function scanExisting() {
  const files = fs.readdirSync(REPLAY_DIR).filter(f => f.endsWith('.StormReplay'));
  const toUpload = files.filter(f => !uploaded.has(f));

  if (toUpload.length === 0) {
    console.log(`All ${files.length} replays already uploaded.`);
    return;
  }

  console.log(`Uploading ${toUpload.length} new replays (${uploaded.size} already uploaded)...`);
  let done = 0;
  for (const file of toUpload) {
    await uploadFile(path.join(REPLAY_DIR, file));
    done++;
    if (done % 50 === 0 || done === toUpload.length) {
      console.log(`  ${done}/${toUpload.length}`);
    }
  }
}

// --- Watcher ---

function startWatcher() {
  const watcher = chokidar.watch(
    path.join(REPLAY_DIR, '*.StormReplay'),
    {
      persistent: true,
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 1000 },
    }
  );

  watcher.on('add', (filePath) => {
    console.log(`New replay detected: ${path.basename(filePath)}`);
    uploadFile(filePath);
  });

  watcher.on('error', (err) => console.error('Watcher error:', err));
  console.log('Watching for new replays...');
}

// --- Main ---

async function main() {
  console.log(`Server: ${SERVER_URL}`);
  console.log(`Replays: ${REPLAY_DIR}`);

  await scanExisting();
  startWatcher();
}

main();
