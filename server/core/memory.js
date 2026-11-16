// Local-files memory: a BM25 index over the folders in config.memory.folders. No embeddings, no network, no cost.
// The index is built in the background in short slices (the server keeps answering), one build at a time, and it remembers per file
// what it read (size and modified time), so a pass over an unchanged tree reads nothing. A saved file updates only that file.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as config from './config.js';
import { emit } from './bus.js';
import * as recent from './recent.js';
import { debounce, expand, watchShared } from './util.js';
import { foldersOf, within } from './locations.js';
import * as store from './store.js';
import { isSecret, secretContext } from './files.js';
import { extractTextAsync, OFFICE, MAX_BYTES as OFFICE_MAX } from './extract.js';

const SKIP = new Set(['node_modules', '.git', '.state', '.cache', '.venv', 'dist', 'build', '.obsidian', '.trash']);
const MAX_FILES = 8000, MAX_BYTES = 600_000, CHUNK = 900;
const STOP = new Set('the a an and or of to in on for with is are was were be been it this that at by from as but not have has had do does did you your we our they their i me my he she his her its can will would should could about into over than then so if no yes up out what which who when where how all any each more most other some such only own same too very just also there here these those via per'.split(' '));

const BUDGET_MS = 12;       // a build works this long, then lets other requests in
const SETTLE_MS = 400;      // a saved file is indexed this long after the last change in the folder
const LIST_CAP = 2000;      // file list rows when the caller does not say how many
const recs = new Map();     // file -> { root, size, mtime, chunks: [{ file, root, title, text, terms: Map, len, mtime }] }; chunks is [] for a file with no text
let flat = [], flatDirty = false;   // all chunks in one array for search, rebuilt when a file changed
let df = new Map(), totalLen = 0, avgLen = 1;   // document frequency and total length, kept in step file by file
let running = null;         // the build in progress; a second request joins it
let builtAt = 0;            // when the last build finished
let version = 0;            // bumps whenever the index changes; caches key off it
export const indexVersion = () => version;
/** Is a pass over the folders running right now? Searches then answer from what is read so far. */
export const indexing = () => !!running;
const watchers = [];

// What the index covers: every project's folders and the data folder's notes, plus any folders the user added in Settings.
export function roots() {
  const out = [];
  let projects = []; try { projects = store.listProjects(); } catch {} // no data folder yet
  for (const p of projects) out.push(...foldersOf(p));
  out.push(store.dirs.notes, ...config.memoryFolders());
  return [...new Set(out)].filter(p => fs.existsSync(p));
}

const tokenize = s => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));

const yieldLoop = () => new Promise(r => setImmediate(r));
let sliceStart = 0;
const slice = async () => { if (Date.now() - sliceStart >= BUDGET_MS) { await yieldLoop(); sliceStart = Date.now(); } };

// Forget a file's chunks, or take them in; df and the total length follow, so nothing is recounted from scratch.
function drop(file) {
  const old = recs.get(file);
  if (!old) return;
  recs.delete(file);
  for (const c of old.chunks) { totalLen -= c.len; for (const t of c.terms.keys()) { const n = (df.get(t) || 1) - 1; if (n > 0) df.set(t, n); else df.delete(t); } }
  flatDirty = true; version++;
}
function put(file, rec) {
  drop(file);
  recs.set(file, rec);
  for (const c of rec.chunks) { totalLen += c.len; for (const t of c.terms.keys()) df.set(t, (df.get(t) || 0) + 1); }
  flatDirty = true; version++;
}
function chunks() {
  if (flatDirty) {
    flat = []; for (const r of recs.values()) for (const c of r.chunks) flat.push(c);
    avgLen = flat.length ? totalLen / flat.length : 1;
    flatDirty = false;
  }
  return flat;
}

