// Where an agent's files come from. Lookup order for any file:
//   1. the user's own copy in the Jade folder (<data folder>/<agent>/<file>): a user's edit always wins
//   2. the copy bundled with Jade (agents/<agent>/<file>), so Jade runs with nothing set up
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as config from './config.js';
import * as store from './store.js';
import * as claudehome from './claudehome.js';
import * as skills from './skills.js';
import * as allowances from './allowances.js';
import { parseFrontmatter, stringifyFrontmatter, writeText, readJSON, writeJSON } from './util.js';
import { foldersOf } from './locations.js';

/** The folders an agent's files may come from, in lookup order. */
export function homes(agent) {
  return [path.join(config.JADE_HOME, agent), path.join(config.APP_ROOT, 'agents', agent)];
}

/** The first of these files found, in lookup order (the same file name across all homes before the next name). */
export function find(agent, ...names) {
  for (const name of names) for (const dir of homes(agent)) { const f = path.join(dir, name); if (fs.existsSync(f)) return f; }
  return '';
}

/** Where a file came from, for showing on a page: "yours" or "built in". */
export function origin(file) {
  if (!file) return '';
  return file.startsWith(config.JADE_HOME + path.sep) ? 'yours' : 'built in';
}

// ---------------------------------------------------------------- agents as Claude Code files
// An agent is a Claude Code agent file: front matter name, description, tools, model, skills, then the prompt. What only Jade needs
// is in extra jade- keys (jade-handler, jade-context, jade-input, jade-edits, jade-loop, jade-kind, jade-icon, jade-schedule,
// jade-module, jade-hidden, jade-checked, jade-connectors, jade-id, jade-name), which Claude Code ignores. A user's old Jade file used
// the same words without the prefix (handler:, context:, …), so both are read; the prefixed key wins.
const key = (d, k) => d['jade-' + k] ?? d[k];
// A file in a project's folder or a plugin comes from someone else. It is always listed, and the PM can run it by hand at any time, but
// until the PM has allowed that one file (see below) its jade- keys are not honoured: no edit rights, no schedule, no context or
// connectors, no handler of its own, and the bridge cannot start it. A hand-started run of it is read-only.
const TRUSTED = new Set(['yours', 'built-in']);
export const isTrusted = origin => TRUSTED.has(origin);
const POWER_KEYS = new Set(['id', 'handler', 'loop', 'edits', 'schedule', 'input', 'context', 'connectors', 'kind', 'checked', 'module', 'hidden', 'effort', 'web', 'read']);

// ---------------------------------------------------------------- allowances
// "Allow this agent to work on its own": kept in the data folder (allowances.js) by the agent file's real path, with a hash of the file's
// text and of the skills it names. Only a file of a project or a plugin ever needs one. When the file or one of those skills is
// different from when it was allowed, the allowance no longer counts and the page asks again ("changed since you allowed it").
const MAX_FILE = 256 * 1024;   // an agent file from someone else's folder is never read past this
/** The text of an agent file, and what to hash with it: { text, hash, skills: { name: hash } }. */
function fingerprint(text) {
  return { hash: allowances.sha(text), skills: skillHashes(text) };
}
function skillHashes(text) {
  const names = listOf(parseFrontmatter(text).data.skills);
  const sk = {};
  for (const n of names) { const s = skills.byName(n); if (s?.dir) sk[n] = allowances.hashOf(s.dir); }
  return sk;
}
/** 'none' | 'ok' | 'changed' for a project's or a plugin's agent file. */
export function allowState(file, text = fs.readFileSync(file, 'utf8')) {
  return allowances.status(file, () => allowances.sha(text), () => skillHashes(text));
}
/** Whether the PM has allowed this agent file, as it is now. */
export const isAllowed = file => { try { return allowState(file) === 'ok'; } catch { return false; } };
/** Every allowance: { <real path>: { at, hash } }. */
export const allowedFiles = () => allowances.entries();
/** Allow one agent file (a project's or a plugin's), as it is now. */
export function allow(file) {
  const f = fingerprint(fs.readFileSync(file, 'utf8'));
  allowances.put(file, f.hash, f.skills);
}
/** Take the allowance back. */
export const disallow = file => allowances.drop(file);
const listOf = v => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? v.split(',').map(s => s.trim()).filter(Boolean) : []);
const APP_AGENTS = () => path.join(config.APP_ROOT, 'agents');

