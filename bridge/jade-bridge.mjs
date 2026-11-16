#!/usr/bin/env node
// Jade bridge client: lets a Claude session read and update Jade. Zero dependencies.
//   node bridge/jade-bridge.mjs <command> [arguments]      (node bridge/jade-bridge.mjs --help lists them)
// Every call prints exactly ONE JSON object on stdout and exits 0, even when it fails ({"ok":false,"error":"..."}).
// Exit 2 only for wrong arguments (the JSON object then says what was wrong).
// Ways in, tried in this order (the result says which one answered in "source"):
//   http        http://127.0.0.1:$JADE_PORT (default 4778)
//   powershell  powershell.exe asks the same address; for a Claude session in WSL, where 127.0.0.1 does not reach Windows
//   files       read-only commands only: reads Jade's data folder ($JADE_HOME, else ~/JadeBase, else /mnt/c/Users/*/JadeBase)
// JADE_TRANSPORT=http,files (a comma list) limits the ways tried. Writes never use "files".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const MAX_TEXT = 100000;
const TRANSPORTS = ['http', 'powershell', 'files'];

// One table drives the command line, the MCP tools and the checks, so they cannot drift apart.
// kind: s string, n whole number (min..max), b yes/no switch, e one of a list.
export const COMMANDS = {
  status: { write: false, about: 'Count of open actions.', args: {} },
  actions: { write: false, about: 'List action items, optionally for one project or only the open ones.', args: { project: { kind: 's', about: 'project id' }, open: { kind: 'b', about: 'only open actions' } } },
  'action-done': { write: true, about: 'Tick an action off, with an optional note.', args: { id: { kind: 's', pos: true, required: true, about: 'action id' }, note: { kind: 's', about: 'what was done' } } },
  'note-add': { write: true, about: 'Add a note to Jade, optionally under a project.', args: { text: { kind: 's', pos: true, required: true, about: 'the note' }, project: { kind: 's', about: 'project id' } } },
  find: { write: false, about: 'Find files by name or folder words.', args: { query: { kind: 's', pos: true, required: true, about: 'words to look for' }, limit: { kind: 'n', min: 1, max: 200, about: 'most results (default 20)' } } },
  outputs: { write: false, about: 'List the newest finished deliverables (what the file ring shows).', args: { limit: { kind: 'n', min: 1, max: 200, about: 'most results (default 20)' }, project: { kind: 's', about: 'project id' } } },
  'output-override': { write: true, about: 'Say that a file is, or is not, a deliverable (or clear that choice).', args: { path: { kind: 's', pos: true, required: true, about: 'full file path' }, as: { kind: 'e', values: ['output', 'not-output', 'clear'], required: true, about: 'the choice' } } },
  routines: { write: false, about: 'List Jade routines with when each last ran.', args: {} },
  run: { write: true, about: 'Start one Jade routine; returns a job id to check with job.', args: { routine: { kind: 's', pos: true, required: true, about: 'routine id' }, project: { kind: 's', about: 'project id, for routines that work on one project' } } },
  job: { write: false, about: 'Check a job: queued, running, done or error, with its result.', args: { job: { kind: 's', pos: true, required: true, about: 'job id' } } },
  ask: { write: true, about: 'Ask Jade a question about files, projects or actions; answers read-only.', args: { text: { kind: 's', pos: true, required: true, about: 'the question' }, wait: { kind: 'n', min: 0, max: 600, about: 'seconds to wait for the answer' } } },
  handoff: { write: true, about: 'Write a brief file for a Claude session from an action, a project or text.', args: { action: { kind: 's', about: 'action id' }, project: { kind: 's', about: 'project id' }, text: { kind: 's', about: 'the task in words' } }, oneOf: ['action', 'project', 'text'] },
};

class Usage extends Error {}
const fail = (error, extra = {}) => ({ ok: false, error: String(error), ...extra });

