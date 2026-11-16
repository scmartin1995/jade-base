// What counts as an output: a final deliverable made from inputs (a finished guide, document, slide deck, workbook, dashboard).
// The file ring shows outputs only. The rules look at the path alone (never the contents) and live here and nowhere else: the
// browser receives class and flags from the server. The folder and file names the rules know are a setting (output.rules in
// config.json), with only generic names as the default. A user correction ("not an output" / "make it an output") is kept in
// .state/output-overrides.json and applied before any rule.
import path from 'node:path';
import * as config from './config.js';
import * as store from './store.js';
import * as files from './files.js';
import { expand } from './util.js';
import { slicer, runSync, runAsync } from './slices.js';

const FILE = 'output-overrides';
const MAX_OVERRIDES = 5000, MAX_PATH = 1000;

/** The names the rules know, all lower case. Override any of them under output.rules in config.json. bundleDir (a folder whose sub-folders are
 *  published as one unit, led by their index file) and recordDirs (folders of records, never outputs) are off until set. */
export const DEFAULT_RULES = {
  systemNames: ['index.md', '_index.md', 'readme.md', '_readme.md', 'log.md', 'claude.md', 'manifest.md'],
  inputDirs: ['input', 'inputs', 'raw', 'received'],
  workingDirs: ['work', 'scratch', 'tmp', 'drafts'],
  archiveDirs: ['_archive', 'archive'],
  outputDirs: ['output', 'outputs', 'deliverables'],
  recordDirs: [],
  bundleDir: '',
};
function rules() {
  const set = config.get().output?.rules || {}, r = {};
  for (const [k, d] of Object.entries(DEFAULT_RULES)) {
    const v = set[k];
    r[k] = Array.isArray(d) ? new Set((Array.isArray(v) ? v : d).map(x => String(x).toLowerCase())) : typeof v === 'string' ? v.toLowerCase() : d;
  }
  return r;
}
const SCRIPT_EXT = new Set(['.ps1', '.psm1', '.pl', '.js', '.mjs', '.py', '.bat', '.cmd', '.sh']);
const DOC_EXT = new Set(['.docx', '.pptx', '.pdf', '.xlsx', '.html']);

/** A path with forward slashes, no empty or "." parts. */
export const normalize = p => String(p ?? '').replace(/\\/g, '/').split('/').filter(s => s && s !== '.').join('/');
const extOf = name => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i) : ''; };

/** { path: 'output'|'not-output' } -> Map keyed by the lower-case normalised path. */
export function overrideMap(overrides) {
  if (overrides instanceof Map) return overrides;
  const m = new Map();
  for (const [k, v] of Object.entries(overrides || {})) if (v === 'output' || v === 'not-output') m.set(normalize(k).toLowerCase(), v);
  return m;
}

/**
 * Classify one path (relative to the folder that holds the project folders).
 * Returns { class, flags } where flags may hold 'loose', 'bundle:lead', 'bundle:member', 'overridden'.
 */