/** One agent file as a definition, or null when it is not an agent file. */
export function parseAgent(file, origin) {
  const trusted = TRUSTED.has(origin);
  if (!trusted) {   // someone else's folder: no links, and nothing huge
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_FILE) throw new Error('not a plain agent file of a sensible size');
  }
  const text = fs.readFileSync(file, 'utf8');
  const { data: all, body } = parseFrontmatter(text);
  const state = trusted ? 'ok' : allowState(file, text), allowed = state === 'ok';
  const data = allowed ? all : Object.fromEntries(Object.entries(all).filter(([k]) => !(k.startsWith('jade-') && POWER_KEYS.has(k.slice(5))) && !POWER_KEYS.has(k)));
  const id = String(key(data, 'id') || path.basename(file, '.md'));
  const handlerNamed = key(data, 'handler'), loop = key(data, 'loop') || '';
  return {
    id, name: String(key(data, 'name') || data.name || id), description: String(data.description || ''), origin, module: key(data, 'module') || '',
    icon: key(data, 'icon') || 'spark', input: key(data, 'input') || 'none', context: listOf(key(data, 'context')), connectors: listOf(key(data, 'connectors')),
    noRead: String(key(data, 'read') || '').toLowerCase() === 'none',   // jade-read: none: the run gets no file-reading tools at all (Dreams)
    webSetting: String(key(data, 'web') || ''),   // jade-web: <setting>: the web connector is used only while that setting is on (e.g. dreams.web)
    handler: handlerNamed || 'markdown', schedule: key(data, 'schedule') || '', skills: listOf(data.skills), hidden: !!key(data, 'hidden'),
    edits: !!key(data, 'edits'), loop, kind: key(data, 'kind') || '', checked: !!key(data, 'checked'),
    tools: listOf(data.tools), model: data.model ? String(data.model) : '',
    effort: String(data['jade-effort'] || ''),   // how hard it thinks; beats agents.effort in Settings
    // Your own and Jade's agents run only when the file says how (a handler or a loop); any other is shown and readable. A project's or a
    // plugin's can always be started by hand (as a plain, read-only run until it is allowed).
    runnable: !!(handlerNamed || loop) || !trusted, jadeKeys: Object.keys(all).some(k => k.startsWith('jade-')),
    trusted, allowed, needsAllowance: !allowed, allowChanged: state === 'changed',
    // what the file asks for, whether or not it has been allowed yet (shown next to the allow button)
    asks: { handler: String(key(all, 'handler') || ''), loop: String(key(all, 'loop') || ''), edits: !!key(all, 'edits'), schedule: String(key(all, 'schedule') || ''),
      tools: listOf(all.tools), context: listOf(key(all, 'context')), connectors: listOf(key(all, 'connectors')), skills: listOf(all.skills),
      effort: String(all['jade-effort'] || ''), input: String(key(all, 'input') || ''), kind: String(key(all, 'kind') || ''), hidden: !!key(all, 'hidden'),
      module: String(key(all, 'module') || ''), web: String(key(all, 'web') || ''), checked: !!key(all, 'checked'), id: String(key(all, 'id') || ''), jadeKeys: Object.keys(all).filter(k => k.startsWith('jade-')) },
    custom: origin === 'yours', file, body,
  };
}

