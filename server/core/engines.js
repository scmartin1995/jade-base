// The "brain": Claude Code, driven headless through its own CLI so it runs on the user's existing subscription
// (no API keys, no extra cost). Tool access is read-only unless a run is allowed to edit.
// Claude Code can also reach Claude through Amazon Bedrock or a company gateway: see provider.js.
//
// Detection (is it installed, signed in, which connectors) runs in the background: nothing here ever blocks the server.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { which, isWin, id } from './util.js';
import * as config from './config.js';
import * as auth from './auth.js';
import * as provider from './provider.js';
import { emit } from './bus.js';
import * as models from './models.js';
import { isAgentTool, resultText } from './subagents.js';
import { redact } from './redact.js';

// Connectors Jade knows well: only their read-only tools are allowed. Any other MCP server Claude Code has (another
// claude.ai connector, or one added with `claude mcp add`) is offered whole, and only when the user switches it on.
export const CONNECTOR_TOOLS = {
  gmail: ['mcp__claude_ai_Gmail__search_threads', 'mcp__claude_ai_Gmail__get_thread', 'mcp__claude_ai_Gmail__get_message', 'mcp__claude_ai_Gmail__list_labels'],
  calendar: ['mcp__claude_ai_Google_Calendar__list_events', 'mcp__claude_ai_Google_Calendar__search_events', 'mcp__claude_ai_Google_Calendar__get_event', 'mcp__claude_ai_Google_Calendar__list_calendars'],
  drive: ['mcp__claude_ai_Google_Drive__search_files', 'mcp__claude_ai_Google_Drive__read_file_content', 'mcp__claude_ai_Google_Drive__list_recent_files'],
  web: ['WebSearch', 'WebFetch'],
};
const KNOWN_IDS = { Gmail: 'gmail', 'Google Calendar': 'calendar', 'Google Drive': 'drive' };
export const BASE_TOOLS = ['Read', 'Glob', 'Grep'];

// ------------------------------------------------------------------ detection
let cache = null, refreshing = null;

function baseline() {
  const cb = which('claude');
  return {
    claude: { installed: !!cb, bin: cb, loggedIn: cache?.claude?.loggedIn ?? null, login: 'claude auth login', provider: provider.describe() },
    connectors: cache?.connectors || [], checking: true, checkedAt: cache?.checkedAt || null,
  };
}

