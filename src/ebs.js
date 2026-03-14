const crypto = require('crypto');
const https = require('https');
const jwt = require('jsonwebtoken');
const config = require('./config');

/**
 * Extension Backend Service (EBS) module.
 *
 * Handles all Twitch EBS concerns:
 *   - JWT creation for authenticating against Twitch APIs (EBS role)
 *   - JWT verification for validating tokens from extension viewers
 *   - PubSub broadcasting with rate limiting and payload size enforcement
 *
 * Architectural decisions:
 *   - Single server (no separate process): complexity doesn't warrant IPC overhead
 *   - Event-driven (no polling): chokidar file watcher fires on new .StormReplay files
 *   - Rate limiting: per-channel queue draining at 1-second intervals (Twitch limit)
 *
 * PubSub message payload schema (type: 'session_stats'):
 *
 * {
 *   type: 'session_stats',
 *   session: {
 *     wins:    number,       // Wins in today's session
 *     losses:  number,       // Losses in today's session
 *     winRate: number,       // Win percentage (0–100)
 *     heroes:  HeroEntry[],  // Heroes played today, most-recent-first (one per game)
 *   }
 * }
 *
 * HeroEntry: {
 *   hero:      string,   // Full hero name, e.g. "Zeratul"
 *   heroShort: string,   // Abbreviated name, e.g. "zeratul"
 *   heroImage: string,   // Absolute CDN URL to hero portrait
 *   win:       boolean,  // Whether that game was a win
 * }
 *
 * Twitch PubSub constraints:
 *   - Max payload: 5KB (enforced by sendPubSubMessage before enqueue)
 *   - Rate limit: 1 message/second per channel (enforced by queue drain)
 */

const PUBSUB_MAX_BYTES = 5 * 1024; // 5KB Twitch limit on the inner message field

// Per-channel queue state: Map<channelId, { queue: Array<{messageObj, resolve, reject}>, draining: boolean }>
const _queues = new Map();

// Verify a JWT signed by the Twitch Extension Helper (HS256).
// The extension secret from the Twitch Developer Console is base64-encoded.
// Returns the decoded payload ({ channel_id, user_id, role, ... }), or throws on failure.
function verifyExtensionJWT(token) {
  if (!config.twitch.extensionSecret) {
    throw new Error('TWITCH_EXTENSION_SECRET not configured');
  }
  const secret = Buffer.from(config.twitch.extensionSecret, 'base64');
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
}

