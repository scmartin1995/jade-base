// Plain-file data store under JADE_HOME. Readable and editable by hand; the watcher picks up outside edits.
//   projects/<id>.json        one file per project
//   notes/<date>-<slug>.md    markdown with frontmatter
//   actions.json              action items
// A note or action that belongs to a project with a usable first folder lives there instead, in <folder>/<storage.folderName>/Notes/
// and <folder>/<storage.folderName>/actions.json. Everything else (no project, or a folder that is missing or read-only) stays here.
//   memory/facts.md           things Jade has been asked to remember
//   .state/chats/<id>.json    one file per conversation (its turns inside); .state/jobs.json  the recent runs
// Every file Jade saves here is written to a temporary file next to it, flushed, then renamed over the old one, so a crash or a
// second save a moment later can never leave half a file. Notes and actions are read once and remembered; the remembered copy is
// checked against the file on disk (size, modified time, file number) every time it is used, so a change made by hand, by Claude
// Code or by a sync tool is seen at once. Conversations are different: a conversation is remembered for as long as Jade runs and is
// NOT checked again, so an edit made by hand to .state/chats/ while Jade is running is not noticed until the next start (see
// docs/PERFORMANCE.md, known limits).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { JADE_HOME, STATE, get as cfg } from './config.js';
import { readJSON, writeJSON, writeText, ensureDir, id, slug, today, parseFrontmatter, stringifyFrontmatter } from './util.js';
import { jadeFolderName, jadeDir, firstFolder, folderProblem, usableJadeDir, pathFor, dirFor, PARTS } from './locations.js';
import { emit } from './bus.js';
import { redact } from './redact.js';

const P = (...a) => path.join(JADE_HOME, ...a);
export const dirs = {
  projects: P('projects'), notes: P('notes'), memory: P('memory'),
  skills: P('skills'), agents: P('agents'),
  attachments: P('attachments'), // images pasted into a chat, one folder per conversation
};

// A pasted image, kept as a file so the engine can open it with its Read tool. Returns its full path.
const IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export function saveImage(cid, dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw Object.assign(new Error('Only PNG, JPEG, GIF or WebP images can be attached'), { status: 400 });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('An image must be under 8 MB'), { status: 413 });
  const dir = ensureDir(path.join(dirs.attachments, slug(cid) || 'chat'));
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${id()}${IMAGE_TYPES[m[1]]}`);
  fs.writeFileSync(file, buf);
  return file;
}

// Any other file attached to a chat (a Word document, a spreadsheet, a PDF, a CSV, a text or code file…), kept under its own
// name in the chat's attachments folder so the engine can read it. Programs and scripts are refused: they are not something to
// read, and a file that runs when opened should never land in a folder Jade works in. Returns the full path.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const REFUSED = /\.(exe|msi|bat|cmd|com|scr|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|dll|sys|reg|jar|app|sh)$/i;
export function saveAttachment(cid, { name, data } = {}) {
  const base = path.basename(String(name || 'file')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
  if (REFUSED.test(base)) throw Object.assign(new Error(`${base} is a program or script, so it can't be attached`), { status: 400 });
  const m = /^data:[^;,]*(?:;[^;,]*)*;base64,([A-Za-z0-9+/=]*)$/.exec(String(data || ''));
  if (!m) throw Object.assign(new Error(`${base} could not be read`), { status: 400 });
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length) throw Object.assign(new Error(`${base} is empty`), { status: 400 });
  if (buf.length > MAX_FILE_BYTES) throw Object.assign(new Error(`${base} is over 25 MB`), { status: 413 });
  const dir = ensureDir(path.join(dirs.attachments, slug(cid) || 'chat', new Date().toISOString().replace(/[:.]/g, '-')));
  const file = path.join(dir, base);
  fs.writeFileSync(file, buf);
  return file;
}

export function init() {
  for (const d of Object.values(dirs)) ensureDir(d);
  ensureDir(STATE);
  try { loadChats(); } catch (e) { console.error('Could not read the conversations:', e.message); }
  if (!fs.existsSync(P('actions.json'))) writeJSON(P('actions.json'), []);
  if (!fs.existsSync(P('memory', 'facts.md'))) writeText(P('memory', 'facts.md'), '# Things to remember\n\n');
  if (!fs.existsSync(P('README.md'))) writeText(P('README.md'), README);
  syncWatches();
}

const README = `# Jade data

Everything Jade knows lives in this folder as plain files. Edit anything by hand and the app updates live.

- projects/   one JSON file per project
- notes/      markdown notes (frontmatter: title, project, tags)
- actions.json  action items
- memory/     facts.md (long-term memory) and anything else you want Jade to read
- skills/     your skills (SKILL.md)
- agents/     your own agents, or overrides of the built-in ones
`;

const changed = kind => emit('data', { kind });

// Every save goes through util.writeText: written beside the file, flushed, renamed over it, the temporary file removed on failure.
const atomicWrite = writeText;
// What identifies a version of a file on disk: any save by Jade (a new file renamed over the old) or by hand changes at least one.
const sigOf = st => `${st.size}:${st.mtimeMs}:${st.ino}`;