function runCmd(bin, args, timeout) {
  return new Promise(resolve => {
    let out = '';
    const p = spawnCli(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('error', () => { clearTimeout(t); resolve(out); });
    p.on('close', () => { clearTimeout(t); resolve(out); });
  });
}

/** Every MCP server Claude Code lists, as a connector. Lines look like `claude.ai Gmail: https://… - ✔ Connected`. */
export function parseMcpList(out) {
  const list = [];
  for (const raw of String(out).split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
    const m = /^(.+?):\s+(\S.*?)\s+-\s+(.+)$/.exec(line);
    if (!m) continue;
    const full = m[1].trim(), status = m[3].trim();
    const official = /^claude\.ai\s/.test(full);
    const name = official ? full.replace(/^claude\.ai\s+/, '') : full;
    const cid = KNOWN_IDS[name] || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const key = full.replace(/[^A-Za-z0-9]/g, '_'); // Claude Code's tool prefix: mcp__<key>__<tool>
    list.push({ id: cid, name, full, key, url: m[2].trim(), official, curated: !!CONNECTOR_TOOLS[cid],
      connected: /✔|✓|Connected/.test(status) && !/Failed|Needs auth|Disabled/i.test(status), status: status.replace(/^[✔✓✗✘]\s*/, ''),
      tools: CONNECTOR_TOOLS[cid] || [`mcp__${key}`] });
  }
  return list;
}

/** What we know right now. The first call answers at once from a quick PATH check and starts the full check. */
export function detect(force = false) {
  if (!cache) { cache = baseline(); refresh(); } else if (force) refresh();
  return cache;
}

/** The full check (sign-in status, connectors) in the background. Resolves to the fresh state. */
export function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const base = baseline();
    const [auth, mcp] = await Promise.all([
      base.claude.bin ? runCmd(base.claude.bin, ['auth', 'status'], 15000) : '',
      base.claude.bin ? runCmd(base.claude.bin, ['mcp', 'list'], 45000) : '',
    ]);
    let claudeLogged = false;
    try { claudeLogged = !!JSON.parse(auth || '{}').loggedIn; } catch { claudeLogged = /loggedIn"?:\s*true/.test(auth); }
    // On Bedrock or a gateway there is no claude.ai sign-in to check; the Test button in Settings is the real check.
    const sub = base.claude.provider.mode === 'subscription';
    cache = { ...base, claude: { ...base.claude, loggedIn: sub ? claudeLogged : null },
      connectors: parseMcpList(mcp), checking: false, checkedAt: new Date().toISOString() };
    emit('engines', cache);
    return cache;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export function connector(cid) { return (detect().connectors || []).find(c => c.id === cid); }
export function hasConnector(cid) { return !!connector(cid)?.connected; }

/** May Jade attach this connector? Known read-only ones default to on, anything else must be switched on. */
export function allowed(cid) {
  const on = config.get().connectors?.enabled || {};
  if (cid === 'web' || CONNECTOR_TOOLS[cid]) return on[cid] !== false;
  return on[cid] === true;
}
export function connectorTools(cid) { return CONNECTOR_TOOLS[cid] || connector(cid)?.tools || []; }

/** The connector list for Settings: everything Claude Code has, plus web search, each with its switch. */
export function connectors() {
  const list = (detect().connectors || []).map(c => ({ ...c, enabled: allowed(c.id) }));
  list.push({ id: 'web', name: 'Web search', full: 'web', official: true, curated: true, connected: true, status: 'built into Claude Code',
    tools: CONNECTOR_TOOLS.web, enabled: allowed('web'), bedrock: provider.mode() !== 'subscription' && provider.mode() !== 'gateway' });
  return list;
}

/** Register an MCP server with Claude Code for this user, so it shows up in `claude` as well as in Jade. */
export async function addMcp(name, url) {
  const d = detect();
  if (!d.claude.bin) throw new Error('Claude Code is not installed');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(String(name || ''))) throw new Error('Name: letters, digits, - and _ only');
  if (!/^https:\/\/\S+$/.test(String(url || ''))) throw new Error('The server URL must start with https://');
  const out = await runCmd(d.claude.bin, ['mcp', 'add', '--transport', 'http', '--scope', 'user', name, url], 30000);
  if (/error|failed|already exists/i.test(out)) throw new Error(cleanErr(out) || 'claude mcp add failed');
  await refresh();
  return { ok: true, output: out.trim() };
}
export async function removeMcp(name) {
  const d = detect();
  const c = (d.connectors || []).find(x => x.full === name && !x.official);
  if (!c) throw new Error('Only servers added with "Add connector" can be removed here; claude.ai connectors are managed on claude.ai');
  const out = await runCmd(d.claude.bin, ['mcp', 'remove', '--scope', 'user', name], 30000);
  await refresh();
  return { ok: true, output: out.trim() };
}

export function pick() {
  return detect().claude.installed ? 'claude' : null;
}

// ------------------------------------------------------------------ running
/**
 * One argument for a Windows .cmd or .bat launched through cmd.exe: quoted when it holds a space, a quote, a bracket or a cmd operator.
 * A `%` cannot be escaped inside quotes, so the quote is closed around it and it is written as `%^` (cmd then finds no variable of that
 * name and drops the `^`): "a%b" becomes "a"%^"b", which the program receives as a%b.
 */
export function quoteCmdArg(a) {
  a = String(a);
  if (!a || /[\s"&|<>^%()!,;=]/.test(a)) return '"' + a.replace(/"/g, '""').replace(/%/g, '"%^"') + '"';
  return a;
}
export function spawnCli(bin, args, opts) {
  const shell = isWin && /\.(cmd|bat)$/i.test(bin);
  const q = a => (shell ? quoteCmdArg(a) : a);
  // Only Jade's own routing applies: a stray ANTHROPIC_* or AWS_* variable on this machine never redirects a request.
  const env = { ...provider.scrub({ ...process.env }), ...provider.env(), MCP_TOOL_TIMEOUT: String(11 * 60e3), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', ...(opts.env || {}) }; // a permission question may wait on the user
  delete env.JADE_TOKEN; // the server's secret never reaches a Claude process (or the commands it runs); only the permission tool is given it, in its own MCP env
  delete env.CLAUDECODE; // allow running even when Jade itself was started from inside Claude Code
  const child = spawn(bin, shell ? args.map(q) : args, { ...opts, shell, env, windowsHide: true });
  if (shell) {
    // A .cmd shim is run through cmd.exe, and stopping that alone leaves the program it started (and its pipes) running: stop the whole tree
    const stop = child.kill.bind(child);
    child.kill = (signal) => {
      try { if (child.exitCode === null && child.pid && spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }).status === 0) return true; } catch { /* fall back */ }
      return stop(signal);
    };
  }
  return child;
}

let swept = false;
const tmpDir = () => {
  const d = auth.privateDir(path.join(config.STATE, 'tmp'));
  if (!swept) { // older versions left the key in files named mcp-jade-*.json here
    swept = true;
    try { for (const f of fs.readdirSync(d)) if (/^mcp-jade-/.test(f)) fs.rmSync(path.join(d, f), { force: true }); } catch { /* nothing to clean */ }
  }
  return d;
};
// The per-run tool settings live here, not in the free-for-runs tmp folder; each is removed when its run ends and any left by a crash are removed at start.
let runSwept = false;
const runDir = () => {
  const d = auth.privateDir(path.join(config.STATE, 'run'));
  if (!runSwept) { runSwept = true; try { for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { force: true }); } catch { /* nothing to clean */ } }
  return d;
};
/**
 * Which model name the engine is asked for. On a gateway the pinned names only apply to the plain aliases haiku, sonnet and
 * opus (Claude Code maps them through ANTHROPIC_DEFAULT_*_MODEL), so a tier with no pin falls back to sonnet rather than
 * asking for a model the account may not have; any exact name the gateway lists goes through as typed.
 */
export function engineModel(model) {
  const m = String(model || '').trim();
  if (provider.style() !== 'gateway') return m || models.everyday(); // none chosen: the everyday model discovery found
  const p = provider.pins();
  const listed = cachedModels(); // what the endpoint itself listed (inference profiles or /v1/models), if anything
  const newest = re => listed.filter(id => re.test(id)).sort((a, b) => ver(b) - ver(a))[0] || '';
  const tier = m.replace(/\[1m\]$/, '').toLowerCase();
  // the everyday model: the pin, else the newest Sonnet the endpoint lists, else the alias (the engine resolves it)
  const everyday = p.standard ? 'sonnet' : newest(/sonnet/i) || 'sonnet';
  if (!m || tier === 'sonnet' || tier === 'default') return everyday;
  if (tier === 'haiku') return p.light ? 'haiku' : newest(/haiku/i) || everyday;
  if (['opus', 'fable', 'best', 'opusplan'].includes(tier)) return p.strong ? 'opus' : newest(/opus/i) || everyday;
  return m; // an exact name, as the gateway lists it
}
const ver = id => { const x = /(\d+)[-.](\d+)/.exec(String(id).replace(/^.*claude-/, '')); return x ? Number(x[1]) * 100 + Number(x[2]) : 0; };
let modelsCache = { at: 0, list: [] };
function cachedModels() {
  const f = path.join(config.STATE, 'models.json');
  try { const st = fs.statSync(f); if (st.mtimeMs !== modelsCache.at) modelsCache = { at: st.mtimeMs, list: JSON.parse(fs.readFileSync(f, 'utf8')).models || [] }; } catch { modelsCache = { at: 0, list: [] }; }
  return modelsCache.list;
}

/**
 * Everything the engine itself can tell us about the connection, with secrets masked, for pasting into a chat when a
 * gateway does not work: version, the variables set (names only), the gateway's own answer to one request, and a full
 * round trip's result or error.
 */
export async function diagnose() {
  const d = detect();
  const lines = [`Jade diagnose · ${new Date().toISOString()} · ${process.platform} ${process.arch} · node ${process.version}`];
  lines.push(`claude: ${d.claude.bin || 'NOT FOUND on PATH'}`);
  if (d.claude.bin) lines.push(`claude --version: ${(await new Promise(r => { let o = ''; const p = spawnCli(d.claude.bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] }); p.stdout.on('data', c => { o += c; }); p.stderr.on('data', c => { o += c; }); p.on('close', () => r(o)); p.on('error', e => r(e.message)); })).trim()}`);
  const pd = provider.describe();
  lines.push(`provider: ${pd.label} (style ${pd.style}, mode ${pd.mode}, format ${pd.format})`, `address: ${pd.baseUrl || '(none)'} · key: ${pd.hasKey ? 'set ' + pd.keyHint + ' as ' + pd.keyKind : 'none'} · region: ${pd.region || '(none)'}`,
    `pins: quick=${pd.models.light || '-'} everyday=${pd.models.standard || '-'} strong=${pd.models.strong || '-'} · endpoint listed ${cachedModels().length} model(s) · sonnet resolves to: ${engineModel('sonnet') || '(engine default)'}`);
  const env = { ...provider.scrub({ ...process.env }), ...provider.env() };
  const names = Object.keys(env).filter(k => /^(ANTHROPIC_|AWS_|CLAUDE_|DISABLE_|NODE_EXTRA|HTTPS?_PROXY|NO_PROXY)/i.test(k)).sort();
  lines.push(`engine env (names only): ${names.join(' ')}`, `engine config dir: ${env.CLAUDE_CONFIG_DIR || '(the normal one, with your Claude login)'}`);
  const t = await test();
  lines.push(`check: ${t.ok ? 'OK' : 'FAILED'}${t.ms ? ' in ' + t.ms + ' ms' : ''}${t.model ? ' · model ' + t.model : ''}${t.error ? ' · ' + t.error : ''}`);
  if (!t.ok && d.claude.bin) {
    // one more round trip, keeping the engine's own words
    const out = await new Promise(resolve => {
      let o = '';
      const p = spawnCli(d.claude.bin, ['-p', 'Reply with OK.', '--output-format', 'json', '--allowedTools', '', '--strict-mcp-config', '--mcp-config', emptyMcpFile(), '--settings', settingsFile(), ...(engineModel(config.get().models?.claude) ? ['--model', engineModel(config.get().models?.claude)] : [])], { cwd: config.JADE_HOME, stdio: ['pipe', 'pipe', 'pipe'] });
      const tm = setTimeout(() => p.kill(), 60000);
      p.stdout.on('data', c => { o += c; }); p.stderr.on('data', c => { o += '\n[stderr] ' + c; });
      p.on('error', e => { clearTimeout(tm); resolve(o + e.message); }); p.on('close', code => { clearTimeout(tm); resolve(o + `\n[exit ${code}]`); });
      p.stdin.end('');
    });
    lines.push('engine output (last 1200 chars, masked):', redact(out.trim()).slice(-1200));
  }
  return { report: redact(lines.join('\n')) };
}

// The engine's --settings file and the MCP config files are written once (per job for the permission server) so no JSON
// has to survive a Windows command line.
let settingsLast = '';
function settingsFile() {
  const f = path.join(tmpDir(), 'engine-settings.json');
  const want = JSON.stringify(provider.engineSettings());
  if (settingsLast !== want || !fs.existsSync(f)) { fs.writeFileSync(f, want); settingsLast = want; }
  return f;
}
// The permission tool is given where the state folder is, not the key: it reads the key file itself (see auth.js).
// Every start has a file of its own (the end of the name is chosen fresh): a worker that is restarted for the same chat must not
// have its file removed by the clean-up of the one it replaces.
function permissionMcpFile(job, thread) {
  auth.share();
  const f = path.join(runDir(), `mcp-jade-${(job || thread || 'x').replace(/[^\w-]/g, '')}-s${crypto.randomBytes(4).toString('hex')}.json`);
  fs.writeFileSync(f, JSON.stringify({ mcpServers: { jade: { command: process.execPath, args: [path.join(config.APP_ROOT, 'server', 'mcp', 'approve.mjs')],
    env: { JADE_PORT: String(config.port()), JADE_JOB: job || '', JADE_THREAD: thread || '', JADE_STATE: config.STATE } } } }), { mode: 0o600 });
  return f;
}
let emptyMcp = null;
export function emptyMcpFile() {
  if (!emptyMcp) { emptyMcp = path.join(tmpDir(), 'no-connectors.json'); fs.writeFileSync(emptyMcp, '{"mcpServers":{}}'); }
  return emptyMcp;
}

/**
 * The claude command line for a run. Connectors cost 1-4 s and ~5k tokens per process to attach, so they are only
 * attached when the run asks for one; otherwise Claude starts with none. A stable system prompt goes in a file.
 */
/** The levels Claude Code's --effort takes. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** The flag for a level, or nothing: '' and anything unknown send none; Haiku 4.x has no effort setting. */
export const effortArgs = (effort, m) => (EFFORT_LEVELS.includes(effort) && !/haiku/i.test(m || '') ? ['--effort', effort] : []);

/**
 * Claude Code's deny rules for its own file-reading tools on the two places a key lives: the engine file and the whole .state folder
 * (the Jade key, the allowance records). "//path" is Claude Code's rule syntax for an absolute path from the filesystem root; on Windows
 * `C:\\Users\\me` is written `//c/Users/me`. A link to either is covered too (the rule is checked against the real location).
 */
export function secretReadDenies() {
  const rule = p => { const q = String(p).replace(/\\/g, '/'); const m = /^([A-Za-z]):(\/.*)?$/.exec(q); return `Read(${m ? `//${m[1].toLowerCase()}${m[2] || ''}` : '/' + q})`; };
  return [rule(provider.FILE), rule(path.join(config.STATE, '**'))];
}

export function claudeArgs({ noRead = false, denyWeb = false, connectors = [], dirs = [], model, system, stream = false, effort, edits = false, job = '', thread = '', subagents = '' }) {
  const tools = noRead ? [] : [...BASE_TOOLS];
  for (const c of connectors) tools.push(...connectorTools(c));
  const bedrock = provider.mode().startsWith('bedrock');
  const allow = bedrock ? tools.filter(t => t !== 'WebSearch') : tools; // Claude Code has no WebSearch on Bedrock
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--allowedTools', allow.join(',')];
  if (stream) args.push('--input-format', 'stream-json');
  if (edits) {
    // Edit, Write and Bash are on; anything not pre-approved goes to Jade's permission tool (server/mcp/approve.mjs),
    // which decides by the user's permission mode and asks them only when the policy says so.
    const mcpFile = permissionMcpFile(job, thread);
    args.push('--permission-prompt-tool', 'mcp__jade__approve', '--mcp-config', mcpFile);
    args.cleanup = () => fs.rm(mcpFile, { force: true }, () => {});
    // Without this the engine's own default applies, and on current versions that is its built-in auto-approver: it decided
    // every edit itself, so Jade's tool was never called and no previous version or change record was ever made.
    args.push('--permission-mode', 'manual');
    args.push('--disallowedTools', 'AskUserQuestion', ...secretReadDenies()); // Jade asks the user itself, through the permission tool; the key files cannot be read
    if (!connectors.some(c => c !== 'web')) args.push('--strict-mcp-config');
    // the builders (the Worker) this run may hand build tasks to, as Claude Code sub-agents: a file of their definitions
    if (subagents) args.push('--agents', subagents);
  } else {
    // a run that is told it has no file reading, or whose web setting is off, has those tools named as refused (a setting of the person's own could otherwise allow them)
    args.push('--disallowedTools', ['Bash,Edit,Write,NotebookEdit', ...(noRead ? ['Read,Glob,Grep'] : []), ...(denyWeb ? ['WebSearch,WebFetch'] : [])].join(','), ...secretReadDenies());
    if (!connectors.some(c => c !== 'web')) args.push('--strict-mcp-config', '--mcp-config', emptyMcpFile());
  }
  const m = engineModel(model || config.get().models?.claude);
  if (m) args.push('--model', m);
  // How hard the model thinks, as Claude Code's --effort. With none given the model's own default applies (medium on the 5.5 models). Haiku 4.x has no effort setting.
  args.push(...effortArgs(effort, m));
  // Settings handed to the engine itself: a web fetch must not first ask Anthropic whether the site is allowed (a work
  // network may block that, and nothing goes to Anthropic that the user did not choose).
  args.push('--settings', settingsFile());
  if (system) {
    const f = path.join(tmpDir(), `system-${id()}.md`);
    fs.writeFileSync(f, system);
    args.push('--append-system-prompt-file', f);
    const prev = args.cleanup;
    args.cleanup = () => { prev?.(); fs.rm(f, { force: true }, () => {}); };
  }
  for (const dir of dirs) if (fs.existsSync(dir)) args.push('--add-dir', dir);
  return args;
}

/**
 * Check the configured provider. First a direct one-token request to the base URL (the check Claude Code's docs
 * recommend: a wrong URL or key fails in seconds, where Claude Code itself would retry for minutes), then a one-word
 * round trip through `claude -p`. Returns { ok, model, ms, error, provider }.
 */
export async function test() {
  const d = detect();
  const label = provider.describe().label;
  if (!d.claude.bin) return { ok: false, error: 'Claude Code is not installed', provider: label };
  const t0 = Date.now();
  const e = provider.read();
  const mode = provider.mode(e);
  if (mode !== 'subscription') {
    const base = (mode === 'gateway' ? e.ANTHROPIC_BASE_URL : e.ANTHROPIC_BEDROCK_BASE_URL || `https://bedrock-runtime.${e.AWS_REGION || 'us-east-1'}.amazonaws.com`).replace(/\/+$/, '');
    const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (e.ANTHROPIC_AUTH_TOKEN) headers.authorization = `Bearer ${e.ANTHROPIC_AUTH_TOKEN}`;
    if (e.AWS_BEARER_TOKEN_BEDROCK) headers.authorization = `Bearer ${e.AWS_BEARER_TOKEN_BEDROCK}`;
    if (e.ANTHROPIC_API_KEY) headers['x-api-key'] = e.ANTHROPIC_API_KEY;
    const resolved = engineModel('sonnet');
    const pinned = e.ANTHROPIC_DEFAULT_SONNET_MODEL || e.ANTHROPIC_MODEL || (resolved !== 'sonnet' ? resolved : '');
    const url = mode === 'gateway' ? `${base}/v1/messages` : `${base}/model/${encodeURIComponent(pinned || 'us.anthropic.claude-sonnet-4-6')}/invoke`;
    try {
      const r = await fetch(url, { method: 'POST', headers, signal: AbortSignal.timeout(12000),
        body: JSON.stringify(mode === 'gateway' ? { model: pinned || 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: '.' }] }
          : { anthropic_version: 'bedrock-2023-05-31', max_tokens: 1, messages: [{ role: 'user', content: '.' }] }) });
      if (r.status === 401 || r.status === 403) return { ok: false, ms: Date.now() - t0, provider: label, error: `${r.status} from ${base}: the key or token was rejected${mode === 'gateway' ? ' (try the other key header)' : ''}` };
      if (r.status >= 500) return { ok: false, ms: Date.now() - t0, provider: label, error: `${r.status} from ${base}` };
      // 200, or a 400 naming the model, both prove the URL and credential work
    } catch (err) {
      return { ok: false, ms: Date.now() - t0, provider: label, error: redact(`Could not reach ${base}: ${err.cause?.code || err.name === 'TimeoutError' ? 'timed out' : err.message}`).slice(0, 300) };
    }
  }
  const args = ['-p', '--output-format', 'json', '--allowedTools', '', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,Read,Glob,Grep',
    '--strict-mcp-config', '--mcp-config', emptyMcpFile()];
  // On a gateway or Bedrock the check asks for the saved name as it is (the alias 'sonnet' when none is saved), as it always did;
  // only on the plan does "none chosen" resolve to the everyday model discovery found.
  const saved = config.get().models?.claude;
  const m = provider.style() === 'gateway' ? saved || 'sonnet' : engineModel(saved);
  if (m) args.push('--model', m);
  const out = await new Promise(resolve => {
    let o = '';
    const p = spawnCli(d.claude.bin, args, { cwd: config.JADE_HOME, stdio: ['pipe', 'pipe', 'pipe'] });
    const t = setTimeout(() => p.kill(), 60000);
    p.stdout.on('data', c => { o += c; }); p.stderr.on('data', c => { o += c; });
    p.on('error', err => { clearTimeout(t); resolve(o + err.message); });
    p.on('close', () => { clearTimeout(t); resolve(o); });
    p.stdin.end('Reply with the single word OK.');
  });
  const ms = Date.now() - t0;
  const line = out.split('\n').find(l => l.startsWith('{'));
  let ev = null; try { ev = line ? JSON.parse(line) : null; } catch {}
  if (ev && !ev.is_error) return { ok: true, ms, model: Object.keys(ev.modelUsage || {})[0] || '', reply: String(ev.result || '').slice(0, 80), provider: label };
  const telling = out.split('\n').filter(l => /error|fail|refused|ENOTFOUND|ECONN|401|403|404|invalid|not found/i.test(l) && !/^\s+at /.test(l));
  return { ok: false, ms, error: redact(telling.length ? telling.slice(-3).join(' · ') : cleanErr(ev?.result || out) || (ms >= 60000 ? 'no answer within 60 s' : 'no reply')).slice(0, 600), provider: label };
}