// ---------------------------------------------------------------- arguments
/** Check an arguments object (from the command line or an MCP call) against the table. Returns the cleaned object. */
export function validate(command, input) {
  const spec = COMMANDS[command];
  if (!spec) throw new Usage(`Unknown command "${command}". Commands: ${Object.keys(COMMANDS).join(', ')}`);
  const out = {};
  const given = input && typeof input === 'object' ? input : {};
  for (const k of Object.keys(given)) if (!spec.args[k]) throw new Usage(`${command}: unknown option "${k}"`);
  for (const [k, a] of Object.entries(spec.args)) {
    const v = given[k];
    if (v === undefined || v === null || v === '') { if (a.required) throw new Usage(`${command}: ${k} is required`); continue; }
    if (a.kind === 'b') { out[k] = v === true || v === 'true' || v === 1; continue; }
    if (a.kind === 'n') {
      const n = Number(v);
      if (!Number.isInteger(n) || n < a.min || n > a.max) throw new Usage(`${command}: ${k} must be a whole number from ${a.min} to ${a.max}`);
      out[k] = n; continue;
    }
    if (typeof v !== 'string') throw new Usage(`${command}: ${k} must be text`);
    if (a.kind === 'e' && !a.values.includes(v)) throw new Usage(`${command}: ${k} must be one of ${a.values.join(', ')}`);
    if (v.length > MAX_TEXT) throw new Usage(`${command}: ${k} is too long (the limit is ${MAX_TEXT} characters)`);
    if (!v.trim()) { if (a.required) throw new Usage(`${command}: ${k} is required`); continue; }
    out[k] = v;
  }
  if (spec.oneOf && !spec.oneOf.some(k => out[k])) throw new Usage(`${command}: give one of --${spec.oneOf.join(', --')}`);
  return out;
}

/** argv after the command name -> arguments object. Positional values fill the "pos" arguments in order. */
export function parseArgv(command, argv) {
  const spec = COMMANDS[command];
  if (!spec) throw new Usage(`Unknown command "${command}". Commands: ${Object.keys(COMMANDS).join(', ')}`);
  const pos = Object.entries(spec.args).filter(([, a]) => a.pos).map(([k]) => k);
  const out = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--') { rest.push(...argv.slice(i + 1)); break; }
    const m = /^--([a-z-]+)(?:=([\s\S]*))?$/.exec(t);
    if (!m) { rest.push(t); continue; }
    const key = m[1], a = spec.args[key];
    if (!a) throw new Usage(`${command}: unknown option --${key}`);
    if (a.kind === 'b') { out[key] = m[2] === undefined ? true : m[2] !== 'false'; continue; }
    if (m[2] !== undefined) out[key] = m[2];
    else if (i + 1 < argv.length) out[key] = argv[++i];
    else throw new Usage(`${command}: --${key} needs a value`);
  }
  if (rest.length > pos.length) throw new Usage(`${command}: too many arguments (${rest.length} given, ${pos.length} expected)`);
  rest.forEach((v, i) => { out[pos[i]] = v; });
  return out;
}

export function helpText() {
  const lines = ['Jade bridge: lets a Claude session read and update Jade.', '', 'Usage: node jade-bridge.mjs <command> [arguments]', ''];
  for (const [c, s] of Object.entries(COMMANDS)) {
    const usage = Object.entries(s.args).map(([k, a]) => a.pos ? (a.required ? k.toUpperCase() : `[${k.toUpperCase()}]`)
      : (a.kind === 'b' ? `[--${k}]` : `${a.required ? '' : '['}--${k} ${a.kind === 'e' ? a.values.join('|') : k.toUpperCase()}${a.required ? '' : ']'}`)).join(' ');
    lines.push(`  ${(c + ' ' + usage).trim().padEnd(58)} ${s.about}`);
  }
  lines.push('', 'Every call prints one JSON object and exits 0, even on failure ({"ok":false,"error":"..."}). Exit 2 means wrong arguments.',
    'Environment: JADE_PORT (default 4778), JADE_HOME (for the files fallback), JADE_TRANSPORT (comma list of http,powershell,files).');
  return lines.join('\n');
}

