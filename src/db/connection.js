const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hots-overlay';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

mongoose.connection.on('connected', () => console.log('[mongodb] Ready'));
mongoose.connection.on('disconnected', () => console.log('[mongodb] Disconnected'));
mongoose.connection.on('error', err => console.error('[mongodb] Error:', err.message));

async function connect(attempt = 1) {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`[mongodb] Connected to ${MONGODB_URI}`);
  } catch (err) {
    console.error(`[mongodb] Connection failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      return connect(attempt + 1);
    }
    console.error('[mongodb] Max retries reached. Continuing without MongoDB.');
  }
}

async function disconnect() {
  await mongoose.disconnect();
}

module.exports = { connect, disconnect };