// ---------- where a project's material lives
// The first project folder, when it is there and can be written to. A drive that is offline or a read-only folder gives a reason
// instead, and the item is kept in the data folder so nothing is lost.
const failures = new Map();   // projectId -> why the last write into the folder failed (cleared by the next good write)
/** The project's Jade folder, or null when the item belongs in the data folder (no project, no folder, folder not usable). */
const placeFor = projectId => usableJadeDir(projectId ? getProjectRaw(projectId) : null);
const reason = e => e?.code === 'EACCES' || e?.code === 'EPERM' || e?.code === 'EROFS' ? 'cannot be written to' : 'could not be written to';

/** One line for the project page when its folder is not being used (null when all is well or the project has no folder). */
export function storageNotice(projectId) {
  const p = getProjectRaw(projectId);
  const first = firstFolder(p);
  if (!first) return null;
  const why = folderProblem(first) || failures.get(p.id);
  if (why) return `The project folder ${first} ${why}, so this project's notes and actions are kept in Jade's data folder for now.`;
  const file = actionsFileOf(p), bad = fs.existsSync(file) ? inspectActions(file).bad : null;
  if (bad) return `The action list ${file} could not be read (it may have been edited by hand or cut short), so it has been left exactly as it is`
    + `${bad.copy ? ` and a copy was saved as ${bad.copy}` : ''}. New actions for this project are kept in Jade's data folder until it is fixed.`;
  return null;
}

/** Where projectDir would put <sub>, without making anything. Every reader asks this, so looking never creates a folder. */
export const projectPath = (projectId, sub = '') => pathFor(projectId ? getProjectRaw(projectId) : null, sub);

/** <first folder>/<folderName>/<sub> (created on demand), or the same sub-folder in the data folder when the project has no usable folder. For writers; readers use projectPath. */
export const projectDir = (projectId, sub = '') =>
  dirFor(projectId ? getProjectRaw(projectId) : null, sub, e => failures.set(slug(projectId), reason(e)));
// Write into a project's folder; on any failure remember why and tell the caller to use the data folder.
function tryProject(projectId, fn) {
  try { fn(); failures.delete(projectId); return true; }
  catch (e) { failures.set(projectId, reason(e)); return false; }
}

// ---------- watching the project folders. The data folder is watched by the server; these are the extra places, and only the two
// folders that matter (non-recursive), so a project's whole tree is never watched twice (the file index already does that).
const watching = new Map();   // dir -> watcher
const dataChanged = {};
const later = kind => { clearTimeout(dataChanged[kind]); dataChanged[kind] = setTimeout(() => changed(kind), 250); dataChanged[kind].unref?.(); };
function watchDirOnce(dir, fn) {
  if (watching.has(dir)) return;
  try { const w = fs.watch(dir, (ev, f) => fn(String(f || ''))); w.on('error', () => { w.close(); watching.delete(dir); }); w.unref?.(); watching.set(dir, w); } catch {}
}
/** Watch each project's first folder (for the Jade folder appearing), the Jade folder (actions.json) and its Notes folder. */
export function syncWatches() {
  const want = new Set();
  const name = jadeFolderName();
  for (const p of listProjects()) {
    const first = firstFolder(p);
    if (!first || folderProblem(first)) continue;
    want.add(first);
    watchDirOnce(first, f => { if (f === name) { syncWatches(); later('notes'); later('actions'); } });
    const jade = path.join(first, name);
    if (!fs.existsSync(jade)) continue;
    want.add(jade);
    watchDirOnce(jade, f => { if (f === PARTS.notes) { syncWatches(); later('notes'); } else if (f === PARTS.actions) later('actions'); });
    const notes = path.join(jade, PARTS.notes);
    if (!fs.existsSync(notes)) continue;
    want.add(notes);
    watchDirOnce(notes, f => { if (!f.endsWith('.tmp')) later('notes'); });
  }
  for (const [dir, w] of watching) if (!want.has(dir)) { try { w.close(); } catch {} watching.delete(dir); }
}

// ---------- projects
export function listProjects() {
  return fs.readdirSync(dirs.projects).filter(f => f.endsWith('.json'))
    .map(f => readJSON(path.join(dirs.projects, f), null)).filter(Boolean)
    .sort((a, b) => (a.archived - b.archived) || String(a.name).localeCompare(b.name));
}
function getProjectRaw(pid) { return pid ? readJSON(path.join(dirs.projects, slug(pid) + '.json'), null) : null; }
// The notice is added on the way out for the project page and never saved into the file.
export function getProject(pid) {
  const p = getProjectRaw(pid);
  const notice = p && storageNotice(p.id);
  return notice ? { ...p, storageNotice: notice } : p;
}