/** Feed one line of Claude's stream-json output to the handlers. Returns the result event when the turn is over. */
export function parseClaudeLine(line, st, { onText, onTool, onAgent = () => {} }) {
  if (!line.startsWith('{')) return null;
  let ev; try { ev = JSON.parse(line); } catch { return null; }
  if (ev.type === 'stream_event') {
    const e = ev.event;
    if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') { st.streamed = true; st.text += e.delta.text; onText(e.delta.text); }
    if (e?.type === 'message_start' && st.text && !st.text.endsWith('\n')) { st.text += '\n\n'; onText('\n\n'); }
  } else if (ev.type === 'system' && ev.subtype === 'init' && ev.model) {
    st.model = ev.model;
  } else if (ev.type === 'assistant') {
    for (const b of ev.message?.content || []) {
      if (b.type === 'tool_use') {
        onTool(b.name, summarizeInput(b.input), ev.parent_tool_use_id ? { sub: true } : undefined);   // sub: made by a sub-agent, not a step of the reply itself
        if (isAgentTool(b.name)) { (st.agentIds ||= new Set()).add(b.id); onAgent({ event: 'start', id: b.id, parent: ev.parent_tool_use_id || '', type: b.input?.subagent_type, description: b.input?.description || b.input?.prompt, at: Date.now() }); }
        else if (ev.parent_tool_use_id) onAgent({ event: 'step', id: ev.parent_tool_use_id, tool: b.name, detail: summarizeInput(b.input), at: Date.now() });
      }
      // what a sub-agent says is its own report, not part of the reply
      if (b.type === 'text' && !st.streamed && !ev.parent_tool_use_id) { st.text += b.text; onText(b.text); }
    }
  } else if (ev.type === 'user' && st.agentIds?.size) {
    // a sub-agent coming back: the result of the Agent call. Whether it only launched in the background is in the tool's
    // structured output (tool_use_result.status), not in the text the model sees.
    const out = ev.tool_use_result;
    for (const b of Array.isArray(ev.message?.content) ? ev.message.content : []) {
      if (b.type === 'tool_result' && st.agentIds.has(b.tool_use_id)) {
        const text = resultText(b.content);
        const background = out?.status === 'async_launched' || out?.status === 'remote_launched' || /async_launched|^Async agent launched/i.test(text);
        if (background && (out?.agentId || out?.taskId)) (st.taskIds ||= new Map()).set(out.agentId || out.taskId, b.tool_use_id);
        onAgent({ event: 'end', id: b.tool_use_id, ok: !b.is_error, result: background ? '' : text, background, at: Date.now() });
      }
    }
  } else if (ev.type === 'system' && ev.subtype === 'task_notification') {
    // a background sub-agent finished (field names follow the SDK's task events; matched by tool call id or by the task id from the launch)
    const id = ev.tool_use_id || st.taskIds?.get(ev.task_id);
    if (id && st.agentIds?.has(id)) onAgent({ event: 'end', id, ok: !/fail|error|kill|stop/i.test(String(ev.status || '')), result: ev.summary || ev.result || '', at: Date.now() });
  } else if (ev.type === 'result') {
    return ev;
  }
  return null;
}