async function chunkFile(file, root, st) {
  const ext = path.extname(file).toLowerCase(), office = OFFICE.has(ext) || ext === '.pdf';
  if (st.size > (office ? OFFICE_MAX : MAX_BYTES)) return [];
  let text;
  if (office) { text = await extractTextAsync(file); if (!text) return []; }
  else { try { text = fs.readFileSync(file, 'utf8'); } catch { return []; } }
  const title = (/^title:\s*(.+)$/m.exec(text)?.[1] || /^#\s+(.+)$/m.exec(text)?.[1] || path.basename(file)).replace(/^["']|["']$/g, '');
  const parts = [];
  const paras = text.split(/\n(?=#{1,3} )|\n\s*\n/);
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > CHUNK && cur) { parts.push(cur); cur = p; } else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map(t => {
    const toks = tokenize(title + ' ' + t);
    const terms = new Map();
    for (const tok of toks) terms.set(tok, (terms.get(tok) || 0) + 1);
    return { file, root, title, text: t.trim(), terms, len: toks.length || 1, mtime: st.mtimeMs };
  });
}

// Bring one file up to date. Unchanged (same size and modified time) costs one stat; a file with no text is remembered as such.
// Does not look at secrets or extensions: callers have.
async function refresh(file, root) {
  const st = fs.statSync(file, { throwIfNoEntry: false });
  if (!st || !st.isFile()) { drop(file); return; }
  const old = recs.get(file);
  if (old && old.size === st.size && old.mtime === st.mtimeMs && old.root === root) return;
  const list = await chunkFile(file, root, st);
  put(file, { root, size: st.size, mtime: st.mtimeMs, chunks: list });
}

const rootsKey = () => roots().join('\n');
const addedDuringBuild = new Set();   // files a change notice indexed while a build was running: the build must not forget them

async function build() {
  const t0 = Date.now(), key = rootsKey();
  sliceStart = t0;
  addedDuringBuild.clear();
  const ctx = secretContext();
  const exts = config.get().memory.extensions;
  const seen = new Set();
  const walk = async (dir, root) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen.size >= MAX_FILES) return;
      if (e.name.startsWith('.') && e.name !== '.') { if (SKIP.has(e.name) || e.isDirectory()) continue; }
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) await walk(p, root); }
      else if (exts.includes(path.extname(e.name).toLowerCase()) && !seen.has(p) && !isSecret(p, ctx)) {
        seen.add(p);
        await slice();
        try { await refresh(p, root); } catch { /* one unreadable file does not stop the pass */ }
      }
    }
  };
  for (const root of roots()) await walk(root, root);
  for (const f of [...recs.keys()]) if (!seen.has(f) && !addedDuringBuild.has(f)) drop(f);
  builtAt = Date.now();
  emit('memory', { files: recs.size, chunks: chunks().length, ms: builtAt - t0 });
  return key;
}

/**
 * Index everything in the background. Returns a promise that settles when the pass is done and never rejects. Only one pass runs at a
 * time: a second call joins the one in progress (and, if the folders to read changed meanwhile, one more pass follows).
 * { maxAgeMs }: do nothing when the last pass finished less than that long ago.
 */
export function rebuild({ maxAgeMs = 0 } = {}) {
  if (running) return running;
  if (maxAgeMs && Date.now() - builtAt < maxAgeMs) return Promise.resolve();
  const go = async () => {
    let key = '';
    try { key = await build(); } catch (e) { console.error('memory index:', e.message); }
    if (key && rootsKey() !== key) return go();   // the folders changed while it ran
  };
  running = go().finally(() => { running = null; });
  return running;
}

// A saved or deleted file: index that file only. Anything else (a new or renamed folder) asks for a pass, which is cheap when little changed.
const pending = new Map();
const flushPending = debounce(async () => {
  const batch = [...pending]; pending.clear();
  let any = false, full = false;
  const exts = config.get().memory.extensions;
  const ctx = secretContext();
  sliceStart = Date.now();
  for (const [file, root] of batch) {
    try {
      const rel = path.relative(root, file).split(path.sep);
      const last = rel[rel.length - 1];
      if (rel.slice(0, -1).some(d => d.startsWith('.') || SKIP.has(d)) || SKIP.has(last)) continue;
      const st = fs.statSync(file, { throwIfNoEntry: false });
      if (st?.isDirectory()) { full = true; continue; }
      if (!st) {   // gone: the file itself, or a folder that held files
        const before = recs.size;
        drop(file); for (const f of [...recs.keys()]) if (f.startsWith(file + path.sep)) drop(f);
        if (recs.size !== before) any = true;
        continue;
      }
      if (last.startsWith('.') || !exts.includes(path.extname(last).toLowerCase()) || isSecret(file, ctx)) continue;
      if (!recs.has(file) && recs.size >= MAX_FILES) continue;
      const v = version;
      if (running) addedDuringBuild.add(file);
      await refresh(file, root);
      if (version !== v) any = true;
      await slice();
    } catch { /* a file that vanished or cannot be read is skipped */ }
  }
  if (any) emit('memory', { files: recs.size, chunks: chunks().length, ms: 0 });
  if (full) scheduleRebuild();
}, SETTLE_MS);

export const scheduleRebuild = debounce(() => rebuild(), 1500);

/** Stop watching the folders (watch() starts again). */
export function unwatch() { for (const close of watchers.splice(0)) close(); }

export function watch() {
  unwatch();
  for (const root of roots()) {
    // If a folder is too big to watch fully, the 15-minute reindex still catches changes.
    watchers.push(watchShared(root, f => {
      if (f.endsWith('.tmp')) return;
      const file = path.join(root, f);
      recent.note(file);
      if (!pending.has(file)) pending.set(file, root);
      flushPending();
    }, { skip: /(^|[\\/])(\.state|\.git|node_modules|\.cache|\.venv|\.obsidian|\.trash)([\\/]|$)/, maxDirs: 2000,
      onReady: ({ gap } = {}) => { if (gap) scheduleRebuild(); } }));   // the watch is in place a moment after start: look once at what changed before it
  }
}

