// Local sign-in for QA Hub.
//
// Passwords are never stored in plain text. scripts/create-users.js writes
// data/users.local.json (git-ignored) with a per-user random salt and a PBKDF2-SHA256 hash.
// The browser hashes what the user types the same way and compares.
//
// IMPORTANT: this is a front door, not security. There is no server, so anyone with the
// files or DevTools can bypass it, and the hash file can be brute-forced offline if it
// leaks. Use strong, unique passwords and never commit data/users.local.json.

export const CREDENTIALS_URL = 'data/users.local.json';
export const PBKDF2_ITERATIONS = 210000;
const SESSION_KEY = 'qahub:session';
const FAIL_KEY = 'qahub:loginFailures';
const REMEMBER_HOURS = 12;

const subtle = () => globalThis.crypto?.subtle;
const enc = new TextEncoder();

export const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));

export async function hashPassword(password, saltHex, iterations = PBKDF2_ITERATIONS) {
  if (!subtle()) throw new Error('This browser has no Web Crypto support (use http://localhost or https).');
  const key = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256);
  return toHex(bits);
}

export function randomSalt(bytes = 16) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return toHex(a);
}

/** Constant-time-ish comparison of two hex strings. */
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns the credential file, or null when none is configured. */
export async function loadCredentials(fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(CREDENTIALS_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json?.users) || !json.users.length) return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Check a username/password pair.
 * @returns {Promise<{ok:true, memberId:string, username:string}|{ok:false, reason:string}>}
 */
export async function verifyLogin(creds, username, password) {
  const name = String(username || '').trim().toLowerCase();
  const user = creds.users.find((u) => u.username.toLowerCase() === name);
  // Always hash, even for unknown users, so timing does not reveal which usernames exist.
  const salt = user?.salt || '00'.repeat(16);
  const hash = await hashPassword(String(password || ''), salt, user?.iterations || creds.iterations || PBKDF2_ITERATIONS);
  if (!user || !sameHex(hash, user.hash)) return { ok: false, reason: 'Please check your username and password and try again.' };
  return { ok: true, memberId: user.memberId, username: user.username };
}

// ---- brute-force slow-down (per browser; a convenience, not protection) -----------------
export function lockoutRemaining(now = Date.now()) {
  try {
    const f = JSON.parse(localStorage.getItem(FAIL_KEY) || '{}');
    return f.until && f.until > now ? Math.ceil((f.until - now) / 1000) : 0;
  } catch { return 0; }
}

export function recordFailure(now = Date.now()) {
  try {
    const f = JSON.parse(localStorage.getItem(FAIL_KEY) || '{}');
    const count = (f.count || 0) + 1;
    const until = count >= 5 ? now + Math.min(300, 15 * 2 ** (count - 5)) * 1000 : 0;
    localStorage.setItem(FAIL_KEY, JSON.stringify({ count, until }));
  } catch { /* storage blocked */ }
}

export function clearFailures() {
  try { localStorage.removeItem(FAIL_KEY); } catch { /* ignore */ }
}

// ---- session ----------------------------------------------------------------------------
export function saveSession({ memberId, username }, remember = false) {
  const session = { memberId, username, at: Date.now(), until: remember ? Date.now() + REMEMBER_HOURS * 3600e3 : null };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    if (remember) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* storage blocked: session lasts for this page only */ }
  return session;
}

export function readSession(now = Date.now()) {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (s?.memberId) return s;
    const r = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (r?.memberId && r.until > now) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(r));
      return r;
    }
    if (r) localStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
  return null;
}

export function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}
