/**
 * OnlyFans request signing.
 *
 * Every OnlyFans API call has to carry a `sign` header, a matching `time`, a
 * static `app-token`, and an `x-bc` device identifier. This module computes
 * them.
 *
 *   sign = [prefix, sha1(salt \n time \n path \n userId), checksum, suffix]
 *
 * where `checksum` is a sum over specific character positions of that SHA-1,
 * taken modulo the hash length, each with a fixed offset, rendered as hex.
 *
 * The constants below (salt, prefix, suffix, offsets) are not ours and are not
 * secret: they are interoperability parameters, in the same sense as a
 * protocol's magic numbers. You cannot form a valid request without them. They
 * are also not stable — OnlyFans rotates them, and when they do, every request
 * starts failing until these are updated. That is the single most common way
 * this software breaks. If signed calls suddenly return 400/401 across every
 * account at once, suspect these first and check the repository's issues.
 *
 * Usage:
 *   const { generateSignHeaders } = require('./onlyfans-sign-generator.js');
 *   const headers = generateSignHeaders('/api2/v2/users/me', 509955039);
 */

'use strict';

const crypto = require('crypto');

// ---- Signing parameters -----------------------------------------------------
// Update together; they are versioned as a set by the platform.

const SALT = 'sg05QxRnvJhQz5FWIIpsI1Q1DR1DYsnp';
const PREFIX = '51940';
const SUFFIX = '694199a1';
const APP_TOKEN = '33d57ade8c02dbc5a333db99ff9ae26a';

// [index, offset] pairs. `index` is taken modulo the hash length; `offset` is
// added to the character code found there. The sum, absolute and in hex, is the
// checksum segment of the signature.
const CHECKSUM_TERMS = [
  [52366, -103], [53185, -74], [54279, 127], [54077, 139], [53590, 144],
  [52483, -52], [53967, 133], [52565, 103], [54564, -107], [53415, 77],
  [53671, -88], [52885, -94], [54461, 77], [53849, 99], [54159, 97],
  [54413, -66], [52052, 132], [53000, -123], [52162, 112], [52277, -136],
  [53345, -88], [53258, -83], [54360, -105], [53468, -81], [52682, -59],
  [54679, -138], [52434, 86], [52633, 93], [52763, -108], [53775, 119],
  [53112, 136], [52812, -61],
];

// ---- Implementation ---------------------------------------------------------

function sha1Hex(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex');
}

function checksum(hash) {
  let total = 0;
  for (const [index, offset] of CHECKSUM_TERMS) {
    total += hash[index % hash.length].charCodeAt(0) + offset;
  }
  return Math.abs(total).toString(16);
}

/**
 * Generate the signed headers for one OnlyFans API request.
 *
 * @param {string} apiPath  Endpoint path including query string,
 *                          e.g. '/api2/v2/users/notifications?limit=10'
 * @param {number|string|null} userId  Authenticated user id, or 0 when
 *                          unauthenticated (the login flow).
 * @param {object} [options]
 * @param {number} [options.timestamp]  Override the timestamp, in milliseconds.
 *                          Only useful for reproducible tests.
 * @returns {{sign: string, time: string, 'app-token': string, 'x-bc': string}}
 */
function generateSignHeaders(apiPath, userId = null, options = {}) {
  if (typeof apiPath !== 'string' || !apiPath) {
    throw new TypeError('apiPath is required and must be a string');
  }

  const authUserId = userId || 0;
  const time = options.timestamp || Date.now();

  // The signed message is these four fields, newline-joined, in this order.
  const message = [SALT, time, apiPath, authUserId].join('\n');
  const hash = sha1Hex(message);
  const sign = [PREFIX, hash, checksum(hash), SUFFIX].join(':');

  // x-bc identifies the "device". It is a SHA-1 over the timestamp, random
  // bytes and a constant; it only has to be stable-looking, not reproducible.
  const xbc = sha1Hex(`${time}${crypto.randomBytes(8).toString('hex')}01`);

  return {
    sign,
    time: String(time),
    'app-token': APP_TOKEN,
    'x-bc': xbc,
  };
}

module.exports = { generateSignHeaders };

// ---- CLI --------------------------------------------------------------------
// header_generator.py shells out to this: `node onlyfans-sign-generator.js <path> [userId]`

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
OnlyFans sign header generator

Usage:
  node onlyfans-sign-generator.js <path> [userId] [--timestamp=<ms>]

Arguments:
  path         API endpoint path, including query string (required)
  userId       Authenticated OnlyFans user id (optional, defaults to 0)
  --timestamp  Override the timestamp in milliseconds (optional, for tests)

Examples:
  node onlyfans-sign-generator.js "/api2/v2/users/me" 509955039
  node onlyfans-sign-generator.js "/api2/v2/posts"
`);
    process.exit(args.length === 0 ? 1 : 0);
  }

  const positional = args.filter((a) => !a.startsWith('--'));
  const tsArg = args.find((a) => a.startsWith('--timestamp='));

  const headers = generateSignHeaders(
    positional[0],
    positional[1] ? Number(positional[1]) : 0,
    tsArg ? { timestamp: Number(tsArg.split('=')[1]) } : {},
  );

  console.log(JSON.stringify(headers));
}