/**
 * Run one prompt in a fresh process. Returns { text, engine, model }.
 * opts: { engine, prompt, system?, connectors, dirs, model, onText(delta), onTool(name, detail), signal }
 */
export function run(opts) {
  if (!pick()) return Promise.reject(new Error('Claude Code was not found. Install it (claude) and sign in.'));
  return runClaude(opts);
}

function runClaude({ noRead, denyWeb, prompt, system, connectors = [], dirs = [], onText = () => {}, onTool = () => {}, onAgent = () => {}, signal, model, effort, edits, job, subagents }) {
  const d = detect();
  const args = claudeArgs({ noRead, denyWeb, connectors, dirs, model, system, effort, edits, job, subagents });
  return new Promise((resolve, reject) => {
    const child = spawnCli(d.claude.bin, args, { cwd: config.JADE_HOME, stdio: ['pipe', 'pipe', 'pipe'] });
    signal?.addEventListener('abort', () => child.kill());
    const st = { text: '', streamed: false, model: '' };
    let buf = '', final = null, err = '';
    child.stdout.on('data', chunk => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        const r = parseClaudeLine(line, st, { onText, onTool, onAgent });
        if (r) { final = typeof r.result === 'string' ? r.result : null; if (r.is_error) err = final || r.subtype || 'error'; }
      }
    });
    child.stderr.on('data', c => { err += c; });
    child.on('error', reject);
    child.on('close', code => {
      args.cleanup?.();
      if (signal?.aborted) return reject(new Error('Cancelled'));
      const out = final ?? st.text;
      if (code !== 0 && !out) return reject(new Error(cleanErr(err) || `claude exited with ${code}`));
      resolve({ text: out, engine: 'claude', model: st.model || model || '' });
    });
    child.stdin.end(prompt);
  });
}

function summarizeInput(input = {}) {
  if (input.subagent_type) return `${input.subagent_type}: ${input.description || ''}`.slice(0, 140); // a hand-off to a sub-agent (the Worker)
  return String(input.file_path || input.pattern || input.query || input.url || input.q || JSON.stringify(input)).slice(0, 140);
}

export function cleanErr(s) {
  return redact(String(s || '')).split('\n').filter(l => l.trim() && !/^\s+at /.test(l)).slice(-4).join('\n').slice(0, 600);
}
