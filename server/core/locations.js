// Where a project's files live. The one place that knows a project's folders, the Jade sub-folder inside the first of them, the names
// of its parts, how "~" is read, and whether a path is inside a folder. Nothing here writes anything: the store makes folders on demand.
// A project is the plain object kept by store.js ({ folders: [...] }); this module never imports the store, so any file may use it.
import fs from 'node:fs';
import path from 'node:path';
import { expand, ensureDir } from './util.js';
import { JADE_HOME, get as cfg } from './config.js';

/** A saved path as an absolute one: "~" and "~/..." mean the home folder, anything else is resolved from the current folder. */
export const resolveHome = p => path.resolve(expand(String(p ?? '')));

/** Is `file` the folder `dir` itself or something below it? Compares plain paths (nothing is read from disk). */
export function within(dir, file) {
  const d = path.resolve(String(dir ?? '')), f = path.resolve(String(file ?? ''));
  return f === d || f.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
}

/** Something strictly below `dir` (not `dir` itself). */
export const below = (dir, file) => within(dir, file) && path.resolve(String(file ?? '')) !== path.resolve(String(dir ?? ''));

/** The name of the sub-folder where Jade keeps a project's own records (Settings: storage.folderName, "Jade" when unset or unusable). */
export const jadeFolderName = () => String(cfg().storage?.folderName ?? 'Jade').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().replace(/^\.+$/, '') || 'Jade';

/** Every folder the project points at, as absolute paths (blank entries and entries that are not text are left out). */
export const foldersOf = p => (Array.isArray(p?.folders) ? p.folders : []).filter(f => typeof f === 'string' && f.trim()).map(f => expand(f.trim()));

/** The project's chosen folder (the first one listed), or '' when it has none. Not checked for existing: see store.js for "usable". */
export const firstFolder = p => { const f = (p?.folders || [])[0]; return typeof f === 'string' && f.trim() ? expand(f.trim()) : ''; };

/** <chosen folder>/<Jade folder name>, or '' when the project has no folder. */
export const jadeDir = p => { const first = firstFolder(p); return first ? path.join(first, jadeFolderName()) : ''; };

/** The named parts of the Jade folder. Keep the on-disk names here, so a rename is one edit. */
export const PARTS = { notes: 'Notes', meetings: 'Meetings', dashboards: 'Dashboards', actions: 'actions.json' };

/** Why a folder cannot take Jade's records ('' when it can): it is not a folder, is missing, or cannot be written to. */
export function folderProblem(dir) {
  try { if (!fs.statSync(dir).isDirectory()) return 'is not a folder'; fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK); return ''; }
  catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'is missing' : 'cannot be written to'; }
}
/** The project's Jade folder when its chosen folder is there and can be written to; otherwise null (the records go to the data folder). */
export const usableJadeDir = p => { const first = firstFolder(p); return first && !folderProblem(first) ? jadeDir(p) : null; };

const subParts = sub => String(sub || '').split(/[\\/]+/).filter(x => x && x !== '.' && x !== '..');
// the data folder keeps these lower-case ("Notes" is notes/), the way it always has
const dataPath = parts => path.join(JADE_HOME, ...parts.map((x, i) => i ? x : x.toLowerCase()));

/** Where <sub> of a project's records is: inside its Jade folder, or in the data folder when it has no usable folder. Makes nothing: every reader asks this. */
export function pathFor(p, sub = '') {
  const parts = subParts(sub), base = usableJadeDir(p);
  return base ? path.join(base, ...parts) : dataPath(parts);
}
/** The same place, made if it is not there yet (for writers). If the project's folder refuses, onFail(error) hears why and the data folder is used. */
export function dirFor(p, sub = '', onFail) {
  const parts = subParts(sub), base = usableJadeDir(p);
  if (base) {
    try { return ensureDir(path.join(base, ...parts)); } catch (e) { onFail?.(e); }
  }
  return ensureDir(dataPath(parts));
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Is this file one of Jade's own records inside a project folder (the Jade folder's meetings, dashboards and action list, or any Dashboards folder)? */
export function isJadeRecord(file) {
  const n = escapeRe(jadeFolderName()), sep = '[\\\\/]';
  return new RegExp(`${sep}${n}${sep}(?:${PARTS.meetings}|${PARTS.dashboards})${sep}|${sep}${n}${sep}${escapeRe(PARTS.actions)}$|${sep}${PARTS.dashboards}${sep}`).test(String(file ?? ''));
}