// ---------------------------------------------------------------- transports
/** Jade's secret: JADE_TOKEN, else the owner-only file in Jade's data folder (made when Jade first starts). Every request carries it. */
export function token() {
  if (process.env.JADE_TOKEN) return process.env.JADE_TOKEN;
  const home = dataHome();
  try { return home ? fs.readFileSync(path.join(home, '.state', 'token'), 'utf8').trim() : ''; } catch { return ''; }
}
const port = () => Number(process.env.JADE_PORT) || 4778;
const base = () => `http://127.0.0.1:${port()}`;
const timeoutMs = () => Number(process.env.JADE_TIMEOUT_MS) || 15000;

/** A reply from Jade itself (even an error status) is an answer; only "could not reach it" moves on to the next way. */
class Unreachable extends Error {}
class Refused extends Error { constructor(msg, status) { super(msg); this.status = status; } }

function interpret(status, text) {
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (status >= 200 && status < 300) return data;
  throw new Refused((data && data.error) || `Jade answered ${status}`, status);
}

async function viaHttp(method, route, body) {
  let res, text;
  try {
    res = await fetch(base() + route, { method, signal: AbortSignal.timeout(timeoutMs()),
      headers: method === 'GET' ? { 'x-jade': token() } : { 'x-jade': token(), 'content-type': 'application/json' },
      body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body) });
    text = await res.text();
  } catch (e) { throw new Unreachable(e.name === 'TimeoutError' ? 'timed out' : String(e.cause?.code || e.message || e)); }
  return interpret(res.status, text);
}

