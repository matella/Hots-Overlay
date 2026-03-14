const crypto = require('crypto');
const https = require('https');
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
 * PubSub message payload schema (type: 'new_game'):
 *
 * {
 *   type: 'new_game',
 *   game: {
 *     gameDate:  string,    // ISO 8601, e.g. "2024-03-14T21:00:00Z"
 *     map:       string,    // Map name, e.g. "Towers of Doom"
 *     mapImage:  string,    // Absolute CDN URL to map background image
 *     gameMode:  string,    // "Storm League" | "Quick Match" | "Unranked Draft" | ...
 *     duration:  number,    // Game length in seconds
 *     result:    string,    // "win" | "defeat"
 *     myTeam:    Player[],  // Broadcaster's team (5 players)
 *     theirTeam: Player[],  // Opposing team (5 players)
 *   }
 * }
 *
 * Player: {
 *   toonHandle:  string,   // e.g. "2-Hero-1-1234567"
 *   playerName:  string,   // Display name
 *   hero:        string,   // Full hero name, e.g. "Zeratul"
 *   heroShort:   string,   // Abbreviated name, e.g. "zeratul"
 *   heroImage:   string,   // Absolute CDN URL to hero portrait
 *   isMe:        boolean,  // true only for the broadcaster's own entry
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
// Returns the decoded payload, or throws on failure.
function verifyExtensionJWT(token) {
  if (!config.twitch.extensionSecret) {
    throw new Error('TWITCH_EXTENSION_SECRET not configured');
  }
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  const [header, payload, sig] = parts;
  const secret = Buffer.from(config.twitch.extensionSecret, 'base64');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    throw new Error('JWT signature mismatch');
  }

  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
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

module.exports = { verifyExtensionJWT, createEBSJWT, sendPubSubMessage };
