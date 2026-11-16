// Files that changed on disk lately, as the folder watchers saw them (memory.js). The Edit and Write tools go through Jade's
// permission tool, so those edits are known exactly; an edit made by a command (a script, sed, a redirect) is not. This remembers
// a path and when it last changed, so a run that ran a command can list what changed while it ran. Nothing else is kept.
import fs from 'node:fs';
import path from 'node:path';
import * as config from './config.js';

const seen = new Map(); // absolute path -> ms of the last event
const SKIP = /(^|[\\/])(\.git|\.state|node_modules|\.cache|\.venv|\.obsidian|\.trash|__pycache__)([\\/]|$)|(^|[\\/])~\$|\.(tmp|bak|lock|crdownload)$|\.bak-/i;
// Inside Jade's own data folder, only these are a person's files; the rest (projects, chats, attachments, scratch) is bookkeeping.
const OWN = new Set(['deliverables', 'agents', 'skills']);

export function note(abs) {
  const p = path.resolve(abs);
  if (SKIP.test(p)) return;
  seen.set(p, Date.now());
  if (seen.size > 4000) for (const k of [...seen.keys()].slice(0, 1000)) seen.delete(k);
}

/**
 * Files that changed from `sinceMs` on, are still there, and were really written after it (a sync that only touched a file is
 * not an edit). Returns [{ path, mtime }].
 */
export function since(sinceMs, untilMs = Infinity) {
  const home = config.JADE_HOME;
  const out = [];
  for (const [p, t] of seen) {
    if (t < sinceMs - 1000 || t > untilMs + 3000) continue;
    const rel = path.relative(home, p);
    const inHome = !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (inHome && !OWN.has(rel.split(path.sep)[0])) continue;
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile() || st.mtimeMs < sinceMs - 500) continue;
    out.push({ path: p, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => a.mtime - b.mtime);
}
