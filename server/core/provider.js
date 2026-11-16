// How Claude Code reaches Claude. Two choices, the user's own Claude plan, or a company gateway /
// Amazon Bedrock set up from an address and a key. The choice is kept in <JADE_HOME>/engine.env as Claude Code's own
// variables (mode 600; never config.json, never git) and injected into every Claude Code process Jade starts; every
// routing variable is scrubbed from the environment first, so a stray variable on the machine can never send Jade's
// questions somewhere the user did not choose. "Use my Claude Code settings" reads ~/.claude/settings.json (never writes).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import * as config from './config.js';
import { SECRET_NAME } from './secretname.js';
import { writeText } from './util.js';

export const FILE = path.join(config.JADE_HOME, 'engine.env');

// Everything that decides where Claude Code sends requests (the full list). Cleared before Jade's own values are applied.
export const ROUTING_VARS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_BEDROCK_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_SKIP_BEDROCK_AUTH', 'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX', 'ANTHROPIC_VERTEX_BASE_URL', 'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_FOUNDRY_BASE_URL', 'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_MODEL',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY', 'NODE_EXTRA_CA_CERTS',
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'CLAUDE_CODE_USE_MANTLE', 'ANTHROPIC_BEDROCK_MANTLE_BASE_URL', 'CLAUDE_CODE_SKIP_MANTLE_AUTH',
];
// Plain Bedrock tuning (no secrets) that is taken over from Claude Code's settings as it is.
export const EXTRA_ENV = ['ANTHROPIC_BEDROCK_REGION_PREFIX', 'ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION', 'ANTHROPIC_BEDROCK_SERVICE_TIER',
  'DISABLE_PROMPT_CACHING', 'ENABLE_PROMPT_CACHING_1H', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_DISABLE_BEDROCK_CONTENT_TYPE_DEFAULT'];
const SECRET = ['AWS_BEARER_TOKEN_BEDROCK', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
export const HIDDEN = '••••';
/** Header lines with every value hidden: `Name: ••••`. */
export const maskHeaders = h => String(h || '').split(/\r?\n/).filter(l => l.trim()).map(l => { const i = l.indexOf(':'); return i > 0 ? `${l.slice(0, i)}: ${HIDDEN}` : l; }).join('\n');
const MANAGED = [...ROUTING_VARS, ...EXTRA_ENV, 'JADE_MODEL_OVERRIDES'];
function writeFile(all) {
  const lines = ['# Jade: how Claude Code reaches its models. Written by Settings → Engine; safe to edit by hand.',
    '# Claude Code\'s own variable names; the same file works in a terminal.', ''];
  for (const [k, v] of Object.entries(all)) lines.push(`${k}=${/[\s#"']/.test(v) ? JSON.stringify(v) : v}`);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  // written whole to a file of its own (owner only) and moved into place, so a crash or a second reader never sees half a key file.
  // On Windows the mode is ignored: the file has the access rules of its folder (see README, "Privacy and safety").
  writeText(FILE, lines.join('\n') + '\n', { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch {}
  restrictOnWindows(FILE);
}
// Windows has no owner-only mode bit: take the inherited access away and leave the current user only (icacls ships with Windows).
// Best effort and silent: where it cannot run, the README says what the file's access is.
function restrictOnWindows(file) {
  if (process.platform !== 'win32') return;
  try {
    const user = process.env.USERNAME;
    if (user) spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe'), [file, '/inheritance:r', '/grant:r', `${user}:F`], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
  } catch { /* leave it as it is */ }
}
/** The engine settings Jade hands over with --settings (not environment variables). */
export function engineSettings() {
  const e = read();
  let overrides = {};
  try { overrides = e.JADE_MODEL_OVERRIDES ? JSON.parse(e.JADE_MODEL_OVERRIDES) : {}; } catch {}
  return { skipWebFetchPreflight: true, ...(Object.keys(overrides).length ? { modelOverrides: overrides } : {}) };
}

export const STYLES = { plan: 'My Claude plan (signed in with claude auth login)', gateway: 'A company gateway or Amazon Bedrock (address and key)' };
export const MODES = { // kept for the parts of Jade that only need to know roughly where requests go
  subscription: 'Your Claude plan', bedrock: 'Amazon Bedrock with an API key', 'bedrock-gateway': 'Amazon Bedrock through a gateway', gateway: 'An Anthropic-format gateway',
};

// ------------------------------------------------------------------ the file
export function read() {
  let text = '';
  try { text = fs.readFileSync(FILE, 'utf8'); } catch { return {}; }
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) { try { v = v.startsWith('"') ? JSON.parse(v) : v.slice(1, -1); } catch { v = v.slice(1, -1); } }
    out[m[1]] = v;
  }
  return out;
}
export function mode(e = read()) {
  if (e.CLAUDE_CODE_USE_BEDROCK) return e.ANTHROPIC_BEDROCK_BASE_URL ? 'bedrock-gateway' : 'bedrock';
  if (e.ANTHROPIC_BASE_URL) return 'gateway';
  return 'subscription';
}
export const style = (e = read()) => (mode(e) === 'subscription' && !e.ANTHROPIC_API_KEY && !e.ANTHROPIC_AUTH_TOKEN ? 'plan' : 'gateway');

// Nothing in the engine reports out or updates itself (through a gateway these are on by default).
const QUIET = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  DISABLE_FEEDBACK_COMMAND: '1', CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1' };
/** The engine's own config folder, used whenever a gateway or key is set up (never on the Claude plan sign-in). */
export function engineHome() {
  const d = path.join(config.STATE, 'engine-home');
  fs.mkdirSync(d, { recursive: true });
  // A fresh config folder has never "onboarded"; headless runs must not stop at that gate.
  const j = path.join(d, '.claude.json');
  if (!fs.existsSync(j)) fs.writeFileSync(j, JSON.stringify({ hasCompletedOnboarding: true }));
  return d;
}
/**
 * Jade's variables for every Claude Code process. With a gateway or a key, the engine also gets a config folder of its
 * own with no login in it: checked against the real engine: otherwise, on a PC with a Claude login, the engine
 * sends that login's token to the gateway instead of the gateway's key. A company gateway must never see a personal
 * Claude login, and a key must mean the key.
 */
export function env() {
  const e = read();
  return { ...QUIET, ...(style(e) === 'gateway' ? { CLAUDE_CONFIG_DIR: engineHome() } : {}), ...e };
}
/** The model pins, so an alias (haiku / sonnet / opus) can be mapped before the engine is asked. */
export function pins(e = read()) { return { light: e.ANTHROPIC_DEFAULT_HAIKU_MODEL || '', standard: e.ANTHROPIC_DEFAULT_SONNET_MODEL || '', strong: e.ANTHROPIC_DEFAULT_OPUS_MODEL || '' }; }
/**
 * Clear every routing variable from an environment, so only Jade's own choice applies; and the internals of a Claude Code
 * session Jade may have been started from, so the engine never thinks it is that session's child.
 */
export function scrub(envObj) {
  for (const v of ROUTING_VARS) delete envObj[v];
  for (const k of Object.keys(envObj)) if (/^(CLAUDECODE$|CLAUDE_CODE_(SESSION_|MESSAGING_|CHILD_SESSION|AGENT$|ENTRYPOINT$|EXECPATH$)|CLAUDE_PID$|CLAUDE_JOB_DIR$)/.test(k)) delete envObj[k];
  return envObj;
}

// ------------------------------------------------------------------ what Settings sees
export function describe() {
  const e = read();
  const m = mode(e);
  const keyVar = e.AWS_BEARER_TOKEN_BEDROCK ? 'AWS_BEARER_TOKEN_BEDROCK' : e.ANTHROPIC_AUTH_TOKEN ? 'ANTHROPIC_AUTH_TOKEN' : e.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : '';
  const key = keyVar ? e[keyVar] : '';
  const bedrock = m.startsWith('bedrock');
  return {
    style: style(e), mode: m, label: MODES[m], file: FILE, exists: fs.existsSync(FILE),
    format: bedrock ? 'bedrock' : 'anthropic',
    baseUrl: bedrock ? e.ANTHROPIC_BEDROCK_BASE_URL || '' : e.ANTHROPIC_BASE_URL || '',
    keyKind: keyVar === 'AWS_BEARER_TOKEN_BEDROCK' ? 'bedrock-key' : keyVar === 'ANTHROPIC_API_KEY' ? 'x-api-key' : 'token',
    hasKey: !!key, keyHint: key ? '…' + key.slice(-4) : '',
    region: e.AWS_REGION || '', headers: maskHeaders((e.ANTHROPIC_CUSTOM_HEADERS || '').replace(/\\n/g, '\n')),
    disableBetas: !!e.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, certFile: e.NODE_EXTRA_CA_CERTS || '',
    models: { light: e.ANTHROPIC_DEFAULT_HAIKU_MODEL || '', standard: e.ANTHROPIC_DEFAULT_SONNET_MODEL || '', strong: e.ANTHROPIC_DEFAULT_OPUS_MODEL || '' },
    extra: Object.keys(e).filter(k => !MANAGED.includes(k)).map(k => (SECRET.includes(k) || SECRET_NAME.test(k) ? `${k} (set)` : `${k}=${e[k]}`)),
  };
}

// ------------------------------------------------------------------ saving a choice
const HEADER_LINE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+:[ \t]*\S[^\r\n]*$/;
export function parseHeaders(raw) {
  const lines = String(raw || '').split(/\r?\n|\\n/).map(l => l.trim()).filter(Boolean);
  for (const l of lines) if (!HEADER_LINE.test(l)) throw new Error(`"${l.slice(0, 40)}" is not a header. Write each one as Name: Value, one per line.`);
  if (lines.some(l => /^(authorization|x-api-key):/i.test(l))) throw new Error('The key goes in the key box, not in a header.');
  return lines.join('\n');
}

/**
 * { style: 'plan'|'gateway', format: 'anthropic'|'bedrock', baseUrl, key, keyKind: 'token'|'x-api-key'|'bedrock-key',
 *   region, headers, disableBetas, certFile, models: {light, standard, strong}, extraEnv }
 * A blank key keeps the key already on file. Returns describe().
 */
export function configure(p = {}) {
  const prev = read();
  const keep = {};
  for (const [k, v] of Object.entries(prev)) if (!MANAGED.includes(k)) keep[k] = v;
  const next = {};
  if (p.style !== 'plan') {
    const url = String(p.baseUrl || '').trim().replace(/\/+$/, '');
    const key = String(p.key || '').trim() || prev.AWS_BEARER_TOKEN_BEDROCK || prev.ANTHROPIC_AUTH_TOKEN || prev.ANTHROPIC_API_KEY || '';
    const bedrock = p.format === 'bedrock' || p.keyKind === 'bedrock-key';
    if (url && !/^https?:\/\//i.test(url)) throw new Error('The address must start with https://');
    if (!url && !bedrock && !(key && p.keyKind === 'x-api-key')) throw new Error('Enter the gateway address (or choose the Amazon Bedrock format with a Bedrock API key for Bedrock itself; an Anthropic API key alone also works, as "an API key").');
    if (!url && bedrock && !key) throw new Error('Amazon Bedrock itself needs a Bedrock API key.');
    if (bedrock) {
      next.CLAUDE_CODE_USE_BEDROCK = '1';
      if (url) next.ANTHROPIC_BEDROCK_BASE_URL = url;
      // Jade never signs requests with AWS credentials: the gateway (or the Bedrock API key) carries the identity.
      next.CLAUDE_CODE_SKIP_BEDROCK_AUTH = '1';
      if (key) next[p.keyKind === 'bedrock-key' || (!url && p.keyKind !== 'token') ? 'AWS_BEARER_TOKEN_BEDROCK' : 'ANTHROPIC_AUTH_TOKEN'] = key;
      if (String(p.region || '').trim()) next.AWS_REGION = String(p.region).trim();
    } else {
      if (url) { next.ANTHROPIC_BASE_URL = url; next.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'; } // no address: an Anthropic API key, straight to Anthropic
      if (key) next[p.keyKind === 'x-api-key' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'] = key;
    }
    // Bedrock gateways often map one Claude version to the company's own inference profile (an ARN); Claude Code reads
    // that map from its settings, so Jade keeps it here and hands it to the engine with the settings file.
    const ov = p.modelOverrides && typeof p.modelOverrides === 'object' ? Object.fromEntries(Object.entries(p.modelOverrides).filter(([k, v]) => /^[\w.:\/@-]{1,300}$/.test(k) && typeof v === 'string' && /^[\w.:\/@-]{1,300}$/.test(v))) : null;
    if (ov && Object.keys(ov).length) next.JADE_MODEL_OVERRIDES = JSON.stringify(ov); else if (prev.JADE_MODEL_OVERRIDES && p.modelOverrides === undefined) next.JADE_MODEL_OVERRIDES = prev.JADE_MODEL_OVERRIDES;
    const m = { ...pins(prev), ...Object.fromEntries(Object.entries(p.models || {}).filter(([, v]) => String(v || '').trim())) }; // blank keeps a saved pin
    if (m.light) next.ANTHROPIC_DEFAULT_HAIKU_MODEL = String(m.light).trim();
    if (m.standard) next.ANTHROPIC_DEFAULT_SONNET_MODEL = String(m.standard).trim();
    if (m.strong) next.ANTHROPIC_DEFAULT_OPUS_MODEL = String(m.strong).trim();
    // a header shown as `Name: ••••` keeps the value saved for that name
    const saved = Object.fromEntries(String(prev.ANTHROPIC_CUSTOM_HEADERS || '').split(/\\n|\r?\n/).filter(Boolean).map(l => [l.slice(0, l.indexOf(':')).trim().toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
    const h = parseHeaders(String(p.headers || '').split(/\r?\n|\\n/).map(l => { const i = l.indexOf(':'); return i > 0 && l.slice(i + 1).trim() === HIDDEN && saved[l.slice(0, i).trim().toLowerCase()] ? `${l.slice(0, i).trim()}: ${saved[l.slice(0, i).trim().toLowerCase()]}` : l; }).join('\n'));
    if (h) next.ANTHROPIC_CUSTOM_HEADERS = h.replace(/\n/g, '\\n');
    if (p.disableBetas) next.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
    if (String(p.certFile || '').trim()) next.NODE_EXTRA_CA_CERTS = String(p.certFile).trim();
    for (const [k, v] of Object.entries(p.extraEnv || {})) if (EXTRA_ENV.includes(k) && /^[\w.:\/@-]{1,200}$/.test(String(v))) next[k] = String(v);
  }
  writeFile({ ...keep, ...next });
  return describe();
}

// ------------------------------------------------------------------ "Use my Claude Code settings"
const claudeSettingsPath = () => path.join(os.homedir(), '.claude', 'settings.json');
const str = v => (typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const on = v => /^(1|true|yes|on)$/i.test(str(v));

// The Claude desktop app, set up for a company gateway, keeps that set-up in its own config library rather than in
// ~/.claude/settings.json: <app data>/configLibrary/_meta.json names the applied entry, and that entry holds
// inferenceProvider, inferenceGatewayBaseUrl, inferenceGatewayApiKey and inferenceGatewayAuthScheme. Read the same way, so
// "Use my Claude Code settings" finds a desktop-app set-up too. Windows keeps it under %LOCALAPPDATA%\Claude-3p (or Claude).
function desktopConfigDirs() {
  const home = os.homedir();
  const bases = process.platform === 'win32' ? [process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), process.env.APPDATA || path.join(home, 'AppData', 'Roaming')]
    : process.platform === 'darwin' ? [path.join(home, 'Library', 'Application Support')] : [process.env.XDG_CONFIG_HOME || path.join(home, '.config')];
  return bases.flatMap(b => ['Claude-3p', 'Claude'].map(n => path.join(b, n, 'configLibrary')));
}
function desktopGateway() {
  for (const dir of desktopConfigDirs()) {
    let meta, entry;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8'));
      if (!/^[\w-]{1,80}$/.test(String(meta.appliedId || ''))) continue;
      entry = JSON.parse(fs.readFileSync(path.join(dir, `${meta.appliedId}.json`), 'utf8'));
    } catch { continue; }
    if (entry?.inferenceProvider !== 'gateway' || !str(entry.inferenceGatewayBaseUrl)) continue;
    const env = { ANTHROPIC_BASE_URL: str(entry.inferenceGatewayBaseUrl) };
    const key = str(entry.inferenceGatewayApiKey);
    if (key) env[/x-api-key/i.test(str(entry.inferenceGatewayAuthScheme)) ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'] = key;
    return env;
  }
  return null;
}
// The settings to import: ~/.claude/settings.json when it names a gateway or key, else the desktop app's gateway set-up.
function claudeSource() {
  let json = null, unreadable = false;
  try { json = JSON.parse(fs.readFileSync(claudeSettingsPath(), 'utf8')); } catch (err) { unreadable = err.code !== 'ENOENT'; }
  const env = json && typeof json.env === 'object' && json.env ? json.env : {};
  const named = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK'].some(k => str(env[k]));
  if (json && named) return { json, env, from: 'settings' };
  const desk = desktopGateway();
  if (desk) return { json: {}, env: desk, from: 'desktop' };
  if (json) return { json, env, from: 'settings' };
  return { error: unreadable ? 'The Claude Code settings file could not be read.' : 'No Claude Code settings on this computer (~/.claude/settings.json, or the Claude desktop app\'s gateway set-up). Paste the address and key instead.' };
}

/** What ~/.claude/settings.json (or the Claude desktop app's gateway set-up) already says, read only. Returns { ok, found, notes } or { ok: false, error }. */
function readImport() {
  const src = claudeSource();
  if (src.error) return { ok: false, error: src.error };
  const { json, env } = src;
  const bedrock = on(env.CLAUDE_CODE_USE_BEDROCK);
  const baseUrl = (bedrock ? str(env.ANTHROPIC_BEDROCK_BASE_URL) : str(env.ANTHROPIC_BASE_URL)).replace(/\/+$/, '');
  const awsBearer = str(env.AWS_BEARER_TOKEN_BEDROCK), token = str(env.ANTHROPIC_AUTH_TOKEN), apiKey = str(env.ANTHROPIC_API_KEY);
  const keyVar = bedrock && awsBearer ? 'AWS_BEARER_TOKEN_BEDROCK' : token ? 'ANTHROPIC_AUTH_TOKEN' : apiKey ? 'ANTHROPIC_API_KEY' : awsBearer ? 'AWS_BEARER_TOKEN_BEDROCK' : '';
  const extraEnv = {};
  for (const n of EXTRA_ENV) { const v = str(env[n]); if (v && /^[\w.:\/@-]{1,200}$/.test(v)) extraEnv[n] = v; }
  const modelOverrides = {};
  if (json.modelOverrides && typeof json.modelOverrides === 'object') for (const [k, v] of Object.entries(json.modelOverrides)) if (typeof v === 'string' && /^[\w.:\/@-]{1,300}$/.test(k) && /^[\w.:\/@-]{1,300}$/.test(v)) modelOverrides[k] = v;
  const awsIdentity = [str(env.AWS_PROFILE) && 'AWS_PROFILE', str(env.AWS_ACCESS_KEY_ID) && 'AWS_ACCESS_KEY_ID', str(json.awsAuthRefresh) && 'awsAuthRefresh', str(json.awsCredentialExport) && 'awsCredentialExport'].filter(Boolean);
  const found = {
    style: 'gateway', format: bedrock ? 'bedrock' : 'anthropic', baseUrl, keyVar, key: keyVar ? str(env[keyVar]) : '',
    keyKind: keyVar === 'AWS_BEARER_TOKEN_BEDROCK' ? 'bedrock-key' : keyVar === 'ANTHROPIC_API_KEY' ? 'x-api-key' : 'token',
    region: str(env.AWS_REGION) || str(env.AWS_DEFAULT_REGION),
    headers: String(str(env.ANTHROPIC_CUSTOM_HEADERS)).split(/\\n|\r?\n/).filter(l => HEADER_LINE.test(l.trim()) && !/^(authorization|x-api-key):/i.test(l.trim())).join('\n'),
    disableBetas: on(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS), certFile: str(env.NODE_EXTRA_CA_CERTS),
    models: { light: str(env.ANTHROPIC_DEFAULT_HAIKU_MODEL), standard: str(env.ANTHROPIC_DEFAULT_SONNET_MODEL), strong: str(env.ANTHROPIC_DEFAULT_OPUS_MODEL) },
    extraEnv, modelOverrides, keyHelper: !!str(json.apiKeyHelper), awsIdentity,
  };
  if (!baseUrl && !found.key) {
    if (awsIdentity.length) return { ok: false, error: `Those settings connect to Amazon Bedrock with your own AWS sign-in (${awsIdentity.join(', ')}), not through an address and key. Jade does not sign in to AWS itself; if you were given a gateway address or a Bedrock API key, paste them.` };
    return { ok: false, error: found.keyHelper ? 'Those settings fetch the key with a command (apiKeyHelper), which Jade does not run. Paste the key yourself.' : 'Those settings hold no gateway address or key (Jade looked in the env block of ~/.claude/settings.json).' };
  }
  const notes = [];
  if (src.from === 'desktop') notes.push('Found in the Claude desktop app\'s gateway set-up (its config library), not in ~/.claude/settings.json.');
  if (!baseUrl) notes.push('No gateway address there, so requests would go to Anthropic directly with that key.');
  if (!found.key) notes.push(found.keyHelper ? 'The key comes from a command (apiKeyHelper) there; paste it yourself if the gateway needs one.' : 'No key found there; paste it if the gateway needs one.');
  if (awsIdentity.length) notes.push(`Those settings also sign in as an AWS identity (${awsIdentity.join(', ')}). Jade does not; it sends the key and leaves AWS to the gateway.`);
  if (Object.keys(modelOverrides).length) notes.push(`Also taking over ${Object.keys(modelOverrides).length} model override${Object.keys(modelOverrides).length === 1 ? '' : 's'} (a Claude version mapped to your company's inference profile).`);
  return { ok: true, found, notes };
}
/** What the settings say, for showing: no key, header values hidden. */
export function importClaudeSettings() {
  const r = readImport();
  if (!r.ok) return r;
  const { key, ...shown } = r.found;
  return { ok: true, found: { ...shown, headers: maskHeaders(shown.headers), hasKey: !!key, keyHint: key ? '…' + key.slice(-4) : '' }, notes: r.notes };
}
/** Apply what importClaudeSettings found. */
export function useClaudeSettings() {
  const r = readImport();
  if (!r.ok) throw new Error(r.error);
  const raw = importRaw();
  return configure({ ...raw, style: 'gateway' });
}
function importRaw() { // the same read, with the key, for applying
  const { env } = claudeSource();
  const r = readImport();
  const keyVar = r.found.keyVar;
  return { ...r.found, key: keyVar ? str(env[keyVar]) : '' };
}
