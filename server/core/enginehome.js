// With a gateway or a key (Bedrock included) Claude Code runs with a private config folder (provider.engineHome()) that has no
// login in it, so it cannot see the agents and skills in the user's own Claude Code folder. This puts them in view: each of
// <claude home>/agents and <claude home>/skills is linked into the private folder (a directory junction, which also works on
// Windows without admin rights), or copied when linking is not possible. It changes no argument and no environment variable.
//   - a link that points somewhere else is replaced; a real file or folder of someone else's is never deleted
//   - nothing happens when no private folder is in use (the plan sign-in uses the real folder as it is)
import fs from 'node:fs';
import path from 'node:path';
import * as provider from './provider.js';
import * as claudehome from './claudehome.js';
import { bus } from './bus.js';
import { debounce, writeText } from './util.js';

const NAMES = ['agents', 'skills'];
const MARK = '.jade-mirror.json';   // in a folder Jade filled by copying: the entries it wrote, so only those are ever replaced

const lstat = p => { try { return fs.lstatSync(p); } catch { return null; } };
const real = p => { try { return fs.realpathSync(p); } catch { return null; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
function removeLink(p) { try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); } }   // a junction is removed like a folder on Windows

function copyIn(target, dest) {
  const mark = path.join(dest, MARK);
  let mine = [];
  try { mine = JSON.parse(fs.readFileSync(mark, 'utf8')).entries || []; } catch {}
  // The mark is only a note in a folder a run may be able to edit, so it is not trusted: an entry is one plain name inside dest, never a path that leads out.
  for (const name of mine) {
    if (typeof name !== 'string' || !name || name === '.' || name === '..' || path.basename(name) !== name || name.includes('\\')) continue;
    const victim = path.resolve(dest, name);
    if (path.dirname(victim) !== path.resolve(dest)) continue;
    fs.rmSync(victim, { recursive: true, force: true });   // only what this code wrote
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = [];
  for (const name of fs.readdirSync(target)) {
    if (name === MARK || lstat(path.join(dest, name))) continue;   // never overwrite something that is not ours
    fs.cpSync(path.join(target, name), path.join(dest, name), { recursive: true, dereference: true });
    entries.push(name);
  }
  writeText(mark, JSON.stringify({ from: target, entries }));
}

/** Make `dest` show what `target` holds. Returns what was done: 'linked', 'ok', 'copied', 'removed' (stale link, source gone), 'absent' or 'kept'. */
export function mirror(target, dest) {
  target = path.resolve(target);
  const have = isDir(target);
  const st = lstat(dest);
  if (st?.isSymbolicLink()) {
    if (have && real(dest) && real(dest) === real(target)) return 'ok';
    removeLink(dest);   // stale: pointing somewhere else, or at a folder that is gone
    if (!have) return 'removed';
  } else if (st) {
    if (!st.isDirectory()) return 'kept';
    const marked = fs.existsSync(path.join(dest, MARK));
    if (marked) { if (!have) return 'kept'; copyIn(target, dest); return 'copied'; }
    // a real folder of its own: only an empty one may be replaced; anything in it stays where it is
    try { fs.rmdirSync(dest); } catch { return 'kept'; }
  }
  if (!have) return 'absent';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { fs.symlinkSync(target, dest, 'junction'); return 'linked'; }
  catch { try { copyIn(target, dest); return 'copied'; } catch { return 'kept'; } }
}

/** True when Claude Code is run with a private config folder (a gateway or key is set up). */
export const inUse = () => provider.style() === 'gateway';

/** Bring the private folder in line with the user's. Does nothing, and creates nothing, when no private folder is in use. */
export function sync() {
  if (!inUse()) return null;
  let priv;
  try { priv = provider.engineHome(); } catch { return null; }
  const home = claudehome.home();
  if (path.resolve(priv) === path.resolve(home)) return null;
  const out = {};
  for (const n of NAMES) { try { out[n] = mirror(path.join(home, n), path.join(priv, n)); } catch { out[n] = 'kept'; } }
  return out;
}

let started = false;
/** At boot, and whenever the agents or skills folders (or the provider) change. */
export function start() {
  if (started) return;
  started = true;
  sync();
  const again = debounce(() => sync(), 300);
  bus.on('event', e => { if (e.type === 'agents' || e.type === 'skills' || e.type === 'engines') again(); });
}
