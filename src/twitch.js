const crypto = require('crypto');
const https = require('https');
const config = require('./config');

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

// Broadcast a message to all viewers with the extension active on the given channel.
// messageObj is serialized to JSON; Twitch PubSub max payload is 5KB.
// Rate limit: 1 message/second per channel.
function sendPubSubMessage(channelId, messageObj) {
  return new Promise((resolve, reject) => {
    if (!config.twitch.clientId || !config.twitch.extensionSecret) {
      return reject(new Error('Twitch extension credentials (TWITCH_CLIENT_ID, TWITCH_EXTENSION_SECRET) not configured'));
    }

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

module.exports = { verifyExtensionJWT, sendPubSubMessage };