export function classify(relPath, { overrides } = {}) {
  const segs = normalize(relPath).split('/').filter(Boolean);
  const lower = segs.map(s => s.toLowerCase());
  const n = segs.length, R = rules();
  const ln = lower[n - 1] || '', ext = extOf(ln);
  const done = (cls, flags = []) => ({ class: cls, flags });

  // a user correction decides first
  const fix = overrideMap(overrides).get(lower.join('/'));
  if (fix === 'output') return done('output', ['overridden']);
  if (fix === 'not-output') return done('working', ['overridden']);
  if (!n) return done('working');

  // 1 ignore: hidden, backups, temp, lock files
  if (lower.some(s => s.startsWith('.')) || ln.endsWith('.tmp') || ln.endsWith('~') || ln.includes('.bak') || ln === 'thumbs.db'
    || /\.(lock|lck)$/.test(ln) || ln.startsWith('~$') || /(^|-)lock\.json$/.test(ln)) return done('ignore');
  // 2 archive
  if (lower.some(s => R.archiveDirs.has(s))) return done('archive');
  // 3 system
  if (R.systemNames.has(ln)) return done('system');
  // 4 skill
  if (lower.includes('skills') || ln === 'skill.md') return done('skill');
  // 5 input
  if (lower.some(s => R.inputDirs.has(s)) || ext === '.vtt') return done('input');
  // 6 tool
  if (lower.includes('tools') || SCRIPT_EXT.has(ext)) return done('tool');
  // 7 working
  if (lower.some(s => R.workingDirs.has(s)) || ln.includes('template')) return done('working');
  // 8 record (a live dashboard page kept beside its record is an output)
  if (lower.some(s => R.recordDirs.has(s))) return ext === '.html' && ln.includes('dashboard') ? done('output') : done('record');
  // 9 output
  const cf = R.bundleDir ? lower.indexOf(R.bundleDir) : -1;
  if (cf >= 0 && cf < n - 1) {
    if (n - cf >= 3) return done('output', [n === cf + 3 && (ln === 'index.html' || ln === 'index.md') ? 'bundle:lead' : 'bundle:member']);
    return done('output');
  }
  if (lower.some(s => R.outputDirs.has(s))) return ext === '.md' ? done('note') : done('output');
  if (ext === '.html' && ln.includes('dashboard')) return done('output');
  // 10 loose: a finished-document type saved in the wrong place (at most two path segments)
  if (DOC_EXT.has(ext) && n <= 2) return done('output', ['loose']);
  // 11 everything else
  return done('working');
}

// ---------------------------------------------------------------- user corrections
export function loadOverrides() {
  const s = store.state(FILE, { items: {} });
  const items = s && typeof s.items === 'object' && s.items && !Array.isArray(s.items) ? s.items : {};
  const out = {};
  for (const [k, v] of Object.entries(items)) if (v === 'output' || v === 'not-output') out[k] = v;
  return out;
}

const bad = msg => Object.assign(new Error(msg), { status: 400 });
const looksAbsolute = p => path.isAbsolute(p) || /^[a-z]:[\\/]/i.test(p) || p.startsWith('~') || p.startsWith('\\\\');

/** The path a file is classified and corrected by: relative to the folder that holds the project folders. */
function keyFor(rootDir, isProject, abs) {
  const rel = path.relative(rootDir, abs).split(path.sep).join('/');
  return isProject ? `${path.basename(rootDir)}/${rel}` : rel;
}
function keyForAbsolute(input) {
  const abs = path.resolve(expand(input));
  for (const r of files.roots()) {
    if (abs !== r.dir && abs.startsWith(r.dir + path.sep)) return keyFor(r.dir, !!r.project, abs);
  }
  throw bad('That file is not in a folder Jade reads');
}

/** Save a correction. `input` is a full path or the relative path from listOutputs; `as` is output | not-output | clear. */
export function setOverride(input, as) {
  if (typeof input !== 'string' || !input.trim()) throw bad('Which file?');
  if (input.length > MAX_PATH || input.includes('\0')) throw bad('That path is not valid');
  if (!['output', 'not-output', 'clear'].includes(as)) throw bad('"as" must be output, not-output or clear');
  const raw = input.trim();
  let key;
  if (looksAbsolute(raw)) key = keyForAbsolute(raw);
  else {
    key = normalize(raw);
    if (!key || key.split('/').includes('..')) throw bad('That path is not valid');
  }
  const items = loadOverrides();
  for (const k of Object.keys(items)) if (k.toLowerCase() === key.toLowerCase()) delete items[k];
  if (as !== 'clear') {
    if (Object.keys(items).length >= MAX_OVERRIDES) throw bad('Too many corrections saved');
    items[key] = as;
  }
  store.setState(FILE, { version: 1, items }, 'outputs');
  return { ok: true, path: input, as, key };
}

// ---------------------------------------------------------------- the list the ring and the bridge use
const titleOf = name => name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim() || name;

