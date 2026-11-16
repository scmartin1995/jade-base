// Small helpers shared by the server. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const isWin = process.platform === 'win32';
export const home = os.homedir();

export function expand(p) {
  if (!p) return p;
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return path.resolve(p);
}

/** A title made into a file name: no characters a file system refuses, no leading dots, one space between words, at most `max` characters; `fallback` when nothing is left.
 *  (transcripts.js has its own safeName for an uploaded file's name: it keeps the extension and also enforces Windows device names and a byte limit.) */
export const safeName = (s, fallback = 'Item', max = 80) => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, max) || fallback;

export function id(prefix = '') {
  return prefix + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'item';
}

export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }

export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Atomic write so a file watcher never sees a half-written file.
export function writeJSON(file, data) {
  writeText(file, JSON.stringify(data, null, 2));
}

// The one writer for every file Jade saves: written to a temporary file beside it, flushed to disk, then renamed over the old one, so
// a crash or a second save a moment later leaves the old file or the new one, never half of one. The temporary name starts with a
// dot and ends in .tmp (folder watchers ignore both) and is removed again if anything fails. Returns what the new file looks like
// (size, modified time, file number), so a caller that remembers the content can tell later whether someone else changed it.
let tmpSeq = 0;
export function writeText(file, text, { mode } = {}) {
  const dir = ensureDir(path.dirname(file));
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${++tmpSeq}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'w', mode);
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
    const st = fs.fstatSync(fd);   // a rename keeps the file number and modified time, so this is what the saved file will be
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
    return st;
  } catch (e) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw e;
  }
}