const mdFiles = dir => { try { return fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.endsWith('.new.md')).sort().map(f => path.join(dir, f)); } catch { return []; } };  // .new.md is a copy beside yours, not an agent
/** Whether a file's real path is inside the real path of the folder it was found in (used for someone else's folders). */
export function staysInside(file, root) {
  try {
    const r = fs.realpathSync(root), f = fs.realpathSync(file);
    return f === r || f.startsWith(r + path.sep);
  } catch { return false; }
}
const safe = (file, origin) => { try { return parseAgent(file, origin); } catch { return null; } };   // a half-saved file is skipped until it parses

/** The folders agents come from besides Jade's own: [{ origin, dir }] (yours, each project's, each plugin's). */
export function sources() {
  const out = [{ origin: 'yours', dir: store.dirs.agents, legacy: true }, { origin: 'yours', dir: claudehome.agentsDir() }];
  try {
    for (const p of store.listProjects()) for (const root of foldersOf(p))
      out.push({ origin: 'project:' + p.id, dir: path.join(root, '.claude', 'agents'), root });
  } catch { /* no project list yet */ }
  for (const { plugin, dir } of claudehome.pluginAgentDirs()) out.push({ origin: 'plugin:' + plugin, dir, root: path.dirname(dir) });
  return out;
}

/** Every agent Jade can see. Built-ins first; yours override a built-in with the same id (an installed jade-<id>.md does). */
export function discover() {
  const byId = new Map(), builtin = new Set();
  for (const f of mdFiles(APP_AGENTS())) {
    const d = safe(f, 'built-in'); if (!d) continue;
    byId.set(d.id, { ...d, builtin: true, group: 'built-in', source: f }); builtin.add(d.id);
  }
  const over = (d, extra = {}) => {
    const base = byId.get(d.id);
    // Your file wins over the built-in one with the same id. But a file that names no handler is not a whole agent, it is a
    // note to the built-in one ("also do this before you publish"): it keeps the built-in's handler, context, connectors and
    // schedule, and its text is added after the built-in's.
    if (base && !base.custom && !d.runnable) {
      byId.set(d.id, { ...base, description: d.description || base.description, custom: true, origin: 'yours', extends: base.file, file: d.file,
        context: d.context.length ? d.context : base.context, connectors: d.connectors.length ? d.connectors : base.connectors,
        skills: d.skills.length ? d.skills : base.skills, schedule: d.schedule || base.schedule, tools: d.tools.length ? d.tools : base.tools,
        model: d.model || base.model, body: `${base.body.trim()}\n\n${d.body.trim()}\n`, ...extra });
    } else byId.set(d.id, { ...d, builtin: builtin.has(d.id), group: builtin.has(d.id) ? 'built-in' : d.origin, ...(base?.source ? { source: base.source } : {}), ...extra });
  };
  const add = d => {   // not an override: a second agent of the same id keeps both, the later one named by where it lives
    if (byId.has(d.id)) { d.id = `${d.id}@${d.origin}`; if (byId.has(d.id)) return; }
    byId.set(d.id, { ...d, builtin: false, group: d.origin });
  };
  for (const { origin, dir, legacy, root } of sources()) {
    for (const f of mdFiles(dir)) {
      if (root && !staysInside(f, root)) continue;   // a link out of a project's or a plugin's folder is not an agent
      const d = safe(f, origin); if (!d) continue;
      const installed = origin === 'yours' && !legacy && builtin.has(d.id) && path.basename(f) === `jade-${d.id}.md`;
      if (legacy) over(d, { legacy: true });
      else if (installed) over(d, { installed: true });
      else add(d);
    }
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------- installing the built-ins into Claude Code
// Jade's built-ins run from the app folder until installed. Installing copies each to <claude home>/agents/jade-<id>.md and the
// skills it owns (agents/<id>/skills/<skill>/) to <claude home>/skills/jade-<id>-<skill>/. A hash of what was written is kept in
// the data folder; a file whose content no longer matches it was changed by you and is never overwritten.
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const RECORD = () => path.join(config.STATE, 'agents-installed.json');
const frontEnd = /^---\r?\n[\s\S]*?\r?\n---/;

function ownedDirs(id) {
  try { return fs.readdirSync(path.join(APP_AGENTS(), id, 'skills'), { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join(APP_AGENTS(), id, 'skills', e.name, 'SKILL.md'))).map(e => e.name).sort(); } catch { return []; }
}
// the installed agent names its owned skills by their installed folder names, which Claude Code finds under skills/
function rewriteAgent(text, id, owned) {
  return text.replace(frontEnd, fm => fm.replace(/^skills:.*$/m, line => {
    const names = listOf(parseFrontmatter(fm).data.skills);
    return names.length ? `skills: [${names.map(n => (owned.includes(n) ? `jade-${id}-${n}` : n)).join(', ')}]` : line;
  }));
}
function rewriteSkill(text, name) {
  if (!frontEnd.test(text)) return text;
  return /^name:.*$/m.test(text.match(frontEnd)[0]) ? text.replace(frontEnd, fm => fm.replace(/^name:.*$/m, `name: ${name}`)) : text.replace(/^---\r?\n/, `---\nname: ${name}\n`);
}
function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walk(dir, path.join(rel, e.name))); else out.push(path.join(rel, e.name));
  }
  return out;
}

