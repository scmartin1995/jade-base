// The server's shared secret (the "key"). Every write, and every read of the user's data, must carry it. It is only ever given to a
// caller that already has it: the start link `http://127.0.0.1:<port>/?key=<key>` (printed in the terminal at start, opened by the launchers)
// sets the cookie and answers with a tiny page that moves on to / (not a redirect: see ADR 0005); the app page, which carries the key in a meta tag, is served only to a caller with that cookie.
// The bridge and the permission tool read the key from <data folder>/.state/token (owner-only, in a folder only this user can enter).
// The key is never put in a Claude run's environment or in the per-run tool settings: the permission tool is told where the state folder is
// and reads the file itself. A run's own file tools are refused that folder, and a shell command that names it asks first.
// This keeps out other user accounts and other programs that cannot read this user's files. A program running as the same user can read
// the key file, so it is not kept out.
// JADE_TOKEN in the environment overrides it (a launcher or a test that starts the server itself).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as config from './config.js';

let cached = '';
/** Make a folder (and its parents) that only this user can enter. On Windows the mode is ignored. */
export function privateDir(d) {
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(d, 0o700); } catch { /* not supported here */ }
  return d;
}
const file = () => path.join(config.STATE, 'token');

/** The token: from the environment, else the file (made once, kept across restarts so an open window keeps working). */
export function token() {
  if (process.env.JADE_TOKEN) return process.env.JADE_TOKEN;
  if (cached) return cached;
  try { const t = fs.readFileSync(file(), 'utf8').trim(); if (t.length >= 32) return (cached = t); } catch { /* make one */ }
  cached = crypto.randomBytes(24).toString('hex');
  privateDir(config.STATE);
  fs.writeFileSync(file(), cached, { mode: 0o600 });
  try { fs.chmodSync(file(), 0o600); } catch { /* not supported here */ }
  return cached;
}

/**
 * Make sure the key file holds the key in use, so the permission tool (which reads the file, not the environment) can find it.
 * Matters only when the key came from JADE_TOKEN, which otherwise never touches the file.
 */
export function share() {
  const t = token();
  privateDir(config.STATE);
  let have = ''; try { have = fs.readFileSync(file(), 'utf8').trim(); } catch { /* none yet */ }
  if (have !== t) { fs.writeFileSync(file(), t, { mode: 0o600 }); try { fs.chmodSync(file(), 0o600); } catch { /* not supported here */ } }
  return file();
}

export const same = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookieOf = req => { const m = /(?:^|;\s*)jade=([^;]+)/.exec(req.headers.cookie || ''); return m ? decodeURIComponent(m[1]) : ''; };

/** A request that changes something: the header only (a cookie is sent by other sites too). */
export const okWrite = req => same(req.headers['x-jade'], token());
/** A request that reads the user's data: the header, or the cookie the page set (pictures and the event stream cannot send a header). */
export const okRead = req => okWrite(req) || same(cookieOf(req), token());
export const cookie = () => `jade=${token()}; Path=/; HttpOnly; SameSite=Strict`;
/** Does this request carry the key in the cookie (what the app page needs)? */
export const hasCookie = req => same(cookieOf(req), token());
/** Is this what a person pasted the key: the key itself, or the whole start link? Constant-time compare. */
export const keyOk = pasted => {
  let v = String(pasted ?? '').trim();
  const m = /[?&]key=([^&#\s]+)/.exec(v);
  if (m) { try { v = decodeURIComponent(m[1]); } catch { v = m[1]; } }
  return same(v, token());
};
export const startLink = port => `http://127.0.0.1:${port}/?key=${token()}`;