export function search(q, k = 8, { root } = {}) {
  const qt = [...new Set(tokenize(q))];
  if (!qt.length) return [];
  const all = chunks();
  const N = all.length, k1 = 1.4, b = 0.75;
  const scored = [];
  for (const c of all) {
    if (root && c.root !== root) continue;
    let s = 0, hit = 0;
    const titleToks = c.titleTerms || (c.titleTerms = new Set(tokenize(c.title)));
    for (const t of qt) {
      // a term also matches the start of a longer word ("migrat" finds "migration"), at a lower weight
      let tf = c.terms.get(t) || 0, weight = 1;
      if (!tf && t.length >= 4) { for (const [k, v] of c.terms) if (k.startsWith(t)) { tf += v; weight = 0.6; } }
      if (!tf) continue;
      hit++;
      const n = df.get(t) || 1;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += weight * idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * c.len / avgLen));
      if (titleToks.has(t)) s += idf; // the word is in the title: this file is about it
    }
    if (s > 0) {
      s *= 1 + 0.35 * (hit / qt.length);                                   // covering more of the words wins
      s *= 1 + 0.5 * Math.exp(-Math.max(0, (Date.now() - c.mtime) / 864e5) / 120); // newer wins ties
      scored.push([s, c]);
    }
  }
  scored.sort((a, b) => b[0] - a[0]);
  const seen = new Map();
  const out = [];
  for (const [s, c] of scored) {
    const n = seen.get(c.file) || 0;
    if (n >= 2) continue;
    seen.set(c.file, n + 1);
    out.push({ file: c.file, title: c.title, score: +s.toFixed(2), snippet: snippet(c.text, qt), mtime: c.mtime });
    if (out.length >= k) break;
  }
  return out;
}

function snippet(text, terms) {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) { pos = lower.indexOf(t); if (pos >= 0) break; }
  const start = Math.max(0, pos - 160);
  return (start ? '…' : '') + text.slice(start, start + 420).replace(/\s+/g, ' ').trim() + (text.length > start + 420 ? '…' : '');
}

/**
 * Indexed files for the file ring, grouped, newest first. A file inside one of a project's folders belongs to that project;
 * anything else is grouped by its folder (root/top-level sub-folder), with the next folder level as its "area".
 * projectFolders: [{ name, folders: [absolute paths] }]. { limit, offset } return one page; the default is the newest LIST_CAP files.
 */
export function listFiles(projectFolders = [], { limit = LIST_CAP, offset = 0 } = {}) {
  const home = os.homedir();
  const pf = projectFolders.flatMap(p => p.folders.map(f => ({ name: p.name, dir: f.endsWith(path.sep) ? f : f + path.sep })));
  const rows = [];
  for (const [file, r] of recs) if (r.chunks.length) rows.push([file, r]);
  rows.sort((a, b) => b[1].mtime - a[1].mtime || (a[0] < b[0] ? -1 : 1));
  return rows.slice(offset, offset + limit).map(([file, r]) => {
    const owner = pf.find(p => file.startsWith(p.dir));
    const base = owner ? owner.dir.slice(0, -1) : r.root;
    const parts = path.relative(base, file).split(path.sep);
    const rootName = path.basename(r.root) || r.root.replace(home, '~');
    const group = owner ? owner.name : parts.length > 1 ? `${rootName}/${parts[0]}` : rootName;
    const area = owner ? (parts.length > 1 ? parts[0] : 'General') : parts.length > 2 ? parts[1] : 'General';
    return { file, title: r.chunks[0].title, group, area, project: owner?.name || '', mtime: r.chunks[0].mtime };
  });
}
/** How many files listFiles has to give (files with no readable text are not listed). */
export function listedCount() { let n = 0; for (const r of recs.values()) if (r.chunks.length) n++; return n; }

export function stats() {
  const counts = new Map();
  for (const [file, r] of recs) if (r.chunks.length) counts.set(r.root, (counts.get(r.root) || new Set()).add(file));
  const configured = config.get().memory.folders.map(f => {
    const resolved = expand(f);
    return { folder: f, resolved, exists: fs.existsSync(resolved), files: counts.get(resolved)?.size || 0 };
  });
  return { files: recs.size, chunks: chunks().length, folders: configured, building: indexing() };
}

/** Forget everything that was read (for tests, and for a full re-read). The next rebuild reads every file again. */
export function reset() { recs.clear(); df = new Map(); totalLen = 0; flat = []; flatDirty = false; builtAt = 0; version++; }

// A compact block of relevant memory for an agent prompt.
export function contextFor(q, k = 6) {
  const hits = search(q, k);
  if (!hits.length) return '(no matching local files)';
  return hits.map(h => `### ${h.title}\nfile: ${h.file}\n${h.snippet}`).join('\n\n');
}