// The script is fixed. Every value reaches it through environment variables (WSLENV carries them from WSL into Windows),
// the request body base64-encoded. Nothing the caller typed is ever part of a command line or of the script text.
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $method = $env:JB_METHOD
  $headers = @{}
  $headers['X-Jade'] = $env:JB_TOKEN
  $a = @{ Uri = $env:JB_URL; Method = $method; Headers = $headers; UseBasicParsing = $true; TimeoutSec = [int]$env:JB_TIMEOUT }
  if ($env:JB_BODY) { $a['Body'] = [Convert]::FromBase64String($env:JB_BODY); $a['ContentType'] = 'application/json; charset=utf-8' }
  $status = 0; $stream = $null
  try { $r = Invoke-WebRequest @a; $status = [int]$r.StatusCode; $stream = $r.RawContentStream }
  catch [System.Net.WebException] {
    if ($null -eq $_.Exception.Response) { throw }
    $status = [int]$_.Exception.Response.StatusCode; $stream = $_.Exception.Response.GetResponseStream()
  }
  $ms = New-Object System.IO.MemoryStream
  if ($stream.CanSeek) { $stream.Position = 0 }
  $stream.CopyTo($ms)
  [Console]::Out.Write((@{ status = $status; b64 = [Convert]::ToBase64String($ms.ToArray()) } | ConvertTo-Json -Compress))
} catch {
  [Console]::Out.Write((@{ status = 0; error = [string]$_.Exception.Message } | ConvertTo-Json -Compress))
}
`;
const PS_ENCODED = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');

/** powershell.exe by its full path: a bare name is searched for in the current folder first on Windows, and that is the project's folder. WSL only, or Windows itself. */
export function powershellPath() {
  const sub = ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'];
  if (process.platform === 'win32') return path.join(process.env.SystemRoot || 'C:\\Windows', ...sub);
  try { if (/microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'))) return '/mnt/c/Windows/' + sub.join('/'); } catch { /* not WSL */ }
  return '';
}

function viaPowershell(method, route, body) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, JB_URL: base() + route, JB_METHOD: method, JB_TIMEOUT: String(Math.ceil(timeoutMs() / 1000)),
      JB_TOKEN: token(), JB_BODY: body === undefined || method === 'GET' ? '' : Buffer.from(JSON.stringify(body), 'utf8').toString('base64') };
    env.WSLENV = ['JB_URL', 'JB_METHOD', 'JB_TIMEOUT', 'JB_TOKEN', 'JB_BODY', process.env.WSLENV].filter(Boolean).join(':');
    let child;
    const exe = powershellPath();
    if (!exe) return reject(new Unreachable('powershell.exe is not available'));
    try { child = spawn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', PS_ENCODED], { env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); }
    catch { return reject(new Unreachable('powershell.exe cannot be started')); }
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Unreachable('powershell timed out')); }, timeoutMs() + 15000);
    child.stdout.on('data', d => { out += d; });
    child.on('error', () => { clearTimeout(timer); reject(new Unreachable('powershell.exe is not available')); });
    child.on('close', () => {
      clearTimeout(timer);
      let r; try { r = JSON.parse(out.trim().replace(/^﻿/, '')); } catch { return reject(new Unreachable('powershell gave no usable answer')); }
      if (!r.status) return reject(new Unreachable(r.error || 'powershell could not reach Jade'));
      try { resolve(interpret(r.status, Buffer.from(r.b64 || '', 'base64').toString('utf8'))); } catch (e) { reject(e); }
    });
  });
}

// ---------------------------------------------------------------- the commands, as requests to Jade
const qs = obj => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? '?' + s : ''; };
const stem = n => String(n || '').replace(/\.[^.]+$/, '');
const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shapeAction = a => ({ id: a.id, title: a.text ?? a.title ?? '', project: a.project || '', due: a.due || '', status: a.status || 'open', waitingOn: a.waitingOn || '' });
const shapeFile = f => ({ path: f.path, name: f.name, title: stem(f.name), project: f.project || '', modified: iso(f.mtime), kind: f.kind || 'file', score: f.score ?? 0 });
const shapeJob = j => {
  const result = j.result?.reply ?? (typeof j.result === 'string' ? j.result : j.result?.summary) ?? '';
  return { status: j.status === 'cancelled' ? 'error' : j.status, title: j.title || '', finishedAt: j.endedAt || null,
    result: result || j.error || (j.status === 'done' ? String(j.output || '').slice(-4000) : '') };
};

const viaJade = {
  async status(call) {
    const s = await call('GET', '/api/bridge/status');
    return { jade: { reachable: true }, counts: s.counts };
  },
  async actions(call, a) {
    const list = await call('GET', '/api/actions');
    return { actions: list.filter(x => (!a.project || x.project === a.project) && (!a.open || x.status !== 'done')).slice(0, 200).map(shapeAction) };
  },
  async 'action-done'(call, a) {
    const r = await call('PATCH', '/api/actions/' + encodeURIComponent(a.id), { status: 'done', ...(a.note ? { doneNote: a.note } : {}) });
    return { id: r.id, status: r.status };
  },
  async 'note-add'(call, a) { const r = await call('POST', '/api/bridge/note', { text: a.text, ...(a.project ? { project: a.project } : {}) }); return { id: r.id }; },
  async find(call, a) { const r = await call('GET', '/api/files' + qs({ q: a.query, limit: a.limit || 20 })); return { files: r.map(shapeFile) }; },
  async outputs(call, a) { const r = await call('GET', '/api/outputs' + qs({ limit: a.limit || 20, project: a.project })); return { outputs: r.outputs || [] }; },
  async 'output-override'(call, a) { const r = await call('POST', '/api/outputs/override', { path: a.path, as: a.as }); return { path: r.path ?? a.path, as: r.as ?? a.as }; },
  async routines(call) {
    const r = await call('GET', '/api/routines');
    return { routines: (r.routines || []).map(x => ({ id: x.id, name: x.name, schedule: x.schedule, lastRun: x.last ? { at: x.last.at, status: x.last.status } : null })) };
  },
  async run(call, a) { const r = await call('POST', '/api/bridge/run', { id: a.routine, ...(a.project ? { project: a.project } : {}) }); return { jobId: r.jobId }; },
  async job(call, a) {
    const j = await call('GET', '/api/jobs/' + encodeURIComponent(a.job));
    if (!j) throw new Refused('No job ' + a.job, 404);
    return shapeJob(j);
  },
  async ask(call, a) {
    const r = await call('POST', '/api/bridge/ask', { text: a.text });
    const out = { jobId: r.jobId };
    const until = Date.now() + (a.wait || 0) * 1000;
    while (a.wait && Date.now() < until) {
      await sleep(1000);
      const j = await call('GET', '/api/jobs/' + encodeURIComponent(r.jobId));
      if (j && ['done', 'error', 'cancelled'].includes(j.status)) {
        const s = shapeJob(j);
        if (s.status === 'done') out.answer = s.result; else out.error = s.result || 'Jade could not answer';
        break;
      }
    }
    return out;
  },
  async handoff(call, a) {
    const r = await call('POST', '/api/bridge/handoff', { ...(a.action ? { action: a.action } : {}), ...(a.project ? { project: a.project } : {}), ...(a.text ? { text: a.text } : {}) });
    return { path: r.path, prompt: r.prompt };
  },
};

// ---------------------------------------------------------------- the files fallback (read-only commands)
export function dataHome() {
  // A JADE_HOME that is set is the only place looked at: a wrong path must not quietly read some other Jade's data.
  if (process.env.JADE_HOME) { try { return fs.statSync(process.env.JADE_HOME).isDirectory() ? process.env.JADE_HOME : null; } catch { return null; } }
  const cands = [path.join(os.homedir(), 'JadeBase')];
  try { for (const u of fs.readdirSync('/mnt/c/Users')) cands.push(path.join('/mnt/c/Users', u, 'JadeBase')); } catch { /* not WSL */ }
  // only a folder this user owns: another person's data folder on a shared computer is never read
  const mine = d => { try { const st = fs.statSync(d); return st.isDirectory() && (typeof process.getuid !== 'function' || st.uid === process.getuid()); } catch { return false; } };
  return cands.filter(Boolean).find(mine) || null;
}
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };

function walkNames(roots, cap = 20000) {
  const out = [];
  const seen = new Set();
  const go = (dir, root, depth) => {
    if (out.length >= cap || depth > 8) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= cap) return;
      if (e.name.startsWith('.') || e.name.startsWith('~$') || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { go(p, root, depth + 1); continue; }
      if (!e.isFile() || seen.has(p)) continue;
      seen.add(p);
      let st; try { st = fs.statSync(p); } catch { continue; }
      out.push({ path: p, name: e.name, rel: path.relative(root.dir, p), mtime: st.mtimeMs, project: root.project, kind: path.extname(e.name).slice(1).toLowerCase() || 'file' });
    }
  };
  for (const r of roots) go(r.dir, r, 0);
  return out;
}

// Actions live in the data folder and, for a project with a folder, in <first folder>/<storage.folderName>/actions.json (first id wins, data folder first).
function allActions(home) {
  const seen = new Set(), out = [];
  const add = list => { for (const a of Array.isArray(list) ? list : []) if (a && !seen.has(a.id)) { seen.add(a.id); out.push(a); } };
  add(readJson(path.join(home, 'actions.json'), []));
  const name = readJson(path.join(home, 'config.json'), {}).storage?.folderName || 'Jade';
  try {
    for (const f of fs.readdirSync(path.join(home, 'projects')).filter(n => n.endsWith('.json'))) {
      const first = (readJson(path.join(home, 'projects', f), {}).folders || [])[0];
      if (first) add(readJson(path.join(path.resolve(String(first).replace(/^~(?=$|[\\/])/, os.homedir())), name, 'actions.json'), []));
    }
  } catch { /* no projects folder */ }
  return out;
}

const fromFiles = {
  status(home) {
    const actions = allActions(home);
    return { jade: { reachable: false },
      counts: { actionsOpen: actions.filter(a => a.status !== 'done').length } };
  },
  actions(home, a) {
    const list = allActions(home);
    return { actions: list.filter(x => (!a.project || x.project === a.project) && (!a.open || x.status !== 'done')).slice(0, 200).map(shapeAction) };
  },
  find(home, a) {
    const roots = [{ dir: home, project: '' }];
    try {
      for (const f of fs.readdirSync(path.join(home, 'projects')).filter(n => n.endsWith('.json'))) {
        const p = readJson(path.join(home, 'projects', f), {});
        for (const d of p.folders || []) {
          const dir = path.resolve(String(d).replace(/^~(?=$|[\\/])/, os.homedir()));
          if (fs.existsSync(dir)) roots.unshift({ dir, project: p.id || '' });
        }
      }
    } catch { /* no projects folder */ }
    const words = a.query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = [];
    for (const f of walkNames(roots)) {
      const name = f.name.toLowerCase(), rel = f.rel.toLowerCase().replace(/[\\/_-]+/g, ' ');
      let score = 0, ok = true;
      for (const w of words) { if (name.includes(w)) score += name.startsWith(w) ? 3 : 2; else if (rel.includes(w)) score += 1; else { ok = false; break; } }
      if (ok) hits.push({ ...f, score });
    }
    hits.sort((x, y) => y.score - x.score || y.mtime - x.mtime);
    return { files: hits.slice(0, a.limit || 20).map(shapeFile) };
  },
  routines() { throw new Refused('routines needs Jade running', 503); },
  job(home, a) {
    const j = (readJson(path.join(home, '.state', 'jobs.json'), []) || []).find(x => x.id === a.job);
    if (!j) throw new Refused('No job ' + a.job, 404);
    return shapeJob(j);
  },
};

// ---------------------------------------------------------------- running a command
/** Run one command and return its result object. Never throws. */
export async function execute(command, input) {
  let args;
  try { args = validate(command, input); } catch (e) { return fail(e.message, { usage: true }); }
  const spec = COMMANDS[command];
  const wanted = (process.env.JADE_TRANSPORT || TRANSPORTS.join(',')).split(',').map(s => s.trim());
  const tried = [];
  for (const t of TRANSPORTS.filter(x => wanted.includes(x))) {
    if (t === 'files') {
      if (spec.write) { tried.push({ via: t, error: 'writing needs Jade running; the files way is read-only' }); continue; }
      if (!fromFiles[command] || command === 'routines') { tried.push({ via: t, error: `${command} needs Jade running` }); continue; }
      const home = dataHome();
      if (!home) { tried.push({ via: t, error: 'no Jade data folder found' }); continue; }
      // the switch in Jade's Settings governs this way in as well: left off, nothing is read, running or not
      if (readJson(path.join(home, 'config.json'), {})?.bridge?.enabled !== true) { tried.push({ via: t, error: 'The Claude bridge is switched off in Jade. Turn it on in Settings first.' }); continue; }
      try { return { ok: true, source: 'files', ...fromFiles[command](home, args) }; } catch (e) { return fail(e.message, { source: 'files' }); }
    }
    const call = t === 'http' ? viaHttp : viaPowershell;
    try { return { ok: true, source: t, ...(await viaJade[command](call, args)) }; }
    catch (e) {
      if (e instanceof Unreachable) { tried.push({ via: t, error: e.message }); continue; }
      return fail(e.message, { source: t, ...(e.status ? { status: e.status } : {}) });
    }
  }
  return fail(spec.write ? `Jade is not running (or cannot be reached), and ${command} changes things, so it cannot be done without it` : 'Jade could not be reached',
    { source: null, jade: { reachable: false }, tried });
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(helpText() + '\n');
    return 0;
  }
  let args;
  try { args = parseArgv(command, rest); validate(command, args); }
  catch (e) { process.stdout.write(JSON.stringify(fail(e.message, { usage: true })) + '\n'); return 2; }
  process.stdout.write(JSON.stringify(await execute(command, args)) + '\n');
  return 0;
}

const isMain = (() => { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const guard = e => { process.stdout.write(JSON.stringify(fail(e?.message || e)) + '\n'); process.exit(0); };
  process.on('uncaughtException', guard);
  process.on('unhandledRejection', guard);
  main(process.argv.slice(2)).then(c => { process.exitCode = c; }, guard);
}
