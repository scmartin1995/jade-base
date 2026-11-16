// What Jade may change, and when it asks first. Jade edits like Claude Code does (Edit, Write, Bash), with Jade as the
// permission prompt: every tool call Claude Code has not been pre-approved for comes here (through server/mcp/approve.mjs)
// and is decided by policy in a millisecond, or put in front of the user when the policy says so.
//
// Modes (config.permissions.mode):
//   read          nothing is changed (the agents only get Read, Glob, Grep)
//   ask           every change asks
//   irreversible  ask only before something that cannot be undone: deleting files the user gave Jade or Jade's
//                 deliverables, destructive commands, and writes through connectors (send, delete, share…).
//                 Edits and overwrites are made reversible instead: the previous version is kept and can be restored.
//   auto          never ask (everything is still logged and backed up)
// Jade's own scratch files (<JADE_HOME>/.state/tmp and <JADE_HOME>/work) are free in every mode but "read". What decides what is allowed
// (the allowance and install records, config.json, engine.env, the key, the agent and skill folders) is never free: see isJadeOwned.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as config from './config.js';
import * as store from './store.js';
import * as claudehome from './claudehome.js';
import * as provider from './provider.js';
import { emit } from './bus.js';
import { id as newId, expand, writeText } from './util.js';
import { foldersOf, resolveHome } from './locations.js';
import { explain } from './explain.js';

export const MODES = {
  read: { label: 'Read only', desc: 'Jade reads and advises; nothing on disk changes.' },
  ask: { label: 'Ask before every change', desc: 'Every edit, new file and command waits for your yes.' },
  irreversible: { label: 'Ask only for the irreversible', desc: 'Edits are kept restorable and just happen. Jade asks before deleting anything you gave it or any deliverable, before destructive commands, and before writing through a connector.' },
  auto: { label: 'Auto', desc: 'Never asks. Every change is still logged, and edits are still restorable.' },
};
export const mode = () => (MODES[config.get().permissions?.mode] ? config.get().permissions.mode : 'irreversible');

const CHANGES = () => path.join(config.STATE, 'changes.json');
const BACKUPS = () => path.join(config.STATE, 'backups');
const norm = resolveHome;
const under = (p, dir) => { const a = norm(p), b = norm(dir); return a === b || a.startsWith(b + path.sep); };

/** Where things are: Jade's free working folders, and everything the user gave Jade or Jade made for them. */
export function zones() {
  const c = config.get();
  const home = config.JADE_HOME;
  const free = [config.STATE, path.join(home, 'work'), os.tmpdir()];
  let projects = []; try { projects = store.listProjects(); } catch {}
  const protectedZ = [home, ...c.memory.folders.map(expand), ...(c.output?.folder ? [expand(c.output.folder)] : []),
    ...projects.flatMap(foldersOf)].filter(Boolean);
  return { free, protected: [...new Set(protectedZ.map(norm))] };
}
export function workDir() { const d = path.join(config.JADE_HOME, 'work'); fs.mkdirSync(d, { recursive: true }); return d; }
const isProtected = p => zones().protected.some(z => under(p, z));
/** Where Jade may create and edit files: the user's home folder, any folder they added, and every protected zone. */
export function roots() {
  const extra = (config.get().permissions?.roots || []).map(expand);
  return [...new Set([os.homedir(), ...extra, ...zones().protected].map(norm))];
}
const isEditable = p => roots().some(z => under(p, z));
// Jade's working folders are free even though they sit inside the Jade folder; the system temp folder is free only
// where nothing protected lives inside it.
// Agents' own knowledge (rules, criteria, lessons) and their records (its verdict log). Your edits by hand still
// work; no run, chat included, may change them, or one model could rewrite the rules another one is judged by.
const AGENT_KNOWLEDGE = ['skeptic', 'build'];
export const isAgentOwned = p => AGENT_KNOWLEDGE.some(a => under(p, path.join(config.JADE_HOME, a)) || under(p, path.join(config.STATE, a)));
const isFree = p => under(p, path.join(config.STATE, 'tmp')) || under(p, path.join(config.JADE_HOME, 'work')) || (under(p, os.tmpdir()) && !isProtected(p));