export function saveProject(p) {
  const now = new Date().toISOString();
  p = { ...p }; delete p.storageNotice;
  if (!p.id) {
    let base = slug(p.name), n = 1, pid = base;
    while (fs.existsSync(path.join(dirs.projects, pid + '.json'))) pid = `${base}-${++n}`;
    p = { createdAt: now, owner: '', description: '', folders: [], links: [], tags: [], ...p, id: pid };
  }
  p.updatedAt = now;
  writeJSON(path.join(dirs.projects, p.id + '.json'), p);
  changed('projects');
  syncWatches();
  return p;
}

export function patchProject(pid, patch) {
  const p = getProject(pid);
  if (!p) throw new Error('No project ' + pid);
  return saveProject({ ...p, ...patch, id: p.id });
}

// Deletes the project record only: whatever Jade saved in the project's folder stays there.
export function deleteProject(pid) {
  fs.rmSync(path.join(dirs.projects, slug(pid) + '.json'), { force: true });
  changed('projects');
  syncWatches();
}

// ---------- actions
// Each location is a JSON list: the data folder's actions.json, plus one per project with a folder. A record keeps every field it
// has (hand edits and newer fields included); one found in a project's file without a project gets that project.
//
// A list that cannot be parsed is never read as empty and never written over: the first time it is seen a copy is saved beside it
// as actions.json.corrupt-<time>, the file itself is left as it is, and that project's changes are kept in the data folder
// until someone fixes the file (the project page says so through storageNotice).
const unreadable = new Map();   // file -> { sig, copy } for each actions file that did not parse, as last seen
const actionCache = new Map(); // file -> { sig, list } the last good read, used while the file on disk is the same one (pruned to the files in use)
function inspectActions(file) {
  let st;
  try { st = fs.statSync(file); }
  catch (e) {
    actionCache.delete(file);
    if (e.code === 'ENOENT') { unreadable.delete(file); return { list: [] }; }
    return keepUnreadable(file, null, '');
  }
  const sig = sigOf(st), hit = actionCache.get(file);
  if (hit && hit.sig === sig) return { list: hit.list };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { actionCache.delete(file); return keepUnreadable(file, null, ''); }
  if (!text.trim()) { unreadable.delete(file); actionCache.delete(file); return { list: [] }; }
  try { const list = JSON.parse(text); if (Array.isArray(list)) { unreadable.delete(file); actionCache.set(file, { sig, list: list.map(x => x && typeof x === 'object' ? Object.freeze(x) : x) }); return { list: actionCache.get(file).list }; } } catch {}
  actionCache.delete(file);
  return keepUnreadable(file, text, sig);
}
function keepUnreadable(file, text, sig) {
  const seen = unreadable.get(file);
  if (seen && seen.sig === sig) return { bad: seen };
  let copy = '';
  if (text !== null) {
    try {
      const dir = path.dirname(file), base = path.basename(file);
      const same = fs.readdirSync(dir).find(f => f.startsWith(base + '.corrupt-') && fs.readFileSync(path.join(dir, f), 'utf8') === text);
      if (same) copy = path.join(dir, same);
      else {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        copy = path.join(dir, `${base}.corrupt-${stamp}`);
        for (let n = 2; fs.existsSync(copy); n++) copy = path.join(dir, `${base}.corrupt-${stamp}-${n}`);
        fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
      }
    } catch { copy = ''; }
  }
  const bad = { sig, copy };
  unreadable.set(file, bad);
  return { bad };
}
const actionsFileOf = p => path.join(jadeDir(p), PARTS.actions);
function actionFiles() {
  const out = [{ file: P('actions.json'), owner: '' }];
  for (const p of listProjects()) {
    const first = firstFolder(p);
    if (!first) continue;
    const file = actionsFileOf(p);
    if (fs.existsSync(file)) out.push({ file, owner: p.id });
  }
  return out;
}
function readActionFile({ file, owner }) {
  const { list = [] } = inspectActions(file);
  return list.filter(x => x && typeof x === 'object').map(x => owner && !x.project ? { ...x, project: owner } : x);
}
function allActions() {
  const seen = new Set(), out = [], locs = actionFiles();
  for (const loc of locs) for (const a of readActionFile(loc)) if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
  const live = new Set(locs.map(l => l.file));
  for (const f of actionCache.keys()) if (!live.has(f)) actionCache.delete(f);   // the memory holds only the lists in use
  return out;
}
export function listActions() { return allActions(); }

/** Actions for a list on a page, soonest due first: { status: open | done | all, project, owner, q (words in the text), limit, offset }. */
export function queryActions({ status = 'all', project = '', owner = '', q = '', limit = 1000, offset = 0 } = {}) {
  const want = String(q || '').trim().toLowerCase();
  return allActions()
    .filter(a => (status === 'all' || (status === 'done' ? a.status === 'done' : a.status !== 'done')) && (!project || a.project === project)
      && (!owner || a.owner === owner) && (!want || String(a.text || '').toLowerCase().includes(want)))
    .sort((x, y) => String(x.due || '9999').localeCompare(String(y.due || '9999')))
    .slice(offset, offset + limit);
}
/** Everyone who owns an action, sorted, for a filter list. */
export const actionOwners = () => [...new Set(allActions().map(a => a.owner).filter(Boolean))].sort();

