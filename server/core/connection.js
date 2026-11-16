// The server's own record that Claude answered a test question with the provider settings as they are now. Set-up reads it
// before it may finish, so it cannot be skipped by calling the route directly. It is tied to the settings themselves (a
// fingerprint of the engine file), so any change to how Claude Code reaches Claude makes it stale; saving the settings also clears it.
import fs from 'node:fs';
import { writeText } from './util.js';
import path from 'node:path';
import crypto from 'node:crypto';
import * as config from './config.js';
import * as provider from './provider.js';

const FILE = () => path.join(config.STATE, 'connection-test.json');
const fingerprint = () => {
  const e = provider.read();
  return crypto.createHash('sha256').update(JSON.stringify(Object.keys(e).sort().map(k => [k, e[k]]))).digest('hex');
};

/** Remember the outcome of a test of the current settings. Only a success is kept. */
export function record(ok) {
  if (!ok) return clear();
  writeText(FILE(), JSON.stringify({ at: new Date().toISOString(), fingerprint: fingerprint() }));
}
export function clear() { try { fs.rmSync(FILE(), { force: true }); } catch {} }
/** True when the last test succeeded with exactly the settings in force now. */
export function passed() {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')).fingerprint === fingerprint(); } catch { return false; }
}
