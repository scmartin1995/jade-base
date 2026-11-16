// Every file Jade can reach, by name: the memory folders, each project's folders, and Jade's own output
// (notes). Any file type, so deliverables like .docx, .xlsx, .pptx and .pdf are findable even though only
// text files are read into memory. The list is remembered per folder and read again when the folder changes (or, where watching is not possible, when it is a minute old).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import * as config from './config.js';
import * as store from './store.js';
import { expand, watchShared } from './util.js';
import { slicer, runSync, runAsync } from './slices.js';
import { resolveHome, within, foldersOf } from './locations.js';

const SKIP = new Set(['node_modules', '.git', '.state', '.cache', '.venv', 'dist', 'build', '.obsidian', '.trash', '__pycache__', '$RECYCLE.BIN']);
const MAX = 20000;

const KIND_BY_EXT = {
  '.md': 'note', '.markdown': 'note', '.txt': 'text', '.org': 'text',
  '.docx': 'document', '.doc': 'document', '.odt': 'document', '.rtf': 'document', '.pages': 'document',
  '.xlsx': 'spreadsheet', '.xls': 'spreadsheet', '.csv': 'spreadsheet', '.numbers': 'spreadsheet', '.ods': 'spreadsheet',
  '.pptx': 'slides', '.ppt': 'slides', '.key': 'slides', '.odp': 'slides',
  '.pdf': 'pdf', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.svg': 'image', '.webp': 'image',
  '.json': 'data', '.yaml': 'data', '.yml': 'data', '.xml': 'data', '.mpp': 'plan', '.vsdx': 'diagram', '.drawio': 'diagram',
  '.zip': 'archive', '.msg': 'email', '.eml': 'email', '.ics': 'calendar',
};

/** What isSecret compares against: Jade's secret paths, where they really are, and the identity of the files that hold a key.
 *  A long walk makes one of these and hands it to every isSecret call, so the secret side is read once instead of once per file. */
export function secretContext() {
  const secrets = [path.join(config.JADE_HOME, '.state'), path.join(config.JADE_HOME, 'engine.env')];
  const real = secrets.map(s => { try { return fs.realpathSync.native(s); } catch { return s; } });   // the same form as the .native used in isSecret (on Windows the plain one keeps a short 8.3 name)
  const keyFiles = [];
  for (const s of [path.join(secrets[0], 'token'), secrets[1]]) { try { const st = fs.statSync(s); if (st.ino) keyFiles.push(st); } catch { /* missing or not readable: the check by name below still holds */ } }
  return { secrets, real, keyFiles };
}

/** Jade's own secrets: the whole .state folder (the key, ...) and engine.env (the provider key). No route may read, list or index them.
 *  The answer is the same with or without `ctx`: the path as written, its real location (symlinks followed) and a hard link to a key file are all checked. */
export function isSecret(p, ctx = secretContext()) {
  const r = resolveHome(p);
  const { secrets, real, keyFiles } = ctx;
  for (let i = 0; i < secrets.length; i++) if (within(secrets[i], r) || within(real[i], r)) return true;   // by name: no disk read
  let rp = r; try { rp = fs.realpathSync.native(r); } catch { /* not there */ }                           // one system call
  if (rp !== r) for (let i = 0; i < secrets.length; i++) if (within(secrets[i], rp) || within(real[i], rp)) return true;
  for (let i = 0; i < secrets.length; i++) if (within(real[i], rp)) return true;
  // a hard link to a secret file in another place: only a file with more than one name can be one
  if (keyFiles.length) {
    let st = null; try { st = fs.statSync(r); } catch { /* not there, or not readable: nothing to compare */ }
    if (st?.isFile() && st.nlink > 1) for (const k of keyFiles) if (k.ino === st.ino && k.dev === st.dev) return true;
  }
  return false;
}