// Every output among the files, worked out once and kept until the file list, the corrections or the rules change.
let memo = null;
// A file's class is worked out once for as long as the corrections and the rules stay as they are: a file the list still holds
// (the list reuses a file's entry until that file changes) is not classified again, so one changed file costs one classification.
let classes = { sig: '', byFile: new WeakMap() };
function* outputRows(all, ov, due, rulesSig) {
  if (classes.sig !== rulesSig) classes = { sig: rulesSig, byFile: new WeakMap() };
  const known = classes.byFile;
  const bundleSizes = new Map(), rows = [];
  const bundleDir = rules().bundleDir;
  const bundleOf = key => { const segs = key.split('/'); const i = segs.findIndex(s => s.toLowerCase() === bundleDir); return segs.slice(0, i + 2).join('/').toLowerCase(); };
  for (const f of all) {
    if (due()) yield;
    let hit = known.get(f);
    if (!hit) {
      const key = f.root ? keyFor(f.root, !!f.project, f.path) : f.rel.split(path.sep).join('/');
      known.set(f, hit = { key, c: classify(key, { overrides: ov }) });
    }
    const { key, c } = hit;
    if (c.class !== 'output') continue;
    const inBundle = c.flags.includes('bundle:lead') || c.flags.includes('bundle:member');
    const bid = inBundle ? bundleOf(key) : '';
    if (bid) bundleSizes.set(bid, (bundleSizes.get(bid) || 0) + 1);
    if (c.flags.includes('bundle:member')) continue;
    rows.push({ f, key, c, bid });
  }
  return { rows, bundleSizes };
}

const rulesSignature = overrides => JSON.stringify(overrides) + '\n' + JSON.stringify(config.get().output?.rules || {});
const signature = rs => files.listVersion() + '\n' + rs;
let building = null;   // the one build in progress (async callers join it)

function shape({ rows: all, bundleSizes }, limit, project) {
  const rows = project ? all.filter(x => x.f.project === project) : all;
  const n = Math.floor(Number(limit));
  const cap = n >= 1 ? Math.min(5000, n) : 200;
  const out = rows.slice(0, cap).map(({ f, key, c, bid }) => {
    const p = f.rel.split(path.sep);
    const rootName = f.root ? path.basename(f.root) : '';
    const group = f.projectName || (p.length > 1 && rootName ? `${rootName}/${p[0]}` : rootName || 'Other');
    const area = f.project ? (p.length > 1 ? p[0] : 'General') : (p.length > 2 ? p[1] : 'General');
    const lead = c.flags.includes('bundle:lead');
    return {
      path: f.path, name: f.name, title: lead ? titleOf(path.basename(path.dirname(f.path))) : titleOf(f.name),
      project: f.project || '', group, area, modified: new Date(f.mtime).toISOString(), mtime: f.mtime, kind: f.kind,
      bundle: lead, bundleFiles: lead ? bundleSizes.get(bid) || 1 : 0, loose: c.flags.includes('loose'),
      class: c.class, flags: c.flags, key,
    };
  });
  out.total = rows.length;   // how many match, whatever the cap (a property of the list; JSON leaves it out)
  return out;
}

/** Outputs among the files Jade already indexes (files.scan), newest first. A bundle shows only its lead. */
export function listOutputs({ limit = 200, project = '' } = {}) {
  const all = files.scan(), overrides = loadOverrides(), rs = rulesSignature(overrides), sig = signature(rs);
  if (memo?.sig !== sig) memo = { sig, ...runSync(outputRows(all, overrideMap(overrides), slicer(), rs)) };
  return shape(memo, limit, project);
}
/** The same for a request: the list is worked out in short slices, once (callers meanwhile wait for it), and a call after that only picks rows from it. */
export async function listOutputsAsync({ limit = 200, project = '' } = {}) {
  const all = await files.list(), overrides = loadOverrides(), rs = rulesSignature(overrides), sig = signature(rs);
  if (memo?.sig !== sig) {
    if (building?.sig !== sig) {
      const b = building = { sig, done: runAsync(outputRows(all, overrideMap(overrides), slicer(), rs)).then(r => { memo = { sig, ...r }; }).finally(() => { if (building === b) building = null; }) };
    }
    await building.done;
  }
  return shape(memo.sig === sig ? memo : { sig, ...runSync(outputRows(all, overrideMap(overrides), slicer(), rs)) }, limit, project);
}