// Create a short-lived JWT for the EBS to authenticate against Twitch's APIs.
// The token grants permission to broadcast a PubSub message to the given channel.
function createEBSJWT(channelId) {
  const secret = Buffer.from(config.twitch.extensionSecret, 'base64');
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    exp: now + 60,
    user_id: config.twitch.broadcasterId,
    role: 'external',
    channel_id: channelId,
    pubsub_perms: { send: ['broadcast'] },
  })).toString('base64url');

  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${sig}`;
}

// Private: raw HTTP POST to Twitch PubSub API. Returns a Promise.
function _doSendPubSubMessage(channelId, messageObj) {
  return new Promise((resolve, reject) => {
    if (!config.twitch.clientId || !config.twitch.extensionSecret) {
      return reject(new Error('Twitch extension credentials (TWITCH_CLIENT_ID, TWITCH_EXTENSION_SECRET) not configured'));
    }

    console.log(`[ebs] sending PubSub to channel ${channelId}`);
    const jwt = createEBSJWT(channelId);
    const body = JSON.stringify({
      target: ['broadcast'],
      broadcaster_id: channelId,
      is_global_broadcast: false,
      message: JSON.stringify(messageObj),
    });

    const req = https.request(
      {
        hostname: 'api.twitch.tv',
        path: '/helix/extensions/pubsub',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Client-Id': config.twitch.clientId,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[ebs] PubSub sent to channel ${channelId} (HTTP ${res.statusCode})`);
            resolve();
          } else {
            reject(new Error(`Twitch PubSub ${res.statusCode}: ${data}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Private: drain the per-channel queue at 1-second intervals.
function _drainQueue(channelId) {
  const state = _queues.get(channelId);
  if (!state || state.queue.length === 0) {
    if (state) state.draining = false;
    return;
  }
  state.draining = true;
  const { messageObj, resolve, reject } = state.queue.shift();
  _doSendPubSubMessage(channelId, messageObj)
    .then(resolve, reject)
    .finally(() => setTimeout(() => _drainQueue(channelId), 1000));
}

// Broadcast a message to all viewers with the extension active on the given channel.
// Enforces the 5KB payload limit and 1 msg/sec rate limit via a per-channel queue.
function sendPubSubMessage(channelId, messageObj) {
  return new Promise((resolve, reject) => {
    const messageStr = JSON.stringify(messageObj);
    const byteSize = Buffer.byteLength(messageStr, 'utf8');
    if (byteSize > PUBSUB_MAX_BYTES) {
      return reject(new Error(`PubSub payload exceeds 5KB limit (${byteSize} bytes)`));
    }

    if (!_queues.has(channelId)) {
      _queues.set(channelId, { queue: [], draining: false });
    }
    const state = _queues.get(channelId);
    state.queue.push({ messageObj, resolve, reject });
    console.log(`[ebs] queued PubSub for channel ${channelId} (queue depth: ${state.queue.length})`);

    if (!state.draining) {
      _drainQueue(channelId);
    }
  });
}

// ─── Data fetcher ─────────────────────────────────────────────────────────────
//
// startDataFetcher connects the EBS to the HotS Overlay server:
//   1. On startup: fetches GET /api/today and broadcasts initial session stats
//   2. Subscribes to the server's WebSocket for real-time new_game events
//   3. On each new_game: re-fetches /api/today and re-broadcasts PubSub
//   4. Reconnects WebSocket on disconnect with exponential backoff

function _fetchTodayStats(baseUrl, toonHandle, gameMode) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams();
    if (toonHandle) params.set('player', toonHandle);
    if (gameMode)   params.set('mode', gameMode);
    const qs = params.toString();
    const url = `${baseUrl}/api/today${qs ? '?' + qs : ''}`;
    const mod = url.startsWith('https') ? require('https') : require('http');
    const req = mod.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
  });
}

function _buildPubSubPayload(apiResponse) {
  const { games = [], stats = {} } = apiResponse;
  return {
    type: 'session_stats',
    session: {
      wins:    stats.wins    ?? 0,
      losses:  stats.losses  ?? 0,
      winRate: stats.winRate ?? 0,
      // games is already most-recent-first (ORDER BY game_date DESC)
      heroes: games.map(g => ({
        hero:      g.hero,
        heroShort: g.heroShort,
        heroImage: g.heroImage,
        win:       Boolean(g.win),
      })),
    },
  };
}

function _fetchAndBroadcast(baseUrl, channelId, toonHandle, gameMode) {
  _fetchTodayStats(baseUrl, toonHandle, gameMode)
    .then(data => sendPubSubMessage(channelId, _buildPubSubPayload(data)))
    .catch(err => console.error('[ebs] fetch/broadcast failed:', err.message));
}

const _WS_BACKOFF = [2000, 5000, 15000, 30000];

// Start fetching game data from the HotS Overlay server and forwarding to Twitch PubSub.
// Call this once after the HTTP server is listening (so /api/today and the WebSocket are ready).
function startDataFetcher(baseUrl, channelId, toonHandle, gameMode) {
  console.log(`[ebs] startDataFetcher baseUrl=${baseUrl} channel=${channelId}`);
  _fetchAndBroadcast(baseUrl, channelId, toonHandle, gameMode);

  let attempt = 0;
  function connect() {
    const WebSocket = require('ws');
    const wsUrl = baseUrl.replace(/^http/, 'ws');
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('[ebs] WebSocket connected to overlay server');
      attempt = 0;
    });

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'new_game') {
          console.log('[ebs] new_game event — re-fetching /api/today');
          _fetchAndBroadcast(baseUrl, channelId, toonHandle, gameMode);
        }
      } catch {}
    });

    ws.on('close', () => {
      const delay = _WS_BACKOFF[Math.min(attempt++, _WS_BACKOFF.length - 1)];
      console.warn(`[ebs] WS closed, reconnecting in ${delay}ms`);
      setTimeout(connect, delay);
    });

    ws.on('error', err => console.error('[ebs] WS error:', err.message));
  }

  connect();
}

module.exports = { verifyExtensionJWT, createEBSJWT, sendPubSubMessage, startDataFetcher };