// One actions file, written whole and indented (people read and edit these). What was written is remembered as the file's content.
function writeActions(file, items) {
  const st = atomicWrite(file, JSON.stringify(items, null, 2));   // the file as it was written, not as it is a moment later (a hand edit in between must not look like ours)
  try { actionCache.set(file, { sig: sigOf(st), list: items.map(x => x && typeof x === 'object' ? Object.freeze({ ...x }) : x) }); } catch { actionCache.delete(file); }
}

// Write the whole list back, each record to the file its project calls for. A file is rewritten only when its content changed.
// Order matters: files that only gain records go first, then the data folder (which holds whatever could not go elsewhere), and only
// then are records cleared out of a project file, so a failure part-way never leaves a record in no file at all.
function saveActions(list) {
  const old = actionFiles().filter(o => o.file === P('actions.json') || !inspectActions(o.file).bad);
  const home = P('actions.json');
  const groups = new Map();   // file -> items
  const put = (file, a) => { if (!groups.has(file)) groups.set(file, []); groups.get(file).push(a); };
  const fileOf = new Map();   // project -> its actions file, or '' for the data folder
  for (const a of list) {
    const key = a.project || '';
    if (!fileOf.has(key)) {
      const base = placeFor(key), f = base ? path.join(base, PARTS.actions) : home;
      fileOf.set(key, f !== home && inspectActions(f).bad ? home : f);   // an unreadable list is left alone
    }
    put(fileOf.get(key), a);
  }
  const files = new Set([...old.map(o => o.file), ...groups.keys(), home]);
  const ownerOf = new Map(old.map(o => [o.file, o.owner]));
  for (const [proj, f] of fileOf) if (!ownerOf.has(f)) ownerOf.set(f, proj);
  let touched = false;
  const writeOne = file => {
    const items = groups.get(file) || [];
    const before = old.find(o => o.file === file);
    if (!before && !items.length) return;
    if (before && JSON.stringify(readActionFile(before)) === JSON.stringify(items)) return;   // unchanged: not rewritten
    if (file === home) inspectActions(file);   // an unreadable data-folder list is copied aside first
    writeActions(file, items);
    touched = true;
  };
  const loses = file => {
    const before = old.find(o => o.file === file);
    if (!before) return false;
    const keep = new Set((groups.get(file) || []).map(a => a.id));
    return readActionFile(before).some(a => !keep.has(a.id));
  };
  const fail = (file, e) => {
    failures.set(ownerOf.get(file), reason(e));
    for (const a of groups.get(file) || []) put(home, a);
    groups.delete(file);
  };
  const clearing = [];
  for (const file of files) {
    if (file === home) continue;
    if (loses(file)) { clearing.push(file); continue; }
    try { writeOne(file); failures.delete(ownerOf.get(file)); } catch (e) { fail(file, e); }
  }
  // a record can be in two files after a failed move; the data folder's copy is the newer one
  const dedupeHome = () => { const seen = new Set(); groups.set(home, (groups.get(home) || []).filter(a => !seen.has(a.id) && seen.add(a.id))); };
  dedupeHome();
  writeOne(home);
  // only now may a project file lose records. One that cannot be written keeps them, and they are kept in the data folder too.
  let again = false;
  for (const file of clearing) {
    try { writeOne(file); failures.delete(ownerOf.get(file)); } catch (e) { fail(file, e); again = true; }
  }
  if (again) { dedupeHome(); writeActions(home, groups.get(home) || []); touched = true; }
  if (touched) changed('actions');
}

export function addAction(a) {
  const list = listActions();
  const text = String(a.text || '').trim();
  if (!text) throw new Error('Action needs text');
  // The same action means the same words (capitals and spacing aside), in the same project, for the same owner. Anything less would
  // link a meeting's item to somebody else's action that only shares the words.
  const words = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const dupe = list.find(x => x.status !== 'done' && words(x.text) === words(text) && (x.project || '') === (a.project || '') && words(x.owner) === words(a.owner));
  if (dupe) return dupe;
  const item = { id: id('a'), text, project: a.project || '', owner: a.owner || '', due: a.due || '', priority: a.priority || 'normal',
    status: 'open', source: a.source || 'manual', createdAt: new Date().toISOString() };
  list.unshift(item);
  saveActions(list);
  return item;
}

export function updateAction(aid, patch) {
  const list = listActions();
  const i = list.findIndex(x => x.id === aid);
  if (i < 0) throw new Error('No action ' + aid);
  list[i] = { ...list[i], ...patch, id: aid };
  if (patch.status === 'done' && !list[i].doneAt) list[i].doneAt = new Date().toISOString();
  if (patch.status === 'open') { delete list[i].doneAt; delete list[i].doneNote; }
  if (typeof patch.doneNote === 'string') list[i].doneNote = patch.doneNote.replace(/\s+/g, ' ').trim().slice(0, 400) || undefined;
  saveActions(list);
  return list[i];
}