/** The folders Jade may reach: memory folders, project folders (tagged with the project) and the data folder. */
export function roots() {
  const out = [];
  const add = (dir, project) => { const r = resolveHome(dir); if (fs.existsSync(r) && !out.some(o => o.dir === r)) out.push({ dir: r, project }); };
  for (const p of store.listProjects()) for (const f of foldersOf(p)) add(f, { id: p.id, name: p.name });
  for (const f of config.memoryFolders()) add(f, null);
  if (config.outputIsCustom()) add(config.outputDir(), null);
  add(config.JADE_HOME, null);
  return out;
}

// One folder's files, read as a generator so it can give way to other requests (see slices.js; the caller supplies due()).
// The result is kept as a tree, folder by folder, in the order a walk meets things, so that when one folder changes only that
// folder is read again and the flattened list is exactly what a fresh walk of everything would give.
function* readDir(dir, root, depth, tree, due, tally, count, keepKnown) {
  if (count.n >= MAX || depth > 8) return;
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  tally.dirs++;
  let mtime = 0; try { mtime = fs.statSync(dir).mtimeMs; } catch { /* read below anyway */ }   // before reading, so a change made meanwhile shows next time
  const items = [], gone = new Set((tree.get(dir)?.items || []).filter(i => typeof i === 'string'));
  for (const e of entries) {
    if (count.n >= MAX) break;
    if (due()) yield;
    if (e.name.startsWith('.') || e.name.startsWith('~$') || SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (isSecret(p, tally.ctx)) continue;
    if (e.isDirectory()) {
      items.push(p); gone.delete(p);
      if (!(keepKnown && tree.has(p))) yield* readDir(p, root, depth + 1, tree, due, tally, count, keepKnown);   // a known sub-folder is only read again if it changed itself
      continue;
    }
    if (!e.isFile()) continue;
    let st; try { st = fs.statSync(p); } catch { continue; }
    const ext = path.extname(e.name).toLowerCase();
    const rel = path.relative(root.dir, p);
    const jade = root.dir === config.JADE_HOME ? rel.split(path.sep)[0] : '';
    count.n++;
    items.push({
      path: p, name: e.name, ext, size: st.size, mtime: st.mtimeMs, rel, root: root.dir,
      folder: path.dirname(p),
      project: root.project?.id || '', projectName: root.project?.name || '',
      kind: jade === 'notes' ? 'note' : KIND_BY_EXT[ext] || 'file',
      made: jade === 'notes',   // made by Jade (or in Jade's own notes)
    });
  }
  for (const g of gone) forget(tree, g);
  tree.set(dir, { depth, mtime, readAt: Date.now(), items });   // visible only when complete
}
function forget(tree, dir) {
  const n = tree.get(dir); tree.delete(dir);
  for (const i of n?.items || []) if (typeof i === 'string') forget(tree, i);
}
function flatten(tree, rootDir) {
  const out = [];
  const rec = dir => { for (const i of tree.get(dir)?.items || []) { if (out.length >= MAX) return; if (typeof i === 'string') rec(i); else out.push(i); } };
  rec(rootDir);
  return out;
}

// What is remembered, per folder: its tree, and which folders changed since. A folder watched by the system is believed for
// ten minutes, then read again in full (a safety net). One that cannot be watched (no watching here, or more sub-folders than
// can be watched) is checked every minute instead: each folder's own modified time says whether files were added, removed or
// renamed in it (a few thousand quick checks, not a walk), and only a changed folder is read; a full read follows every five
// minutes, which also catches a file edited in place. `timing` is a test seam.
export const timing = { watched: 10 * 60e3, unwatched: 60e3, unwatchedFull: 5 * 60e3 };
const WATCH_MAX_DIRS = 2000, MAX_DIRTY = 200;
const WATCH_SKIP = new RegExp('(^|[\\\\/])(\\.[^\\\\/]*|' + [...SKIP].filter(n => !n.startsWith('.')).map(n => n.replace(/[$.]/g, '\\$&')).join('|') + ')([\\\\/]|$)');
const states = new Map();   // root key -> { r, tree, files, at, dirty, full, active, watched, capped, stop, ready, dirs, recheck }
let version = 0, listId = 0, assembled = { key: '', version: -1, id: 0, files: [] }, watching = false, inflight = null;

const keyOf = r => `${r.dir}\0${r.project?.id || ''}\0${r.project?.name || ''}`;
const stateOf = r => { const k = keyOf(r); let s = states.get(k); if (!s) states.set(k, s = { r, tree: null, files: null, at: 0, fullAt: 0, dirty: new Set(), full: true, active: 0, watched: false, capped: false, stop: null, ready: false, dirs: 0, recheck: false }); return s; };
// Is the remembered list kept right by the watch? Only while every folder is really watched; when a watch failed, was lost or ran out,
// the folder is checked by its modified times every minute, as it always was.
const trusted = s => s.watched && !!s.stop?.trusted?.();
const expired = s => Date.now() - s.at >= (trusted(s) ? timing.watched : timing.unwatched);
const fullDue = s => Date.now() - s.fullAt >= (trusted(s) ? timing.watched : timing.unwatchedFull);
const isFresh = s => !s.full && !s.active && !s.dirty.size && !s.recheck && !!s.tree && !expired(s);
const watchable = s => process.platform !== 'linux' || s.dirs < WATCH_MAX_DIRS - 100;   // fewer folders than the watch can hold
function prune(rs) {
  const keep = new Set(rs.map(keyOf));
  for (const [k, s] of states) if (!keep.has(k)) { try { s.stop?.(); } catch { /* closed */ } states.delete(k); }
}
const markChanged = (s, rel) => { s.dirty.add(path.dirname(path.join(s.r.dir, rel))); if (s.dirty.size > MAX_DIRTY) s.full = true; };

function* sweep(s, due) {
  for (const [dir, node] of s.tree) {
    if (due()) yield;
    let m = -1; try { m = fs.statSync(dir).mtimeMs; } catch { /* gone: its parent changed */ }
    if (m < 0) s.dirty.add(path.dirname(dir)); else if (m !== node.mtime || m >= node.readAt - 2000) s.dirty.add(dir);   // a change in the same clock tick as the read could look like none, so a folder changed just before it is read once more
  }
}

// Read a folder again: everything on a first read, after a long time or when many folders changed; else just the folders that changed.
function* refresh(s, due, forceFull = false) {
  const mine = ++s.active;
  // watch before reading, so a change made during the read leaves the folder marked as changed. The watches are put in place in
  // short turns (watchTree); until they are all in place `s.ready` is false and the folder is checked by its modified times instead.
  if (watching && !s.stop) {
    try {
      s.stop = watchShared(s.r.dir, rel => markChanged(s, rel), { skip: WATCH_SKIP, maxDirs: WATCH_MAX_DIRS, onReady: () => {
        s.ready = true;
        if (s.tree && !s.active) { s.watched = watchable(s); s.recheck = true; }   // read before the watch was ready: look once at what changed since
      } });
    } catch { s.stop = null; }
  }
  const readyAtStart = s.ready;
  let full = forceFull || s.full || !s.tree || fullDue(s);
  if (!full && (!trusted(s) || s.recheck)) yield* sweep(s, due);   // not watched (or not for all of the time): ask each folder whether it changed
  s.recheck = false;
  const todo = full ? [] : [...s.dirty].sort((a, b) => a.length - b.length);
  s.dirty.clear(); s.full = false;
  const tally = { dirs: 0, ctx: secretContext() }, count = { n: 0 };   // one secret context per read, not one per file
  let tree = s.tree;
  if (full) { tree = new Map(); yield* readDir(s.r.dir, s.r, 0, tree, due, tally, count, false); }
  else {
    for (const d of todo) { const node = tree.get(d); if (node) yield* readDir(d, s.r, node.depth, tree, due, tally, { n: 0 }, true); }
    // A folder cut off at the limit only holds the first files of the walk. Adding and changing stay exact; once something was
    // removed and the list no longer reaches the limit, files beyond it belong in, so it is read in full.
    if (s.capped && flatten(tree, s.r.dir).length < MAX) { full = true; tree = new Map(); yield* readDir(s.r.dir, s.r, 0, tree, due, tally, count, false); }
  }
  if (s.active !== mine) return;   // a newer read (a caller that could not wait) has taken over; its answer stands
  s.tree = tree; s.files = null; s.active = 0; s.at = Date.now(); version++;
  if (full) { s.fullAt = s.at; s.capped = count.n >= MAX; s.dirs = tally.dirs; s.watched = !!s.stop && s.ready && watchable(s); if (s.ready && !readyAtStart) s.recheck = true; }
}

// The combined list: a file under a project folder belongs to the project even if the folder is also a memory folder.
function assemble(rs) {
  const key = rs.map(keyOf).join('\n');
  if (assembled.version === version && assembled.key === key) return assembled.files;
  const files = [], seen = new Set();
  for (const r of [...rs.filter(r => r.project), ...rs.filter(r => !r.project)]) {
    const s = stateOf(r);
    for (const f of s.files ||= s.tree ? flatten(s.tree, s.r.dir) : []) { if (seen.has(f.path)) continue; seen.add(f.path); files.push(f); }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  assembled = { key, version, id: ++listId, files };
  return files;
}

/** Every file Jade can reach, newest first, walked in one go. For code that cannot wait; request handlers use list(). */
export function scan(force = false) {
  const rs = roots();
  prune(rs);
  // a folder being read by a request right now is read again here in full: its answer would come too late for this caller
  for (const r of rs) { const s = stateOf(r); if (force || !isFresh(s)) runSync(refresh(s, slicer(), force || !!s.active)); }
  return assemble(rs);
}

const pass = () => {
  const rs = roots();
  prune(rs);
  return (async () => { for (const r of rs) { const s = stateOf(r); if (!isFresh(s)) await runAsync(refresh(s, slicer())); } })();
};

/**
 * The same list as scan(), for a request: it never holds up other requests. A list that is still good is returned at once; a
 * folder that changed (or was never read) is walked in short slices, one walk at a time, and a caller that arrives meanwhile
 * waits for that walk instead of starting another. Starts watching the folders so a change is noticed when it happens.
 */
export async function list() {
  watching = true;
  for (let tries = 0; ; tries++) {
    const rs = roots();
    if (tries >= 3 || rs.every(r => isFresh(stateOf(r)))) { prune(rs); return assemble(rs); }
    inflight ||= pass().finally(() => { inflight = null; });
    await inflight;
  }
}

/** The file list changed (or may have): read it again next time. Given a file or folder path, only the folder it is in is read again
 *  (or, if that folder is new, the nearest folder above it that is already known); without one, everything is. */
export function invalidate(where) {
  if (!where) { for (const s of states.values()) s.full = true; return; }
  const target = resolveHome(where);
  for (const s of states.values()) {
    if (!s.tree || !within(s.r.dir, target)) continue;
    let d = path.dirname(target);
    while (d !== s.r.dir && !s.tree.has(d) && within(s.r.dir, d) && path.dirname(d) !== d) d = path.dirname(d);
    if (s.tree.has(d)) s.dirty.add(d); else s.full = true;
    if (s.dirty.size > MAX_DIRTY) s.full = true;
  }
}
/** Names the list last returned by scan() or list(): a result worked out from the list stays good while this stays the same. */
export const listVersion = () => assembled.id;
/** Stop watching (the server never needs this; a test that used list() does, or its process would not end). */
export function stopWatching() { watching = false; for (const s of states.values()) { try { s.stop?.(); } catch { /* closed */ } s.stop = null; s.ready = false; s.watched = false; } }

// The lower-case forms a search compares with, worked out once per file (and dropped with it).
const lowerOf = new WeakMap();
const lowered = f => { let l = lowerOf.get(f); if (!l) lowerOf.set(f, l = [f.name.toLowerCase(), (f.projectName + ' ' + f.rel).toLowerCase().replace(/[\\/_-]+/g, ' ')]); return l; };

function* searchGen(q, { project = '', kind = '', limit = 50, madeOnly = false }, all, due) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const home = os.homedir();
  const hits = [];
  for (const f of all) {
    if (due()) yield;
    if (project && f.project !== project) continue;
    if (kind && f.kind !== kind) continue;
    if (madeOnly && !f.made) continue;
    let score = 0;
    if (words.length) {
      const [name, rel] = lowered(f);
      let ok = true;
      for (const w of words) {
        if (name.includes(w)) score += name.startsWith(w) ? 3 : 2;
        else if (rel.includes(w)) score += 1;
        else { ok = false; break; }
      }
      if (!ok) continue;
    }
    hits.push({ f, score });
  }
  hits.sort((a, b) => b.score - a.score || b.f.mtime - a.f.mtime);
  return hits.slice(0, limit).map(({ f, score }) => ({ ...f, score, display: f.path.startsWith(home) ? '~' + f.path.slice(home.length) : f.path }));
}

/** Name and path search. Every query word must appear; files matching in the name rank above path-only matches. */
export function search(q = '', opts = {}) { return runSync(searchGen(q, opts, scan(), slicer())); }
/** The same search for a request: gives way to other requests while it runs. */
export async function searchAsync(q = '', opts = {}) { return runAsync(searchGen(q, opts, await list(), slicer())); }

/** Is this a path Jade may open on the user's behalf? (inside a reachable folder). A saved "~\…" path is expanded first. */
export function allowed(p) {
  const r = resolveHome(p);
  if (isSecret(r)) return false;
  const rs = roots();
  if (!rs.some(x => within(x.dir, r))) return false;
  // A link inside an allowed folder must not lead out of it: where the path really ends up has to be inside an allowed folder too.
  let rp; try { rp = fs.realpathSync(r); } catch { return true; }   // not there (yet): nothing to follow
  return rs.some(x => { let rd = x.dir; try { rd = fs.realpathSync(x.dir); } catch {} return within(rd, rp); });
}

// Programs and scripts are never started by "Open", whatever folder they are in: they are shown in their folder instead.
const PROGRAM = /\.(exe|msi|bat|cmd|com|scr|ps1|psm1|vbs|vbe|js|jse|mjs|wsf|wsh|hta|lnk|dll|sys|reg|jar|app|sh|desktop|url|command|pif|cpl|docm|dotm|xlsm|xlam|pptm|potm|ppam|ppsm|sldm|py|pyw|pyc|rb|pl|pm|php|chm|msc|application|appref-ms|xll|jnlp|iso|img|dmg|pkg|deb|rpm|appimage|gadget|inf|ins|isp|ws|scf|vb|wsc|msp|mst|ade|adp|bas|crt|msh|msh1|msh2|mshxml|csh|fish|ksh|zsh|run|bin|workflow|action|terminal|swf|vbscript|lua|tcl|psd1|ps1xml|ps2|ps2xml|psc1|psc2)$/i;

// open() and reveal() act on the same expanded path that allowed() checked, so "~\…" paths work for both.
const real = p => resolveHome(p);

function openWith(cmd, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    c.on('error', reject);
    c.unref();
    setTimeout(resolve, 150);
  });
}

