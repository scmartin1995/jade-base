// "Allow this to work on its own": the PM's yes for one agent file or one skill folder that comes from a project or a plugin. Kept in the
// data folder by the file's real path (a link or a second copy of the folder does not share one), together with a hash of what the PM
// saw, so a file that has changed since (a git pull, a plugin refresh, a swapped link) is not allowed any more until it is allowed again.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as config from './config.js';
import { readJSON, writeJSON } from './util.js';

const FILE = () => path.join(config.STATE, 'agents-allowed.json');
export const sha = b => crypto.createHash('sha256').update(b).digest('hex');
let cache = { stamp: '', files: {} };
function all() {
  let stamp = '';
  try { const st = fs.statSync(FILE()); stamp = `${st.mtimeMs}:${st.size}`; } catch { /* none yet */ }
  if (stamp !== cache.stamp) cache = { stamp, files: stamp ? (readJSON(FILE(), {}).files || {}) : {} };
  return cache.files;
}
/** The key for a file or folder: its real path (the path as given when it is not there). */
export const keyOf = f => { const p = path.resolve(String(f || '')); try { return fs.realpathSync(p); } catch { return p; } };
/** The hash of a folder's files (names and bytes, at most 200 files and 4 MB), or of one file. */
export function hashOf(target) {
  const h = crypto.createHash('sha256');
  let n = 0, bytes = 0;
  const walk = (p, rel) => {
    let st; try { st = fs.lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) { h.update('link:' + rel); return; }
    if (st.isDirectory()) { for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e), rel + '/' + e); return; }
    if (!st.isFile() || ++n > 200 || (bytes += st.size) > 4 * 1024 * 1024) return;
    h.update('file:' + rel + '\0'); h.update(fs.readFileSync(p)); h.update('\0');
  };
  walk(target, '');
  return h.digest('hex');
}
/** Every allowance: { <real path>: { at, hash, skills? } }. */
export const entries = () => ({ ...all() });
/** 'none' (never allowed), 'ok' (allowed and the same as then), 'changed' (allowed once, but the file or a skill it uses is different now). */
export function status(file, hashOf_, skillsOf = {}) {
  const r = all()[keyOf(file)];
  if (!r) return 'none';
  const hash = typeof hashOf_ === 'function' ? hashOf_() : hashOf_, skills = typeof skillsOf === 'function' ? skillsOf() : skillsOf;
  if (!r.hash || r.hash !== hash) return 'changed';
  const want = r.skills || {};
  const names = new Set([...Object.keys(want), ...Object.keys(skills)]);
  for (const k of names) if (want[k] !== skills[k]) return 'changed';
  return 'ok';
}
export function put(file, hash, skills = {}) {
  writeJSON(FILE(), { files: { ...all(), [keyOf(file)]: { at: new Date().toISOString(), hash, ...(Object.keys(skills).length ? { skills } : {}) } } }); cache.stamp = '';
}
export function drop(file) {
  const files = { ...all() }; delete files[keyOf(file)];
  writeJSON(FILE(), { files }); cache.stamp = '';
}