export function deleteAction(aid) { saveActions(listActions().filter(x => x.id !== aid)); }

// ---------- notes (markdown)
// Locations: the data folder's notes/, plus <first folder>/<folderName>/Notes/ for each project that has a folder. A note with no
// project of its own in its frontmatter belongs to the project whose folder it sits in.
function noteDirs() {
  const out = [{ dir: dirs.notes, owner: '' }];
  for (const p of listProjects()) {
    const first = firstFolder(p);
    if (!first) continue;
    const dir = path.join(jadeDir(p), PARTS.notes);
    if (fs.existsSync(dir)) out.push({ dir, owner: p.id });
  }
  return out;
}
function findNote(nid) {
  const base = path.basename(String(nid));
  for (const { dir, owner } of noteDirs()) { const file = path.join(dir, base + '.md'); if (fs.existsSync(file)) return { file, owner }; }
  return null;
}
function readNote(file, owner = '') {
  const text = fs.readFileSync(file, 'utf8');
  const { data, body } = parseFrontmatter(text);
  const st = fs.statSync(file);
  return { id: path.basename(file, '.md'), title: data.title || path.basename(file, '.md'), project: data.project || owner,
    tags: data.tags || [], created: data.created || st.birthtime.toISOString(), updated: st.mtime.toISOString(), body, raw: data };
}
const publicNote = ({ raw, ...n }) => n;

// The list of notes is read once and kept. Each time it is asked for, every note file is checked against what was remembered
// (one look at its size, modified time and file number): a new, changed, renamed or deleted file, whoever did it, is picked up, and
// only that file is read again. What is kept per note is small (title, project, tags, dates, the first 220 characters); the text
// is kept too until it adds up to NOTE_TEXT_BUDGET characters, after which a note's text is read from its file when wanted.
// At most NOTE_CACHE_MAX notes are remembered; past that the rest are read each time (slower, still right).
const NOTE_CACHE_MAX = 20000, NOTE_TEXT_BUDGET = 16 * 1024 * 1024;
export const NOTE_PREVIEW = 220;
const noteCache = new Map();   // file -> { file, sig, owner, meta, preview, body|null, full|null }
let noteText = 0, notesSorted = null;
const dropNote = file => { const e = noteCache.get(file); if (e?.body) noteText -= e.body.length; noteCache.delete(file); };
function noteEntry(file, owner, st) {
  const n = publicNote(readNote(file, owner));
  const { body, ...meta } = n;
  return { file, sig: sigOf(st), owner, meta: Object.freeze(meta), preview: body.slice(0, NOTE_PREVIEW), body, full: null };
}
function sweepNotes() {
  const seen = new Set(), live = new Set(), overflow = [];
  let changedAny = !notesSorted;
  for (const { dir, owner } of noteDirs()) {
    let names = []; try { names = fs.readdirSync(dir); } catch {}
    for (const f of names) {
      if (!f.endsWith('.md')) continue;
      const nid = f.slice(0, -3);
      if (seen.has(nid)) continue;   // the first place a note is found wins
      const file = path.join(dir, f);
      let st; try { st = fs.statSync(file); } catch { continue; }
      const hit = noteCache.get(file);
      if (hit && hit.sig === sigOf(st) && hit.owner === owner) { seen.add(nid); live.add(file); continue; }
      let e; try { e = noteEntry(file, owner, st); } catch { continue; }
      seen.add(nid); changedAny = true;
      dropNote(file);
      if (noteCache.size < NOTE_CACHE_MAX) {
        if (noteText + e.body.length > NOTE_TEXT_BUDGET) e.body = null; else noteText += e.body.length;
        noteCache.set(file, e); live.add(file);
      } else { e.body = null; overflow.push(e); }
    }
  }
  for (const file of [...noteCache.keys()]) if (!live.has(file)) { dropNote(file); changedAny = true; }
  if (changedAny || overflow.length) notesSorted = [...noteCache.values(), ...overflow].sort((a, b) => b.meta.updated.localeCompare(a.meta.updated) || a.meta.id.localeCompare(b.meta.id));
  return notesSorted;
}
/** Every note, newest first, each { id, title, project, tags, created, updated, body }. The list and its notes are shared: do not change them. */
export function listNotes() {
  return sweepNotes().map(e => {
    if (e.full) return e.full;
    if (e.body === null) { try { return Object.freeze(publicNote(readNote(e.file, e.owner))); } catch { return null; } }   // text over the budget: from the file
    return (e.full = Object.freeze({ ...e.meta, body: e.body }));
  }).filter(Boolean);
}