/** What installing would write: [{ id, kind: 'agent' | 'skill', target, content }] for every built-in with a jade-id. */
export function plan() {
  const items = [];
  for (const f of mdFiles(APP_AGENTS())) {
    const d = safe(f, 'built-in'); if (!d) continue;
    const owned = ownedDirs(d.id);
    items.push({ id: d.id, name: d.name, kind: 'agent', target: path.join(claudehome.agentsDir(), `jade-${d.id}.md`), content: Buffer.from(rewriteAgent(fs.readFileSync(f, 'utf8'), d.id, owned)) });
    for (const s of owned) {
      const src = path.join(APP_AGENTS(), d.id, 'skills', s), to = path.join(claudehome.skillsDir(), `jade-${d.id}-${s}`);
      for (const rel of walk(src)) {
        const raw = fs.readFileSync(path.join(src, rel));
        items.push({ id: d.id, name: d.name, kind: 'skill', target: path.join(to, rel), content: rel === 'SKILL.md' ? Buffer.from(rewriteSkill(raw.toString('utf8'), `jade-${d.id}-${s}`)) : raw });
      }
    }
  }
  return items;
}

const readRecord = () => readJSON(RECORD(), { files: {} }).files || {};
// ok: on disk as Jade last wrote it (or the same as what Jade has now) · new: not there · update: Jade's copy moved on and yours is untouched ·
// changed: yours differs from what Jade wrote, so it is kept (newer: Jade also has a newer version)
function fileState(it, rec) {
  if (!fs.existsSync(it.target)) return { state: 'new' };
  const cur = sha(fs.readFileSync(it.target)), want = sha(it.content), last = rec[it.target];
  if (cur === want) return { state: 'ok' };
  if (!last) return { state: 'changed', newer: true };   // there before Jade wrote anything: not Jade's to replace
  return cur === last ? { state: 'update' } : { state: 'changed', newer: want !== last };
}

/** not installed / installed / updates available / changed by you, with each agent's own state. */
export function installStatus() {
  const rec = readRecord(), items = plan();
  const agents = new Map(), changed = [];
  let present = 0;
  for (const it of items) {
    const st = fileState(it, rec);
    if (st.state !== 'new') present++;
    const a = agents.get(it.id) || agents.set(it.id, { id: it.id, name: it.name, state: 'ok', files: [] }).get(it.id);
    a.files.push({ path: it.target, ...st });
    const rank = { ok: 0, new: 1, update: 2, changed: 3 };
    if (rank[st.state] > rank[a.state]) a.state = st.state;
    if (st.state === 'changed') changed.push({ id: it.id, path: it.target, newer: !!st.newer });
  }
  const all = [...agents.values()];
  const state = !present ? 'not-installed' : all.some(a => a.state === 'new' || a.state === 'update') ? 'updates' : changed.length ? 'changed' : 'installed';
  const label = { 'not-installed': 'Not installed', installed: 'Installed', updates: 'Updates available', changed: 'Changed by you' }[state];
  return { state, label, claudeHome: claudehome.home(), agents: all, changed };
}

