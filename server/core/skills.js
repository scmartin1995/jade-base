// Skills: SKILL.md packages (same format Claude Code uses) that agents load on demand.
// Sources, in priority order: yours (data folder), built-in (app/skills), Claude Code's (~/.claude/skills), each project's .claude/skills, and installed plugins'. The last three are read-only.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as config from './config.js';
import * as store from './store.js';
import { parseFrontmatter, stringifyFrontmatter, writeText, slug, readJSON, writeJSON } from './util.js';
import { foldersOf } from './locations.js';
import { emit } from './bus.js';
import * as claudehome from './claudehome.js';
import * as allowances from './allowances.js';
import { mayRun } from './mayrun.js';


// Where skill folders live, in same-name precedence order: yours, built-in, claude, project, plugin.
function sources() {
  const out = [
    { kind: 'user', origin: 'yours', dir: store.dirs.skills },
    { kind: 'builtin', origin: 'built-in', dir: path.join(config.APP_ROOT, 'skills') },
    { kind: 'claude', origin: 'claude', dir: claudehome.skillsDir() },
  ];
  try {
    for (const p of store.listProjects()) for (const root of foldersOf(p))
      out.push({ kind: 'project', origin: 'project:' + p.id, dir: path.join(root, '.claude', 'skills'), root });
  } catch { /* no project list yet */ }
  for (const { plugin: name, root } of claudehome.pluginRoots()) out.push({ kind: 'plugin', origin: 'plugin:' + name, dir: path.join(root, 'skills'), root });
  return out;
}


// Agent-owned copies Jade installed into Claude Code: ~/.claude/skills/jade-<agent>-<skill>. The owner is the agent file whose name starts the folder name.
function ownerOf(folder) {
  if (!folder.startsWith('jade-')) return null;
  const agents = [];
  try { for (const f of fs.readdirSync(claudehome.agentsDir())) if (f.endsWith('.md')) agents.push(f.slice(0, -3)); } catch { /* none */ }
  const hit = agents.filter(a => folder.startsWith(a + '-')).sort((x, y) => y.length - x.length)[0];
  return hit || folder.replace(/-[^-]+$/, '') || folder;
}

const MAX_SKILL = 256 * 1024;   // a skill file from someone else's folder is never read past this
const untrusted = kind => kind === 'project' || kind === 'plugin';
function readSkill(dir, kind, origin, root) {
  const file = path.join(dir, 'SKILL.md');
  if (untrusted(kind)) {   // someone else's folder: no links (the folder, the file, or anything that leads out of it), and nothing huge
    try {
      if (fs.lstatSync(dir).isSymbolicLink()) return null;
      const st = fs.lstatSync(file);
      if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_SKILL) return null;
      const r = fs.realpathSync(root), f = fs.realpathSync(file);
      if (!f.startsWith(r + path.sep)) return null;
    } catch { return null; }
  } else if (!fs.existsSync(file)) return null;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }   // a SKILL.md that is a folder, or cannot be read: not a skill
  const { data, body } = parseFrontmatter(text);
  const name = String(data.name || path.basename(dir));
  const prefs = config.get().skills?.[name] || {};
  const usage = readJSON(path.join(config.STATE, 'skill-usage.json'), {})[name] || {};
  const ownedBy = kind === 'claude' ? ownerOf(path.basename(dir)) : null;
  // a skill from a project or a plugin must be allowed (by its folder's content) before chat can match it or a run can use it
  const allowState = untrusted(kind) ? allowances.status(dir, () => allowances.hashOf(dir)) : 'ok';
  return {
    name, kind, origin, dir, needsAllowance: allowState !== 'ok', allowChanged: allowState === 'changed', description: String(data.description || '').slice(0, 600),
    ...(ownedBy ? { ownedBy } : {}),
    // the schedule set on the Routines page (prefs.schedule) wins over the one the skill file suggests
    automation: prefs.schedule || data.automation || '', suggested: data.automation || '', perProject: !!data['per-project'], tags: data.tags || [],
    enabled: prefs.enabled ?? true,
    automationOn: !!(prefs.automation ?? false) && !!(prefs.schedule || data.automation),
    runs: usage.runs || 0, lastRun: usage.lastRun || null, body,
  };
}

export function list() {
  const seen = new Set();
  const out = [];
  for (const { kind, origin, dir, root } of sources()) {
    if (!fs.existsSync(dir)) continue;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      if (e.isSymbolicLink() && untrusted(kind)) continue;
      const s = readSkill(path.join(dir, e.name), kind, origin, root);
      if (!s) continue;
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      out.push(s);
    }
  }
  return out;
}

export function get(name) {
  return list().find(s => s.name === name);
}

// A skill in a project's folder or a plugin is someone else's. A built-in agent never takes its instructions from one (see forAgent).
const TRUSTED = new Set(['yours', 'built-in', 'claude']);
const pick = s => ({ name: s.name, description: s.description, body: s.body, dir: s.dir, origin: s.origin, enabled: s.enabled !== false });

/** Exact-name lookup across every source (a folder name works too); null when there is none. */
export function byName(name, { trustedOnly = false } = {}) {
  const s = list().find(x => (x.name === name || path.basename(x.dir) === name) && (!trustedOnly || TRUSTED.has(x.origin)));
  return s ? pick(s) : null;
}

/**
 * The skills an agent names, in order; names with no skill are left out. For a Jade agent (agentId) a name resolves first to its installed
 * copy jade-<id>-<name> (Claude Code's skills), then to the one shipped in the repo (agents/<id>/skills/<name>), then to any skill of that name.
 */