/** One page of notes without their text, for a list: { total, items: [{ id, title, project, tags, created, updated, preview }] }, newest first. */
export function listNoteSummaries({ project = '', q = '', limit = 50, offset = 0 } = {}) {
  const want = String(q || '').trim().toLowerCase();
  const out = sweepNotes().filter(e => (!project || e.meta.project === project) && (!want || `${e.meta.title} ${e.preview}`.toLowerCase().includes(want)));
  return { total: out.length, items: out.slice(offset, offset + limit).map(e => ({ ...e.meta, preview: e.preview })) };
}

export function getNote(nid) {
  const f = findNote(nid);
  return f ? publicNote(readNote(f.file, f.owner)) : null;
}

/** Where saveNote would put a new note and under which id, without writing anything: { id, file, exists }. */
export function notePlan(n) {
  const nid = n.id ? path.basename(n.id) : `${today()}-${slug(n.title)}`;
  const pid = n.project && getProjectRaw(n.project)?.id;
  const file = pid && placeFor(pid) ? path.join(jadeDir(getProjectRaw(pid)), PARTS.notes, nid + '.md') : path.join(dirs.notes, nid + '.md');
  return { id: nid, file, exists: !!findNote(nid) };
}

export function saveNote(n) {
  const nid = n.id ? path.basename(n.id) : `${today()}-${slug(n.title)}`;
  const found = findNote(nid);
  // a note file that cannot be read is left as it is, never saved over
  let prev = null;
  if (found) try { prev = readNote(found.file, found.owner); } catch { throw Object.assign(new Error(`The note file ${found.file} could not be read, so it was left as it is`), { status: 409 }); }
  // frontmatter this code does not know about (added by hand or by Claude Code) is written back as it was
  const data = { ...prev?.raw, title: n.title || prev?.title || 'Untitled', project: n.project ?? prev?.project ?? '', tags: n.tags ?? prev?.tags ?? [],
    created: prev?.created || new Date().toISOString() };
  const text = stringifyFrontmatter(data, n.body ?? prev?.body ?? '');
  let file = null;
  const pid = data.project && getProjectRaw(data.project)?.id;
  if (pid && placeFor(pid)) {
    const target = path.join(jadeDir(getProjectRaw(pid)), PARTS.notes, nid + '.md');
    if (tryProject(pid, () => atomicWrite(target, text))) file = target;
  }
  if (!file) { file = path.join(dirs.notes, nid + '.md'); atomicWrite(file, text); }
  // moved to another project (or fell back): the old file goes, so the note is in one place only
  // (only once the new file is really there)
  if (found && path.resolve(found.file) !== path.resolve(file) && fs.existsSync(file)) try { fs.rmSync(found.file, { force: true }); } catch {}
  changed('notes');
  return publicNote(readNote(file, file.startsWith(dirs.notes + path.sep) ? '' : pid));
}

export function deleteNote(nid) {
  const f = findNote(nid);
  if (f) fs.rmSync(f.file, { force: true });
  changed('notes');
}

// ---------- long-term memory facts
export function readFacts() {
  const text = fs.readFileSync(P('memory', 'facts.md'), 'utf8');
  return text.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());
}
export function remember(fact) {
  fact = String(fact || '').replace(/\s+/g, ' ').trim();
  if (!fact || readFacts().some(f => f.toLowerCase() === fact.toLowerCase())) return;
  fs.appendFileSync(P('memory', 'facts.md'), `- ${fact}\n`);
  changed('memory');
}
export function forget(fact) {
  const file = P('memory', 'facts.md');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim() !== `- ${fact}`.trim());
  writeText(file, lines.join('\n'));
  changed('memory');
}