/**
 * Copy the built-ins (or only `ids`) into Claude Code's folders. Missing files are written, untouched older ones are updated, files
 * you changed are never overwritten: they are reported in `kept` and, only when writeNew is set, Jade's version is written beside
 * them (jade-<id>.new.md, SKILL.new.md).
 */
export function install({ ids, writeNew = false } = {}) {
  const rec = readRecord();
  const written = [], updated = [], kept = [], beside = [];
  for (const it of plan().filter(i => !ids?.length || ids.includes(i.id))) {
    const st = fileState(it, rec);
    if (st.state === 'ok') { rec[it.target] = sha(it.content); continue; }
    if (st.state === 'changed') {
      kept.push({ id: it.id, path: it.target, newer: !!st.newer });
      if (writeNew) { const p = path.parse(it.target), n = path.join(p.dir, `${p.name}.new${p.ext}`); fs.writeFileSync(n, it.content); beside.push(n); }
      continue;
    }
    fs.mkdirSync(path.dirname(it.target), { recursive: true });
    fs.writeFileSync(it.target, it.content);
    rec[it.target] = sha(it.content);
    (st.state === 'update' ? updated : written).push(it.target);
  }
  writeJSON(RECORD(), { files: rec });
  return { written, updated, kept, beside, status: installStatus() };
}

// ---------------------------------------------------------------- editing
/** Change an agent file's description, prompt, tools or model in place, keeping every other key (Jade's too). A model is only ever cleared or kept, never typed. */
export function editFile(file, { description, prompt, tools, clearModel } = {}) {
  const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  if (description !== undefined) data.description = String(description);
  if (tools !== undefined) { const t = listOf(tools); if (t.length) data.tools = t.join(', '); else delete data.tools; }
  if (clearModel) delete data.model;
  writeText(file, stringifyFrontmatter(data, prompt !== undefined ? String(prompt).replace(/\s*$/, '\n') : body));
}

// ---------------------------------------------------------------- making a new agent of yours (Dreams offers one; the PM confirms)
/** The only tools an agent made from an idea may ask for: reading and looking things up, never editing or running commands. */
export const SAFE_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'];
export const validName = n => typeof n === 'string' && n.length <= 40 && /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(n) && !n.startsWith('jade-');

/** The file a new agent of yours would be, and its full text. Nothing is written. Throws with a plain sentence when it cannot be made. */
export function draftAgent({ name, description, tools, prompt } = {}) {
  name = String(name || '').trim();
  if (!validName(name)) throw new Error('The agent\'s name must be short lower-case words joined by dashes, and not start with "jade-".');
  if (!String(prompt || '').trim()) throw new Error('The agent has no instructions.');
  const file = path.join(claudehome.agentsDir(), `${name}.md`);
  if (fs.existsSync(file) || discover().some(a => a.id === name || a.name === name)) throw new Error(`There is already an agent called ${name}.`);
  const asked = listOf(tools).filter(t => SAFE_TOOLS.includes(t));
  const text = stringifyFrontmatter({ name, description: String(description || '').replace(/\s+/g, ' ').trim() || name, tools: (asked.length ? asked : ['Read', 'Grep', 'Glob']).join(', '), 'jade-handler': 'markdown' }, String(prompt).trim() + '\n');
  return { file, text };
}

/** Write a drafted agent into Claude Code's agents folder (it then shows on the Agents page as yours). Never overwrites. */
export function createAgent(draft) {
  const d = draftAgent(draft);
  fs.mkdirSync(path.dirname(d.file), { recursive: true });
  fs.writeFileSync(d.file, d.text, { flag: 'wx' });
  return d.file;
}