export function forAgent(names, agentId, { trustedOnly = false } = {}) {
  const only = !!agentId || trustedOnly;   // a built-in agent, or an agent not yet allowed, never takes a name from a project folder or a plugin
  const out = [];
  for (const n of names || []) {
    let s = null;
    if (agentId) {
      const pre = `jade-${agentId}-`;
      s = byName(n.startsWith(pre) ? n : pre + n, { trustedOnly: true });
      if (!s) {
        const dir = path.join(config.APP_ROOT, 'agents', agentId, 'skills', n);
        try { const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')); s = { name: String(data.name || n), description: String(data.description || ''), body, dir, origin: 'built-in', enabled: true }; } catch { /* not shipped */ }
      }
    }
    s ||= byName(n, { trustedOnly: only });   // a built-in agent never takes a name from a project folder or a plugin
    if (s && !out.some(o => o.name === s.name)) out.push(s);
  }
  return out;
}

const tok = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 3);

/** Skills relevant to a task, by word overlap with name + description. */
export function match(text, k = 2, always = []) {
  const want = new Set(tok(text));
  const active = list().filter(s => s.enabled && !s.ownedBy && mayRun({ skill: s }, 'offer').ok);   // a project's or a plugin's skill is matched only once the PM has allowed it // agent-owned copies are given to their agent by name, never by word overlap
  const picked = active.filter(s => always.includes(s.name));
  const scored = active.filter(s => !always.includes(s.name)).map(s => {
    const words = tok(s.name + ' ' + s.description);
    const hit = words.filter(w => want.has(w)).length;
    return [hit / Math.sqrt(words.length + 1), s];
  }).filter(([v]) => v > 0.35).sort((a, b) => b[0] - a[0]).slice(0, k).map(([, s]) => s);
  return [...picked, ...scored];
}

// A skill goes into the prompt by name, what it is for, and where its file is; the agent reads the file when it uses the skill.
// Sending every matched skill's full text (up to 6,000 characters each) with every chat message was over half of each message.
// A skill with no file on disk (none today) still goes in full, since there is nothing to read.
export function promptBlock(skills) {
  if (!skills.length) return '';
  const one = s => {
    const file = s.dir && path.join(s.dir, 'SKILL.md');
    return file && fs.existsSync(file) ? `- **${s.name}**: ${s.description}\n  Read its instructions before you use it: ${file}`
      : `### Skill: ${s.name}\n${s.description}\n\n${s.body.trim().slice(0, 6000)}`;
  };
  return '\n\n## Skills to follow\nThese skills match this request. Follow a skill only if it fits, and read its file first.\n' + skills.map(one).join('\n');
}

export function recordRun(name) {
  const f = path.join(config.STATE, 'skill-usage.json');
  const u = readJSON(f, {});
  u[name] = { runs: (u[name]?.runs || 0) + 1, lastRun: new Date().toISOString() };
  writeJSON(f, u);
}

/** Allow a project's or a plugin's skill as it is now (its whole folder), or take that back. */
export function allowSkill(name) {
  const s = list().find(x => x.name === name);
  if (!s || !untrusted(s.kind)) throw new Error('This skill is yours or Jade\'s own; it needs no allowing');
  allowances.put(s.dir, allowances.hashOf(s.dir)); emit('skills', {});
}
export function disallowSkill(name) {
  const s = list().find(x => x.name === name);
  if (!s || !untrusted(s.kind)) throw new Error('This skill is yours or Jade\'s own; it needs no allowing');
  allowances.drop(s.dir); emit('skills', {});
}

export function setPrefs(name, patch) {
  const cur = config.get().skills?.[name] || {};
  config.save({ skills: { [name]: { ...cur, ...patch } } });
  emit('skills', {});
}

export function save({ name, description, body, automation = '', perProject = false }) {
  const n = slug(name);
  const base = store.dirs.skills;
  const data = { name: n, description };
  if (automation) data.automation = automation;
  if (perProject) data['per-project'] = true;
  writeText(path.join(base, n, 'SKILL.md'), stringifyFrontmatter(data, String(body || '').trim() + '\n'));
  emit('skills', {});
  return n;
}

export function remove(name) {
  const s = get(name);
  if (!s || s.kind !== 'user') throw new Error('Only your own skills can be deleted');
  fs.rmSync(s.dir, { recursive: true, force: true });
  emit('skills', {});
}

/** Copy a Jade skill into Claude Code so it is available there too. */
export function installToClaude(name) {
  const s = get(name);
  if (!s) throw new Error('No skill ' + name);
  const to = path.join(claudehome.skillsDir(), s.name);
  if (fs.existsSync(path.join(to, 'SKILL.md'))) throw new Error('Claude Code already has a skill called ' + s.name);
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, 'SKILL.md'), stringifyFrontmatter({ name: s.name, description: s.description }, s.body.trim() + '\n'));
  emit('skills', {});
  return to;
}

/** Folders that exist now, to watch at start (a project's skills folder that does not exist yet is followed by agents.watch()). */
export function watchDirs() { return [...new Set(sources().map(s => s.dir))].filter(d => fs.existsSync(d)); }
/** Each project's .claude/skills folder, with the project folder it belongs to (the folder itself may not exist yet). */
export const projectSkillDirs = () => sources().filter(s => s.kind === 'project').map(s => ({ dir: s.dir, root: s.root }));

/** Open a skill's folder in the file manager (read-only sources have no editor in Jade). */
export function openFolder(name) {
  const s = get(name);
  if (!s) throw new Error('No skill ' + name);
  const [cmd, args] = process.platform === 'darwin' ? ['open', [s.dir]] : process.platform === 'win32' ? ['explorer.exe', [s.dir]] : ['xdg-open', [s.dir]];
  const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  c.on('error', () => {});
  c.unref();
  return s.dir;
}