// ---------- conversations: .state/chats/<id>.json, one file per conversation with its turns inside.
// Saving a message writes that one conversation (compact JSON, a few KB to a few hundred KB), never the others. The list of
// conversations (title, dates, count, last words) is kept in memory; the conversations themselves are kept in memory too, the most
// recently used first, up to CHAT_CACHE_MAX of them or CHAT_CACHE_BYTES of saved text, and read from their file when not there.
// Earlier builds kept every conversation in one .state/chats.json (and, before that, one in chat.json): the first start moves them over
// (each conversation written, read back and compared, and only then the old file renamed to chats.json.migrated, which is kept as a backup).
// A conversation and its turns are frozen: take a copy to change one, then save it with the functions below.
const CHAT_CACHE_MAX = 64, CHAT_CACHE_BYTES = 24 * 1024 * 1024;
const CHAT_TURNS = 200;
const chatsDir = () => path.join(STATE, 'chats');
const chatFileName = cid => { const s = String(cid); return /^[A-Za-z0-9_-]{1,100}$/.test(s) ? s : `${slug(s)}-${crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)}`; };
const threadFile = cid => path.join(chatsDir(), chatFileName(cid) + '.json');
let chatIndex = null;           // id -> { ...everything but turns, count, preview }
let chatsSorted = null;         // the index, newest first (dropped when the index changes)
const chatCache = new Map();    // id -> { t, bytes }, least recently used first
let chatBytes = 0;
const chatPreview = turns => (turns.at(-1)?.text || '').replace(/\s+/g, ' ').slice(0, 120);
const chatMeta = ({ turns, ...t }) => Object.freeze({ ...t, count: turns.length, preview: chatPreview(turns) });
function freezeThread(t) { for (const x of t.turns) Object.freeze(x); Object.freeze(t.turns); return Object.freeze(t); }
function keepThread(t, bytes) {
  const old = chatCache.get(t.id); if (old) { chatBytes -= old.bytes; chatCache.delete(t.id); }
  chatCache.set(t.id, { t, bytes }); chatBytes += bytes;
  while (chatCache.size > 1 && (chatCache.size > CHAT_CACHE_MAX || chatBytes > CHAT_CACHE_BYTES)) { const [k, v] = chatCache.entries().next().value; chatCache.delete(k); chatBytes -= v.bytes; }
}
// An earlier build's chats.json (and the single-conversation chat.json before it) moved into one file each. Returns nothing; says why on failure.
function migrateOldChats(dir) {
  const oldFile = path.join(STATE, 'chats.json'), single = path.join(STATE, 'chat.json');
  const backup = file => { let to = file + '.migrated'; for (let n = 2; fs.existsSync(to); n++) to = `${file}.migrated-${n}`; fs.renameSync(file, to); };
  const move = threads => {
    for (const t of threads) {
      const file = threadFile(t.id);
      if (fs.existsSync(file)) continue;   // already moved (a start that was cut short): the file there is the newer one
      atomicWrite(file, JSON.stringify(t));
      if (JSON.stringify(readJSON(file, null)) !== JSON.stringify(t)) throw new Error(`the copy of conversation ${t.id} does not match`);
    }
  };
  try {
    if (fs.existsSync(oldFile)) {
      const old = readJSON(oldFile, null);
      if (!old || !Array.isArray(old.threads)) { console.error('chats.json could not be read, so it was left as it is and no conversations were moved from it'); return; }
      move(old.threads.filter(t => t && typeof t.id === 'string').map(t => ({ ...t, turns: Array.isArray(t.turns) ? t.turns : [] })));
      backup(oldFile);
    }
    if (fs.existsSync(single)) {
      const old = readJSON(single, null);
      if (old?.turns?.length) move([{ id: 'c' + crypto.createHash('sha1').update(JSON.stringify(old.turns)).digest('hex').slice(0, 12), title: titleFrom(old.turns), turns: old.turns, createdAt: old.turns[0].at, updatedAt: old.turns.at(-1).at }]);
      if (old) backup(single);
    }
  } catch (e) { console.error('Moving the conversations to their own files failed, so the old file was kept:', e.message); }
}
function loadChats() {
  if (chatIndex) return;
  const dir = fs.mkdirSync(chatsDir(), { recursive: true, mode: 0o700 }) || chatsDir();
  migrateOldChats(dir);
  const index = new Map();
  for (const f of fs.readdirSync(dir)) {
    const file = path.join(dir, f);
    if (f.endsWith('.tmp')) { try { fs.rmSync(file, { force: true }); } catch {} continue; }   // left by a save that was cut short; the real file beside it is whole
    if (!f.endsWith('.json')) continue;
    const t = readJSON(file, null);
    if (!t || typeof t.id !== 'string' || !Array.isArray(t.turns)) { console.error(`${file} is not a conversation, so it was left as it is`); continue; }
    index.set(t.id, chatMeta(t));
    keepThread(freezeThread(t), fs.statSync(file).size);
  }
  chatIndex = index; chatsSorted = null;
}
function loadThread(cid) {
  loadChats();
  if (!chatIndex.has(cid)) return null;
  const hit = chatCache.get(cid);
  if (hit) { chatCache.delete(cid); chatCache.set(cid, hit); return hit.t; }
  const file = threadFile(cid);
  const t = readJSON(file, null);
  if (!t || !Array.isArray(t.turns)) { chatIndex.delete(cid); chatsSorted = null; return null; }
  keepThread(freezeThread(t), (() => { try { return fs.statSync(file).size; } catch { return 0; } })());
  return t;
}
function saveThread(t) {
  loadChats();
  const text = JSON.stringify(t);
  atomicWrite(threadFile(t.id), text);
  chatIndex.set(t.id, chatMeta(t)); chatsSorted = null;
  keepThread(freezeThread(t), text.length);
  changed('chats');
  return t;
}
// A chat is titled by the first thing the user typed; one that began with only an image or a file is named for that instead.
const titleFrom = turns => {
  const first = turns.find(x => x.role === 'user' && String(x.text || '').trim()) || turns.find(x => x.role === 'user');
  const typed = String(first?.text || '').replace(/\s+/g, ' ').trim();
  const t = typed || (first?.files?.length ? path.basename(first.files[0]) : first?.images?.length ? 'Image' : 'New chat');
  return t.length > 60 ? t.slice(0, 57) + '…' : t;
};

