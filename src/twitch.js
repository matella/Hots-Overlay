// Backward compatibility shim — all EBS logic has moved to src/ebs.js.
// Existing imports (e.g. routes.js) continue to work unchanged.
const ebs = require('./ebs');
module.exports = ebs;