// ------------------------------------------------------------------ what a run may never change without asking
// The files that decide what is allowed or how Jade reaches Claude, and the folders agent and skill files are read from. A run that changes
// one could widen its own rights (or a later run's), so it is asked about in every mode but "read", auto included, and "allow for this run" does not cover it.
const real = p => {   // the path with links resolved as far as it exists, so a link into an owned place does not hide it
  let cur = norm(p); const rest = [];
  for (let i = 0; i < 64; i++) {
    try { return path.join(fs.realpathSync(cur), ...rest.reverse()); } catch { const up = path.dirname(cur); if (up === cur) break; rest.push(path.basename(cur)); cur = up; }
  }
  return norm(p);
};
export function jadeOwned() {
  const files = [path.join(config.STATE, 'agents-allowed.json'), path.join(config.STATE, 'agents-installed.json'), config.configFile(), provider.FILE, path.join(config.STATE, 'token')];
  const dirs = [claudehome.agentsDir(), claudehome.skillsDir(), store.dirs.agents, path.join(config.JADE_HOME, 'modules')];
  try { for (const pr of store.listProjects()) for (const f of foldersOf(pr)) for (const d of ['agents', 'skills']) dirs.push(path.join(norm(f), '.claude', d)); } catch {}
  return { files, dirs };
}
export function isJadeOwned(p) {
  if (!p) return false;
  const { files, dirs } = jadeOwned();
  const cands = [norm(p), real(p)];
  return cands.some(c => files.some(f => under(c, f) || under(c, real(f))) || dirs.some(d => under(c, d) || under(c, real(d))));
}
// A command that names any of these, or would print the environment (where a gateway or Bedrock key lives), always asks.
const NAMES_OWNED = /(^|[^\w.-])(engine\.env|agents-allowed\.json|agents-installed\.json|config\.json)\b|\.state(?![\\/]tmp\b)|\.claude[\\/](agents|skills)\b/i;
const ENV_DUMP = /\bprintenv\b|(^|[;&|(`\s])env\s*($|[;&|)>`])|\bexport\s+-p\b|\bdeclare\s+-[a-z]*x|\bcompgen\s+-e\b|\/proc\/[^\s]*environ|process\.env|os\.environ|\bENV\s*\[|\bGet-ChildItem\s+env:|\$env:|\bset\s*($|[;&|])|\$\{?(ANTHROPIC_|AWS_|CLAUDE_CODE_|JADE_)|\b(ANTHROPIC_(API_KEY|AUTH_TOKEN|CUSTOM_HEADERS)|AWS_(BEARER_TOKEN_BEDROCK|SECRET_ACCESS_KEY|SESSION_TOKEN))\b/i;
export const commandReachesOwned = (cmd, paths = []) => NAMES_OWNED.test(cmd) || ENV_DUMP.test(cmd) || paths.some(x => isJadeOwned(x.startsWith('~') ? expand(x) : path.resolve(config.JADE_HOME, x)));

// ------------------------------------------------------------------ classifying a tool call
const DESTRUCTIVE = /(^|[;&|(]\s*)(sudo\s+)?(rm|rmdir|unlink|shred|trash|trash-put|del|erase|rd|Remove-Item)\b|\bgit\s+(clean|reset\s+--hard|checkout\s+--|restore|push\s+(-f|--force)|branch\s+-D)|\bfind\b[^|]*\s-delete\b|\btruncate\b|\bmv\b[^|&;]*\s(\/tmp\/|\/dev\/null)/i;
const DANGEROUS = /\b(sudo|doas|dd|mkfs\.?|fdisk|parted|chmod\s+-R|chown\s+-R|killall|pkill|shutdown|reboot|systemctl\s+(stop|disable)|format)\b|curl[^|]*\|\s*(ba)?sh|wget[^|]*\|\s*(ba)?sh/i;
// A command that reaches Jade's own server or its secret is how a run would answer its own questions or change its own settings: it always asks (outside auto mode).
const REACHES_JADE = /\.state[\\/]token|JADE_TOKEN|x-jade\b|(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/api\b/i;
const TRUNCATE = /(^|[^>&\d])>(?!>)\s*(?!&|\/dev\/null)([^\s;&|]+)/;          // `cmd > file` empties the file
const WRITEY_MCP = /__(send|create|delete|remove|trash|untrash|update|forward|reply|share|move|copy|apply|insert|edit|mark|label|unlabel|cancel|sign_|respond|upload|rename|paper_|db_write|publish)/i;
const PATHISH = /(?:^|\s)(~\/[^\s'"]+|\/[^\s'"]+|\.\.?\/[^\s'"]+|[A-Za-z]:\\[^\s'"]+)/g;

export function classify(tool, input = {}) {
  const t = String(tool || '');
  if (['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task', 'Agent', 'Skill', 'ToolSearch'].includes(t)) return { kind: 'read', label: t };
  if (['Edit', 'Write', 'NotebookEdit'].includes(t)) {
    const p = input.file_path || input.notebook_path || '';
    const exists = p && fs.existsSync(norm(p));
    return { kind: t === 'Write' ? (exists ? 'overwrite' : 'create') : 'edit', path: p, exists, free: isFree(p), jadeOwned: isJadeOwned(p), protected: isProtected(p), editable: isEditable(p), label: `${t === 'Write' ? (exists ? 'overwrite' : 'create') : 'edit'} ${short(p)}` };
  }
  if (t === 'Bash' || t === 'PowerShell') {
    const cmd = String(input.command || '');
    const paths = [...cmd.matchAll(PATHISH)].map(m => m[1].replace(/[),;]+$/, ''));
    const allFree = paths.length > 0 && paths.every(isFree);
    // `cmd > file` is a write: a new file just happens, an existing one is backed up first (like Write), as long as
    // the target is somewhere Jade may edit.
    const red = TRUNCATE.exec(cmd)?.[2];
    const raw = red ? red.replace(/^['"]|['"]$/g, '') : '';
    const target = raw && !/[*?$`]/.test(raw) ? (raw.startsWith('~') ? expand(raw) : path.resolve(config.JADE_HOME, raw)) : null; // relative = Claude Code's cwd, the Jade folder
    const overwrites = target && fs.existsSync(target) ? target : null;
    const destructive = DESTRUCTIVE.test(cmd) || (target && !isFree(target) && !isEditable(target)), dangerous = DANGEROUS.test(cmd) || REACHES_JADE.test(cmd);
    // a command naming an agent's own folder, by full path, by redirect, or relative to the Jade folder it runs in
    const agentPath = [target, ...paths.map(p => (p.startsWith('~') ? expand(p) : path.resolve(config.JADE_HOME, p)))].find(p => p && isAgentOwned(p))
      || (/(^|[\s'"=>])(\.\/)?(\.state\/)?skeptic[\\/]/.test(cmd) ? path.join(config.JADE_HOME, 'skeptic') : null);
    const jadeOwned = commandReachesOwned(cmd, [...paths, ...(raw ? [raw.replace(/^['"]|['"]$/g, '')] : [])]);
    return { kind: dangerous ? 'dangerous' : destructive ? 'destructive' : 'command', command: cmd, paths, allFree, jadeOwned, overwrites, agentPath, label: `run ${cmd.length > 90 ? cmd.slice(0, 87) + '…' : cmd}` };
  }
  if (t.startsWith('mcp__')) {
    const server = t.split('__')[1] || '', name = t.split('__').slice(2).join('__');
    if (server === 'jade') return { kind: 'read', label: t };
    return { kind: WRITEY_MCP.test('__' + name) ? 'external' : 'read', label: `${name.replace(/_/g, ' ')} via ${server.replace(/^claude_ai_/, '').replace(/_/g, ' ')}` };
  }
  return { kind: 'other', label: t };
}
const short = p => { const h = os.homedir(); const s = String(p || ''); return s.startsWith(h) ? '~' + s.slice(h.length) : s; };

// ------------------------------------------------------------------ deciding
const pending = new Map();      // id -> { req, resolve, timer }
const remembered = new Map();   // job id -> Set of kinds the user allowed for the rest of this run
let jobLookup = () => null;     // set by jobs.js (which imports this module), so a question can name its run
export const setJobLookup = fn => { jobLookup = fn; };

/** Decide a tool call for a job. Resolves to { behavior: 'allow'|'deny', message?, updatedInput?, kind, asked }. */
export async function decide({ job, thread, tool, input = {} }) {
  const m = mode();
  const c = classify(tool, input);
  const jobId = job || thread || '';
  const allow = (note, extra) => { log({ job: jobId, tool, kind: c.kind, label: c.label, path: c.path, decision: 'allowed', note, ...extra }); return { behavior: 'allow', kind: c.kind, asked: false }; };
  const deny = message => { log({ job: jobId, tool, kind: c.kind, label: c.label, path: c.path, decision: 'denied', note: message }); return { behavior: 'deny', message, kind: c.kind, asked: false }; };
  if (c.kind === 'read') return { behavior: 'allow', kind: 'read', asked: false };
  if (m === 'read') return deny('Jade is in read-only mode (Settings → Permissions).');
  // An agent's own rules, criteria and lessons change only through its page, after the user approves; never by a chat or a run.
  const owned = [c.path, c.overwrites, c.agentPath].find(p => p && isAgentOwned(p));
  if (owned && ['edit', 'overwrite', 'create', 'command', 'destructive', 'dangerous'].includes(c.kind)) return deny(`${short(owned)} belongs to an agent's own knowledge; it changes only through that agent's page, after the user approves.`);
  // What decides what is allowed, and the key: asked about every time, in every mode but read, and never covered by "allow for this run".
  if (c.jadeOwned && ['edit', 'overwrite', 'create', 'command', 'destructive', 'dangerous'].includes(c.kind)) {
    const what = c.path ? short(c.path) : 'Jade\'s own settings, permissions or keys, or the computer\'s environment';
    return ask({ ...c, job: jobId, tool, input, question: `This touches ${what}, which decides what Jade and its agents are allowed to do or holds a key. Allow it?` }, m);
  }
  if (['edit', 'overwrite', 'create'].includes(c.kind)) {
    if (c.path && !c.free && !c.editable) return deny(`Jade only changes files under your home folder and the folders added under Settings → Permissions; not ${short(c.path)}.`);
    if (c.free) return allow('working file');
    if (m === 'ask' && !remembered.get(jobId)?.has('edit')) return ask({ ...c, job: jobId, tool, input, question: `May Jade ${c.label}?` }, m);
    const kept = c.exists ? keep(c.path, jobId, c.kind) : null;
    return allow(c.exists ? 'previous version kept' : 'new file', { touch: { path: norm(c.path), isNew: !c.exists, change: kept?.id } });
  }
  if (['command', 'destructive', 'dangerous'].includes(c.kind)) {
    if (c.kind === 'command') {
      if (m === 'ask' && !remembered.get(jobId)?.has('command')) return ask({ ...c, job: jobId, tool, input, question: 'May Jade run this command?' }, m);
      const kept = c.overwrites && !isFree(c.overwrites) ? keep(c.overwrites, jobId, 'overwrite') : null;
      return allow(c.overwrites ? 'previous version kept' : '', kept ? { touch: { path: norm(c.overwrites), isNew: false, change: kept.id } } : undefined);
    }
    if (c.kind === 'destructive' && c.allFree) return allow('only Jade\'s working files');
    if (m === 'auto') return allow('auto mode');
    if (remembered.get(jobId)?.has(c.kind)) return allow('allowed for this run');
    return ask({ ...c, job: jobId, tool, input, question: c.kind === 'dangerous' ? 'This command can affect the whole computer. Run it?' : 'This command deletes or overwrites files. Run it?' }, m);
  }
  if (c.kind === 'external') {
    if (m === 'auto') return allow('auto mode');
    if (remembered.get(jobId)?.has('external')) return allow('allowed for this run');
    return ask({ ...c, job: jobId, tool, input, question: `This goes out through a connector and cannot be taken back. Let Jade ${c.label}?` }, m);
  }
  // Anything else is one of Claude Code's own built-in tools (task lists, monitors…): harmless, asked about only in "ask" mode.
  return m === 'ask' ? ask({ ...c, job: jobId, tool, input, question: `May Jade use ${c.label}?` }, m) : allow('built-in tool');
}

const ASK_TIMEOUT = 10 * 60e3;
function ask(req, m) {
  const id = newId('p');
  const j = jobLookup(req.job);
  const entry = { id, at: new Date().toISOString(), job: req.job, jobTitle: j?.title || '', agent: j?.agentName || '', mode: m,
    tool: req.tool, kind: req.kind, label: req.label, question: req.question, path: req.path ? short(req.path) : '', command: req.command || '', input: req.input,
    // the same request in plain words: what will happen, to which files, whether it can be undone, and what No means
    plain: explain(req) };
  return new Promise(resolve => {
    const done = (behavior, message, note, extra) => {
      clearTimeout(p.timer); pending.delete(id);
      emit('permission', { ...entry, resolved: behavior });
      log({ job: req.job, tool: req.tool, kind: req.kind, label: req.label, path: req.path, decision: behavior === 'allow' ? 'allowed' : 'denied', note: note || message || 'you decided', ...extra });
      resolve({ behavior, message, kind: req.kind, asked: true });
    };
    const p = { entry, done, timer: setTimeout(() => done('deny', 'Nobody answered within 10 minutes, so this was not done. The user can run it themselves.', 'timed out'), ASK_TIMEOUT) };
    pending.set(id, p);
    emit('permission', entry);
  });
}

/** The user's answer from the UI. remember = allow the same kind for the rest of this run. */
export function answer(id, allow, remember = false) {
  const p = pending.get(id);
  if (!p) throw new Error('That request has already been answered');
  if (allow && remember) { const s = remembered.get(p.entry.job) || new Set(); s.add(p.entry.kind === 'edit' || p.entry.kind === 'overwrite' || p.entry.kind === 'create' ? 'edit' : p.entry.kind); remembered.set(p.entry.job, s); }
  let touch;
  const file = p.entry.input?.file_path;
  if (allow && ['edit', 'overwrite', 'create'].includes(p.entry.kind) && file) {
    const exists = fs.existsSync(norm(file));
    const kept = exists ? keep(file, p.entry.job, p.entry.kind) : null;
    touch = { path: norm(file), isNew: !exists, change: kept?.id };
  }
  p.done(allow ? 'allow' : 'deny', allow ? undefined : 'The user said no to this. Do not retry it; suggest it instead.', allow ? 'you allowed it' : 'you declined', touch ? { touch } : undefined);
  return { ok: true };
}
export function pendingList() { return [...pending.values()].map(p => p.entry); }
export function forgetJob(jobId) { remembered.delete(jobId); for (const [id, p] of pending) if (p.entry.job === jobId) p.done('deny', 'The run ended.', 'run ended'); }

// ------------------------------------------------------------------ backups and the change log
function readLog() { try { return JSON.parse(fs.readFileSync(CHANGES(), 'utf8')); } catch { return []; } }
function writeLog(list) { writeText(CHANGES(), JSON.stringify(list.slice(-2000))); }
function log(e) {
  const list = readLog();
  const id = newId('ch');
  list.push({ id, at: new Date().toISOString(), ...e, path: e.path ? short(e.path) : undefined });
  writeLog(list);
  emit('data', { kind: 'changes' });
  return id;
}
/** Keep the file as it is now, so an edit or overwrite can be undone. Returns { dest, id } (the copy, and its change record). */
function keep(file, jobId, kind) {
  const src = norm(file);
  let st; try { st = fs.statSync(src); } catch { return null; }
  if (!st.isFile() || st.size > 50 * 1024 * 1024) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUPS(), `${stamp}-${newId('b')}`, src.replace(/^[A-Za-z]:/, '').replace(/^[\\/]+/, ''));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  const id = log({ job: jobId, tool: kind, kind, label: `${kind} ${short(src)}`, path: src, decision: 'kept previous version', backup: dest });
  prune();
  return { dest, id };
}
/** Keep the file as it is now, so an edit or overwrite can be undone. Returns the backup path. */
export function backup(file, jobId, kind) { return keep(file, jobId, kind)?.dest ?? null; }
export function changes(limit = 60) { return readLog().slice(-limit).reverse(); }
/**
 * The files one run created or edited through Jade's permission tool, in the order they were first touched: { path, isNew, change }.
 * change is the record of the version kept from before the run's first edit of that file (what Undo puts back), if there is one.
 * A chat's engine process is kept warm and starts under the conversation's id, so its records carry the thread, not the job:
 * pass both ids, and the time the run began.
 */
export function touches(ids, since = '') {
  const want = new Set([].concat(ids).filter(Boolean));
  const out = new Map();
  for (const e of readLog()) {
    if (!e.touch || !want.has(e.job) || (since && e.at < since)) continue;
    const t = out.get(e.touch.path);
    if (!t) out.set(e.touch.path, { ...e.touch });
    else if (!t.change && e.touch.change && !t.isNew) t.change = e.touch.change;
  }
  return [...out.values()];
}
/** Put a kept version back (keeping today's version first, so a restore is itself undoable). */
export function restore(changeId) {
  const e = readLog().find(x => x.id === changeId);
  if (!e?.backup || !fs.existsSync(e.backup)) throw new Error('The kept version is gone (versions are kept for 30 days)');
  const target = norm(expand(e.path));
  if (fs.existsSync(target)) backup(target, e.job, 'restore');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(e.backup, target);
  log({ job: e.job, tool: 'restore', kind: 'restore', label: `restored ${e.path}`, path: target, decision: 'restored' });
  return { ok: true, path: e.path };
}
let lastPrune = 0;
function prune() {
  if (Date.now() - lastPrune < 3600e3) return; lastPrune = Date.now();
  try {
    const cut = Date.now() - 30 * 86400e3;
    for (const d of fs.readdirSync(BACKUPS())) { const p = path.join(BACKUPS(), d); if (fs.statSync(p).mtimeMs < cut) fs.rmSync(p, { recursive: true, force: true }); }
  } catch {}
}