/** The conversations, newest first, each without its turns: { id, title, count, preview, updatedAt, … }. limit/offset/q (words in the title or last words) are optional. */
export function listThreads({ limit, offset = 0, q = '' } = {}) {
  loadChats();
  chatsSorted ||= [...chatIndex.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const want = String(q || '').trim().toLowerCase();
  const list = want ? chatsSorted.filter(t => `${t.title} ${t.preview}`.toLowerCase().includes(want)) : chatsSorted;
  return limit === undefined ? [...list] : list.slice(offset, offset + limit);
}
/** One conversation with all its turns (frozen), or null. */
export function getThread(cid) { return loadThread(cid); }

// What a search compares with: the title and every turn's words in lower case, kept per conversation so a search does not read the
// conversations again. Bounded by total size (least recently used dropped, then worked out again from the conversation when asked);
// an entry is good only while the conversation's index entry is the one it was made from, so any save or removal discards it.
const SEARCH_TEXT_BYTES = 32 * 1024 * 1024;
const searchTexts = new Map();   // id -> { meta, lower }, least recently used first
let searchTextBytes = 0;
/** The lower-case text of a conversation (title, then every turn's text, one per line), or null if there is no such conversation. */
export function chatSearchText(cid) {
  loadChats();
  const meta = chatIndex.get(cid);
  const hit = searchTexts.get(cid);
  if (hit) { searchTexts.delete(cid); searchTextBytes -= hit.lower.length; if (hit.meta === meta) { searchTexts.set(cid, hit); searchTextBytes += hit.lower.length; return hit.lower; } }
  if (!meta) return null;
  const th = loadThread(cid); if (!th) return null;
  const lower = (th.title + '\n' + th.turns.map(x => x.text || '').join('\n')).toLowerCase();
  searchTexts.set(cid, { meta: chatIndex.get(cid), lower }); searchTextBytes += lower.length;
  while (searchTexts.size > 1 && searchTextBytes > SEARCH_TEXT_BYTES) { const [k, v] = searchTexts.entries().next().value; searchTexts.delete(k); searchTextBytes -= v.lower.length; }
  return lower;
}

export function newThread(title = '') {
  const now = new Date().toISOString();
  return saveThread({ id: id('c'), title: title || 'New chat', titled: !!title, turns: [], createdAt: now, updatedAt: now });
}

/** "recent" = continue the last conversation if it was active in the last 30 minutes, else start a new one. */
export function resolveThread(cid) {
  if (cid && cid !== 'recent' && getThread(cid)) return cid;
  if (cid === 'recent') {
    const last = listThreads()[0];
    if (last && Date.now() - Date.parse(last.updatedAt) < 30 * 60e3) return last.id;
  }
  return newThread().id;
}

export function appendTurn(cid, turn) {
  const cur = loadThread(cid);
  const now = new Date().toISOString();
  const base = cur || { id: cid || id('c'), title: 'New chat', turns: [], createdAt: now };
  const turns = [...base.turns, { at: new Date().toISOString(), ...turn, ...(typeof turn.text === 'string' ? { text: redact(turn.text) } : {}) }].slice(-CHAT_TURNS);
  const t = { ...base, turns, updatedAt: now };
  if (!t.titled) t.title = titleFrom(turns);
  return saveThread(t);
}

/** Change fields of one turn, found by its time stamp (a picture that was deleted after it was written up, a list of touched files). */
export function markTurn(cid, at, patch = {}) {
  const cur = loadThread(cid);
  const i = cur ? cur.turns.findIndex(x => x.at === at) : -1;
  if (i < 0) return null;
  const turns = cur.turns.slice();
  turns[i] = { ...turns[i], ...patch };
  saveThread({ ...cur, turns });
  return turns[i];
}

/** patch: { title?, model?, effort? } — model/effort are the conversation's own choice ('' = use the default). */
export function updateThread(cid, patch = {}) {
  const cur = loadThread(cid);
  if (!cur) throw new Error('No conversation ' + cid);
  const t = { ...cur };
  if (patch.title !== undefined) { t.title = String(patch.title || '').trim().slice(0, 80) || t.title; t.titled = true; }
  if (patch.model !== undefined) t.model = String(patch.model || '').trim().slice(0, 80);
  if (patch.effort !== undefined) t.effort = ['low', 'medium', 'high', 'xhigh', 'max'].includes(patch.effort) ? patch.effort : '';   // '' = the Settings default
  return saveThread(t);
}

export function deleteThread(cid) {
  loadChats();
  if (!chatIndex.has(cid)) return;
  fs.rmSync(threadFile(cid), { force: true });
  chatIndex.delete(cid); chatsSorted = null;
  const hit = chatCache.get(cid); if (hit) { chatBytes -= hit.bytes; chatCache.delete(cid); }
  changed('chats');
}

// ---------- small state files
export function state(name, fallback) { return readJSON(path.join(STATE, name + '.json'), fallback); }
export function setState(name, value, kind = name) { writeJSON(path.join(STATE, name + '.json'), value); changed(kind); return value; }

export function paths() { return { home: JADE_HOME, ...dirs }; }