export function today(d = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// --- Frontmatter: a deliberately small YAML subset (scalars, [inline lists], "- " lists, one level of nesting).
function scalar(v) {
  v = v.trim();
  if (v === '') return '';
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    try { return v.startsWith('"') ? JSON.parse(v) : v.slice(1, -1); } catch { return v.slice(1, -1); }
  }
  if (v.startsWith('[') && v.endsWith(']')) return v.slice(1, -1).split(',').map(s => scalar(s)).filter(s => s !== '');
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  let key = null, parent = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (line.startsWith('- ') && key) {
      const target = parent && indent > 2 && key !== parent ? data[parent] : data;
      if (!Array.isArray(target[key])) target[key] = [];
      target[key].push(scalar(line.slice(2)));
      continue;
    }
    const kv = /^([\w.-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (indent > 0 && parent) {
      key = kv[1];
      data[parent][key] = scalar(kv[2]);
    } else {
      key = kv[1];
      if (kv[2] === '') { data[key] = {}; parent = key; }
      else { data[key] = scalar(kv[2]); parent = null; }
    }
  }
  return { data, body: text.slice(m[0].length) };
}

function dumpScalar(v) {
  if (Array.isArray(v)) return '[' + v.map(dumpScalar).join(', ') + ']';
  if (typeof v === 'string' && (/[:#\[\],"]|^\s|\s$|^(true|false|null|-?\d+(\.\d+)?)$/.test(v) || v === '')) return JSON.stringify(v);
  return String(v);
}

export function stringifyFrontmatter(data, body = '') {
  const lines = ['---'];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v)) lines.push(`  ${k2}: ${dumpScalar(v2)}`);
    } else lines.push(`${k}: ${dumpScalar(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n') + body;
}

// Pull the first JSON object/array out of a model reply (fenced or bare).
export function extractJSON(text, fence = 'json') {
  if (!text) return null;
  const tryParse = s => { try { return JSON.parse(s); } catch { return undefined; } };
  const re = new RegExp('```' + fence + '\\s*([\\s\\S]*?)```', 'i');
  const f = re.exec(text);
  if (f) { const v = tryParse(f[1].trim()); if (v !== undefined) return v; }
  for (const open of ['{', '[']) {
    const close = open === '{' ? '}' : ']';
    const start = text.indexOf(open);
    if (start < 0) continue;
    for (let end = text.lastIndexOf(close); end > start; end = text.lastIndexOf(close, end - 1)) {
      const v = tryParse(text.slice(start, end + 1));
      if (v !== undefined) return v;
    }
  }
  return null;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * Watch a folder tree and call cb(relativePath) on any change. macOS and Windows have reliable native recursive
 * watching. On Linux, Node's recursive watcher loses files that editors save atomically (write temp + rename),
 * so there we watch each directory instead, which sees renames, and pick up new subfolders as they appear.
 * Putting the watches in place never holds the server up: a big tree is registered in short turns (a small one is done
 * before this returns). `onReady()` is called once every folder is being watched; a change made before that is not seen,
 * so a caller that cares looks again when it is told.
 */
export function watchTree(root, cb, { skip = /(^|[\\/])(\.git|node_modules|\.cache|\.venv)([\\/]|$)/, maxDirs = 3000, onReady } = {}) {
  const noop = () => {}; noop.trusted = () => false;
  if (!fs.existsSync(root)) { if (onReady) setImmediate(onReady); return noop; }
  const watchers = new Map(), inodes = new Map();
  let closed = false, timer = null, doubt = false, rootAt = 0;
  const ready = () => { if (onReady) setImmediate(() => { if (!closed) onReady(); }); };
  const rel = p => path.relative(root, p);
  const inodeOf = dir => { try { return fs.statSync(dir).ino; } catch { return -1; } };
  if (process.platform !== 'linux') {
    try {
      const w = fs.watch(root, { recursive: true }, (ev, f) => { if (f && !skip.test(String(f))) cb(String(f)); });
      w.on('error', () => { doubt = true; });
      ready();
      const stop = () => { closed = true; w.close(); };
      stop.trusted = () => !closed && !doubt;
      return stop;
    } catch { /* fall through to per-directory */ }
  }
  // A folder that is deleted and made again is a different folder to the system: the watch on the old one is dead. Its watches (and
  // those of everything below it) are closed here, and the new one is registered when it is seen.
  const drop = dir => {
    for (const [d, w] of watchers) if (d === dir || d.startsWith(dir + path.sep)) { try { w.close(); } catch {} watchers.delete(d); inodes.delete(d); }
  };
  // `later` is the list of folders still to register at start; a folder that appears while running is registered at once (`fresh`:
  // its files are reported too, since anything made in it before the watch was in place was not seen)
  const add = (dir, later, fresh) => {
    if (closed || watchers.has(dir) || (dir !== root && skip.test(rel(dir)))) return;
    if (watchers.size >= maxDirs) { doubt = true; return; }   // a folder that is not watched: the list cannot be believed for long
    let w;
    try { w = fs.watch(dir, (ev, f) => onEvent(dir, f, ev)); }
    catch (e) { if (e.code !== 'ENOENT') doubt = true; return; }   // a folder that vanished is not a failure; one that could not be watched is
    w.on('error', () => { try { w.close(); } catch {} if (watchers.get(dir) === w) { watchers.delete(dir); inodes.delete(dir); if (fs.existsSync(dir)) doubt = true; } });
    watchers.set(dir, w); inodes.set(dir, inodeOf(dir));
    let made = 0;
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { const d = path.join(dir, e.name); if (later) later.push(d); else add(d, undefined, fresh); }
        else if (fresh && made++ < 200) cb(rel(path.join(dir, e.name)));
      }
    } catch {}
    if (fresh && dir !== root) cb(path.join(rel(dir), '\0'));   // "something in this folder" (covers what the lines above did not name): it is read once
  };
  const onEvent = (dir, f, ev) => {
    if (!f || closed) return;
    const full = path.join(dir, String(f));
    const r = rel(full);
    if (skip.test(r)) return;
    let st = null; try { st = fs.statSync(full); } catch { drop(full); }   // deleted or moved away: its watches are dead
    if (st?.isDirectory()) {
      // Deleted and made again since it was watched. A different inode says so, but file systems (ext4 on a CI machine) hand the same
      // inode number out again at once, so a 'rename' (something made or moved here) for a folder already watched is taken as that too:
      // it is watched afresh. Doing it for nothing only costs one more look at the folder.
      if (watchers.has(full) && (inodes.get(full) !== st.ino || ev === 'rename')) drop(full);
      add(full, undefined, true);
    }
    cb(r);
  };
  const todo = [root];
  const pump = () => {
    timer = null;
    const end = Date.now() + 8;
    while (todo.length && !closed) { add(todo.shift(), todo); if (Date.now() > end) break; }
    if (closed) return;
    if (todo.length) timer = setImmediate(pump); else ready();
  };
  pump();
  const stop = () => { closed = true; if (timer) clearImmediate(timer); for (const w of watchers.values()) try { w.close(); } catch {} watchers.clear(); inodes.clear(); };
  // Can a change be counted on to be heard? Not once any folder failed to be watched or the limit was reached, and not if the top
  // folder itself was replaced (checked at most once a second).
  stop.trusted = () => {
    if (closed || doubt) return false;
    const now = Date.now();
    if (now - rootAt > 1000) { rootAt = now; if (inodes.has(root) && inodeOf(root) !== inodes.get(root)) doubt = true; }
    return !doubt;
  };
  return stop;
}

// Folder watching shared between the parts of Jade that watch the same tree (the file map and the memory index): one set of
// watches per folder instead of one each. Each part gives its own `skip` (what it does not care about) and hears only the
// changes it cares about; the shared watch itself skips only what every part skips. A part that joins with a different skip
// starts the shared watch again, so it covers the folders the new part needs (everyone is told when it is ready again).
const shared = new Map();   // folder -> { subs: Set<{ cb, skip, onReady }>, stop, ready, maxDirs, sig }
export function watchShared(root, cb, { skip = /(^|[\\/])(\.git|node_modules|\.cache|\.venv)([\\/]|$)/, maxDirs = 3000, onReady } = {}) {
  let e = shared.get(root);
  if (!e) shared.set(root, e = { subs: new Set(), stop: null, ready: false, maxDirs: 0, sig: new Set() });
  const sub = { cb, skip, onReady, gap: false };
  const start = () => {
    e.stop?.(); e.ready = false;
    e.maxDirs = Math.max(...[...e.subs].map(x => x.maxDirs));
    const all = [...e.subs];
    e.stop = watchTree(root, f => { for (const x of [...e.subs]) if (!x.skip.test(f)) x.cb(f); }, {
      skip: { test: f => all.every(x => x.skip.test(f)) }, maxDirs: e.maxDirs,
      onReady: () => { e.ready = true; for (const x of [...e.subs]) { const gap = x.gap; x.gap = false; x.onReady?.({ gap }); } },
    });
  };
  sub.maxDirs = maxDirs; sub.gap = true;   // the changes before the watch is ready are not seen
  const was = e.subs.size, known = [...e.subs].some(x => x.skip.source === skip.source);
  e.subs.add(sub);
  if (was && known && e.ready) setImmediate(() => { if (e.subs.has(sub)) { sub.gap = false; onReady?.({ gap: false }); } });   // already watching what this part needs
  else { for (const x of e.subs) x.gap = true; start(); }
  const leave = () => {
    e.subs.delete(sub);
    if (!e.subs.size) { e.stop?.(); shared.delete(root); }
  };
  leave.trusted = () => e.ready && !!e.stop?.trusted?.();   // false until every folder is watched, and once the watch cannot be believed
  return leave;
}

// Resolve a CLI on PATH without a shell (works on Windows .cmd shims too).
export function which(cmd) {
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext.toLowerCase());
      const P = path.join(dir, cmd + ext);
      for (const c of [p, P]) { try { if (fs.statSync(c).isFile()) return c; } catch {} }
    }
  }
  return null;
}