/** True for a program or script (by its name): Open shows these in their folder rather than starting them. */
export const isProgram = name => PROGRAM.test(String(name || ''));

/** Open a file with whatever the computer uses for it. */
export async function open(input) {
  const p = real(input);
  if (!allowed(p) || !fs.existsSync(p)) throw Object.assign(new Error('That file is not in a folder Jade can reach'), { status: 403 });
  if (isProgram(p)) return reveal(p);
  if (process.platform === 'darwin') return openWith('open', [p]);
  if (process.platform === 'win32') return openWith('explorer.exe', [p]);   // not cmd: a file name with & in it would be read as a second command
  return openWith('xdg-open', [p]);
}

// Windows: Jade's server runs in the background, and Windows does not let a background program put a window in front, so
// `explorer /select,` opened the folder behind everything else and "Show in folder" looked dead (each click left another hidden
// window). This reuses a File Explorer window already showing the folder, else opens one, selects the file, and brings that
// window forward. Attaching to the front window's input alone was not enough: Windows still refused, so a synthetic Alt
// press first makes this helper the source of the last input, which is what SetForegroundWindow checks. Each attempt writes one
// line to .state/reveal.log, so a click that still shows nothing can be read afterwards. The path arrives in an environment
// variable, never in the script text.
const REVEAL_PS = `
$log = $env:JADE_REVEAL_LOG
function Note($m) { try { Add-Content -LiteralPath $log -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $m) } catch {} }
try {
  $ErrorActionPreference = 'Stop'
  Add-Type @'
using System; using System.Runtime.InteropServices;
public static class JadeFront {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool on);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  // ShowWindowAsync, not ShowWindow: this helper is started hidden, and Windows turns a hidden program's first ShowWindow call
  // into "hide" whatever it asks for. That hid the File Explorer window the moment it opened. The async call is carried out by
  // Explorer's own thread, so the rule does not apply.
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int n);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static bool Visible(IntPtr h) { return IsWindowVisible(h) && !IsIconic(h); }
  public static bool Front(IntPtr h) {
    ShowWindowAsync(h, IsIconic(h) ? 9 : 5);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // Alt down, Alt up
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero), me = GetCurrentThreadId();
    bool attached = fg != me && AttachThreadInput(me, fg, true);
    BringWindowToTop(h); SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fg, false);
    return GetForegroundWindow() == h;
  }
}
'@
  $file = $env:JADE_REVEAL_PATH
  $dir = (Split-Path -Parent $file).TrimEnd('\\')
  $shell = New-Object -ComObject Shell.Application
  # Only a window the user can actually see counts. Earlier clicks left hidden Explorer windows behind (visible = false), and
  # reusing one of those showed nothing, so it is closed and a fresh window opened instead.
  function Find { $shell.Windows() | Where-Object { $_.LocationURL -like 'file:*' -and ([uri]$_.LocationURL).LocalPath.TrimEnd('\\') -ieq $dir -and [JadeFront]::Visible([IntPtr][int64]$_.HWND) } | Select-Object -First 1 }
  foreach ($old in @($shell.Windows() | Where-Object { $_.LocationURL -like 'file:*' -and -not [JadeFront]::Visible([IntPtr][int64]$_.HWND) })) { try { $old.Quit() } catch {} }
  $w = Find; $how = 'reused'
  if ($w) {
    $item = $w.Document.Folder.ParseName((Split-Path -Leaf $file))
    if ($item) { $w.Document.SelectItem($item, 29) } # select it alone, scroll to it, focus it
  } else {
    $how = 'opened'
    Start-Process explorer.exe -ArgumentList ('/select,"' + $file + '"') -WindowStyle Normal # not inherit this helper's hidden start
    for ($i = 0; $i -lt 40 -and -not $w; $i++) { Start-Sleep -Milliseconds 150; $w = Find }
  }
  if (-not $w) { Note "no visible window ($how): $file"; exit }
  $front = [JadeFront]::Front([IntPtr][int64]$w.HWND)
  Note "$how window, in front: $front : $file"
} catch { Note ('error: ' + $_.Exception.Message) }
`;

// Run attached: started detached with no streams (as openWith does for explorer),
// PowerShell exited at once with code 0 and ran none of the script, so every click did nothing and logged nothing.
function revealOnWindows(p) {
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(REVEAL_PS, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 30000, env: { ...process.env, JADE_REVEAL_PATH: p, JADE_REVEAL_LOG: path.join(config.STATE, 'reveal.log') } },
      () => {}); // the script logs its own result; the click is answered at once rather than after Explorer has opened
    resolve();
  });
}

/** Show the file in its folder (Explorer, Finder, or the desktop's file manager). */
export async function reveal(input) {
  const p = real(input);
  if (!allowed(p) || !fs.existsSync(p)) throw Object.assign(new Error('That file is not in a folder Jade can reach'), { status: 403 });
  if (process.platform === 'darwin') return openWith('open', ['-R', p]);
  if (process.platform === 'win32') return revealOnWindows(p);
  return openWith('xdg-open', [path.dirname(p)]);
}

export { expand };
