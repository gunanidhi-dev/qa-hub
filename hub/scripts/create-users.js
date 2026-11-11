// Creates data/users.local.json (git-ignored) holding salted PBKDF2-SHA256 hashes only.
//
// Usage:
//   node scripts/create-users.js path/to/users.txt      # one "username:password" per line
//   node scripts/create-users.js < users.txt
//   node scripts/create-users.js --add path/to/new-users.txt   # keep existing users, add/replace these
//
// The input file holds plain-text passwords: keep it outside the repository and delete it
// after running. Usernames must match a member ID in data/library.json (e.g. "gunanidhi").
// Re-running replaces the whole credential file.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { hashPassword, randomSalt, PBKDF2_ITERATIONS } from '../js/auth.js';

const OUT = 'data/users.local.json';
const LIBRARY = 'data/library.json';

const ADD = process.argv.includes('--add');
const src = process.argv.slice(2).find((a) => a !== '--add');
const text = src ? readFileSync(src, 'utf8') : readFileSync(0, 'utf8');
const memberIds = existsSync(LIBRARY) ? new Set(JSON.parse(readFileSync(LIBRARY, 'utf8')).members.map((m) => m.id)) : null;

const users = [];
for (const raw of text.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const i = line.indexOf(':');
  if (i < 1) { console.error('Skipped a line without "username:password".'); continue; }
  const username = line.slice(0, i).trim().toLowerCase();
  const password = line.slice(i + 1);
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) { console.error(`Skipped invalid username "${username}".`); continue; }
  if (password.length < 8) console.warn(`Warning: password for ${username} is shorter than 8 characters.`);
  const memberId = `mbr-${username}`;
  if (memberIds && !memberIds.has(memberId)) console.warn(`Warning: ${memberId} is not a member in ${LIBRARY}.`);
  const salt = randomSalt();
  users.push({ username, memberId, salt, hash: await hashPassword(password, salt, PBKDF2_ITERATIONS), iterations: PBKDF2_ITERATIONS });
}

if (!users.length) { console.error('No users read.'); process.exit(1); }
if (ADD && existsSync(OUT)) {
  const names = new Set(users.map((u) => u.username));
  const kept = JSON.parse(readFileSync(OUT, 'utf8')).users.filter((u) => !names.has(u.username));
  users.unshift(...kept);
}
writeFileSync(OUT, `${JSON.stringify({ algorithm: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, users }, null, 2)}\n`);
console.log(`Wrote ${OUT} with ${users.length} user(s): ${users.map((u) => u.username).join(', ')}. No plain-text passwords stored.`);
