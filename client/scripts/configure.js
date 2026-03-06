/**
 * Prebuild script — bakes SERVER_URL and AUTH_TOKEN into build/defaults.json.
 *
 * Usage:
 *   SERVER_URL=http://my-server:3001 AUTH_TOKEN=secret node scripts/configure.js
 *
 * Called automatically by `npm run dist`.
 */
const fs = require('fs');
const path = require('path');

const defaults = {};

if (process.env.SERVER_URL) {
  defaults.serverUrl = process.env.SERVER_URL;
}
if (process.env.AUTH_TOKEN) {
  defaults.authToken = process.env.AUTH_TOKEN;
}

if (!defaults.serverUrl) {
  console.error('ERROR: SERVER_URL environment variable is required to build.');
  console.error('Usage: SERVER_URL=http://your-server:3001 AUTH_TOKEN=secret npm run dist');
  process.exit(1);
}

const outDir = path.resolve(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });

const outFile = path.join(outDir, 'defaults.json');
fs.writeFileSync(outFile, JSON.stringify(defaults, null, 2));

console.log(`Build defaults written to ${outFile}`);
console.log(`  serverUrl: ${defaults.serverUrl}`);
console.log(`  authToken: ${defaults.authToken ? '(set)' : '(none)'}`);
