// Records what Jade hands the Claude Code engine for a matrix of provider set-ups and model choices: a chat run (cold-started
// worker), a normal agent run (read-only and with edits), a locked-down judge run and the connection check. Per run it records the
// argv, the contents of the files argv only names (tool settings, MCP config, system prompt: kept once each, under their hash),
// and the WHOLE environment given to the child (less MACHINE_SPECIFIC). Extra scenarios cover a parent environment that already
// holds ANTHROPIC_* / AWS_* / proxy variables, every other provider variable, the Bedrock-with-a-key connection check (the web
// call is answered by a stand-in, never sent), and inputs the matrix holds constant. See test/fixtures/README.md.
// Used by test/provider-parity.test.js (against the frozen fixture) and, once, to compare against the original code.
// Usage: node scripts/parity-harness.mjs <server tree root> <out.json> [--plan] [--shard=K/N]
// --shard=K/N records only the K-th of N contiguous parts of the set-ups (K from 1); the parts joined in order are the whole record, so the test runs them side by side.
//  (gateway and Bedrock set-ups, or with --plan the plain login). Never starts a real `claude`: a stand-in on PATH
// writes down its argv and env and answers with one result line. Everything lives in a temp JADE_HOME / JADE_CLAUDE_HOME.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { makeNormaliser, variants } from './parity-normalise.mjs';
import { writeStub } from '../test/helpers/stub.js';

const [root, out] = process.argv.slice(2).filter(a => !a.startsWith('--')).map(p => path.resolve(p));
const PLAN = process.argv.includes('--plan');
const [SHARD, SHARDS] = (/^--shard=(\d+)\/(\d+)$/.exec(process.argv.find(a => a.startsWith('--shard=')) || '') || [0, 1, 1]).slice(1).map(Number);
const WIN = process.platform === 'win32';
const tmp = (WIN ? fs.realpathSync.native : fs.realpathSync)(fs.mkdtempSync(path.join(os.tmpdir(), 'jade-parity-')));   // the real path: on macOS /var is a link to /private/var
const bin = path.join(tmp, 'bin'), dump = path.join(tmp, 'dump'), home = path.join(tmp, 'home');
for (const d of [bin, dump, home]) fs.mkdirSync(d, { recursive: true });
writeStub(bin, 'claude', `const fs = require('node:fs');
const a = process.argv.slice(2);
if (a[0] !== '-p' || a.includes('/model')) { if (a[0] === 'auth') process.stdout.write('{}'); process.exit(0); } // Jade's own status calls are not runs
// the files argv only names are read now, while the run still exists (they are removed when it ends)
const files = {};
for (const [flag, name] of [['--settings', 'settings'], ['--mcp-config', 'mcp'], ['--append-system-prompt-file', 'system']]) {
  const i = a.indexOf(flag);
  if (i >= 0) { try { files[name] = fs.readFileSync(a[i + 1], 'utf8'); } catch (e) { files[name] = '<unreadable: ' + e.code + '>'; } }
}
fs.writeFileSync(${JSON.stringify(dump)} + '/run.json', JSON.stringify({ argv: a, env: process.env, files }));
const res = JSON.stringify({ type: 'result', result: 'OK', is_error: false, structured_output: { ok: 1 }, modelUsage: {} }) + '\\n';
if (a.includes('--input-format')) { let b = ''; process.stdin.on('data', c => { b += c; while (b.includes('\\n')) { b = b.slice(b.indexOf('\\n') + 1); process.stdout.write(res); } }); }
else { process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(res); process.exit(0); }); }
`);
// The parent environment is built here, not inherited, so the record is the same on every machine. Besides PATH and HOME it holds
// proxy and certificate variables on purpose: they are in the record, so a change that stopped passing them on is seen.
// CLAUDE_EFFORT=medium was in the environment the original record was made in, so it is kept here on purpose: the engine passes it on.
// (ANTHROPIC_*, AWS_* and CLAUDE_CODE_* are added only by the "ambient" scenarios below.)
const PARENT = { CLAUDE_EFFORT: 'medium', HTTPS_PROXY: 'http://proxy.test:3128', HTTP_PROXY: 'http://proxy.test:3128', NO_PROXY: '127.0.0.1,localhost', https_proxy: 'http://proxy.test:3128',
  SSL_CERT_FILE: '/certs/corp.pem', REQUESTS_CA_BUNDLE: '/certs/corp.pem', LANG: 'C.UTF-8', TZ: 'UTC' };
// Names left out of the whole-environment comparison because they differ from machine to machine by nature (they hold temp folders
// of this run). Everything else the child receives is compared. Keep this list short; README explains each name.
const MACHINE_SPECIFIC = ['PATH', 'HOME', 'JADE_CLAUDE_HOME', 'TMPDIR', 'TEMP', 'TMP', 'PWD', 'OLDPWD', '_', '__CF_USER_TEXT_ENCODING'];   // __CF_USER_TEXT_ENCODING: macOS adds it to every program it starts
// Windows only: the stand-in `claude` is a .cmd shim, which needs cmd.exe (ComSpec, SystemRoot, PATHEXT) and a PATH that reaches System32, and
// Windows programs look for the home folder in USERPROFILE. These names exist only there; WINDOWS_ONLY (case ignored) keeps them out of the
// record so it stays byte-identical to the one made on Linux. Documented in test/fixtures/README.md.
const WINDOWS_ONLY = ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'SYSTEMDRIVE', 'HOMEDRIVE', 'HOMEPATH'];
const winEnv = {};
if (WIN) for (const k of Object.keys(process.env)) if (WINDOWS_ONLY.includes(k.toUpperCase())) winEnv[k] = process.env[k];
const sysRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
const parentPath = WIN ? [bin, path.dirname(process.execPath), path.join(sysRoot, 'System32'), sysRoot] : [bin, path.dirname(process.execPath), '/usr/bin', '/bin'];
for (const k of Object.keys(process.env)) delete process.env[k];
Object.assign(process.env, PARENT, winEnv, { PATH: parentPath.join(path.delimiter), HOME: home, ...(WIN ? { USERPROFILE: home } : {}),
  JADE_HOME: path.join(tmp, 'jade'), JADE_CLAUDE_HOME: path.join(tmp, 'claude') });

const HEADERS = ['authorization', 'x-api-key', 'content-type', 'anthropic-version'];   // the ones that carry the key and the format
const pick = h => Object.fromEntries(HEADERS.filter(k => h[k] !== undefined).map(k => [k, String(h[k])]));
const gateway = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { seen.push(`${req.method} ${req.url} ${b}`); seenHeaders.push(pick(req.headers)); res.end('{}'); }); });
const seen = [], seenHeaders = [];
await new Promise(r => gateway.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${gateway.address().port}`;

// The connection check for Bedrock with a key would call the real Amazon address. Here the web call is answered by a stand-in and
// written down like a request the local gateway received: nothing leaves this machine.
const realFetch = globalThis.fetch;
function standInFetch(answer) {
  globalThis.fetch = async (url, o = {}) => {
    seen.push(`${o.method || 'GET'} ${url} ${o.body || ''}`);
    const h = {}; for (const [k, v] of Object.entries(o.headers || {})) h[k.toLowerCase()] = v;
    seenHeaders.push(pick(h));
    if (answer === 'throw') throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    return new Response('{}', { status: answer || 200 });
  };
  return () => { globalThis.fetch = realFetch; };
}

const at = p => import(pathToFileURL(path.join(root, 'server/core', p)).href);
const config = await at('config.js'), engines = await at('engines.js'), warm = await at('warm.js'), judge = await at('judge.js');
config.load();
const ENV = path.join(config.JADE_HOME, 'engine.env'), MODELS = path.join(config.STATE, 'models.json');
fs.mkdirSync(config.STATE, { recursive: true });

const DEFAULT_MODEL = config.get().models.claude;
const PINS = { none: {}, all: { ANTHROPIC_DEFAULT_HAIKU_MODEL: 'pin-haiku', ANTHROPIC_DEFAULT_SONNET_MODEL: 'pin-sonnet', ANTHROPIC_DEFAULT_OPUS_MODEL: 'pin-opus' },
  sonnetOnly: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'pin-sonnet' }, opusOnly: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'pin-opus' } };
const PROVIDERS = { plan: {}, apiKey: { ANTHROPIC_API_KEY: 'sk-test' },
  bedrockKey: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_BEARER_TOKEN_BEDROCK: 'bk-test', AWS_REGION: 'us-east-1' },
  bedrockGateway: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_BEARER_TOKEN_BEDROCK: 'bk-test', AWS_REGION: 'us-east-1', ANTHROPIC_BEDROCK_BASE_URL: URL_ },
  anthropicGateway: { ANTHROPIC_BASE_URL: URL_, ANTHROPIC_AUTH_TOKEN: 'tok-test' } };
const CACHES = { empty: null, discovered: { at: 'x', current: 'sonnet', aliases: ['sonnet', 'opus', 'haiku'],
  models: ['us.anthropic.claude-haiku-4-5-20251001-v1:0', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'us.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-opus-4-1-20250805-v1:0', 'us.anthropic.claude-opus-4-5-20251101-v1:0'] } };
const CHOICES = ['', 'sonnet', 'haiku', 'opus', 'default', 'fable', 'opus[1m]', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'];

// ids and paths that differ from run to run
// Folders become tokens through scripts/parity-normalise.mjs (all Windows spellings, long and short names); nothing changes on Linux and macOS.
const normText = makeNormaliser([{ paths: variants(config.JADE_HOME), token: '<JADE_HOME>' }, { paths: variants(tmp), token: '<TMP>' }, { paths: variants(root), token: '<APP>' }, { paths: variants(process.execPath), token: '<NODE>' },
  ...(WIN ? [{ paths: [...variants(os.tmpdir()), ...variants(process.env.JADE_CLAUDE_HOME || os.tmpdir())], token: '<TMP>' }] : [])]);
const norm = s => normText(s).replace(/"JADE_PORT":"\d+"/, '"JADE_PORT":"<PORT>"').replace(URL_, '<GATEWAY>')
  .replace(/(system|judge)-[A-Za-z0-9_-]+\.md/g, '$1-ID.md').replace(/(permission[\w-]*?)-[A-Za-z0-9_-]{6,}\.json/g, '$1-ID.json').replace(/(mcp-jade-[\w-]*?)-s[0-9a-f]{8}\.json/g, '$1.json');
const recorded = () => {
  const f = path.join(dump, 'run.json'); if (!fs.existsSync(f)) return null;
  const r = JSON.parse(fs.readFileSync(f, 'utf8')); fs.rmSync(f);
  const env = {}; for (const k of Object.keys(r.env).sort()) if (/^(ANTHROPIC_|AWS_|CLAUDE_|DISABLE_|NODE_EXTRA|MCP_|JADE_)/.test(k) && k !== 'JADE_CLAUDE_HOME') env[k] = norm(r.env[k]);
  const fullEnv = {}; for (const k of Object.keys(r.env).sort()) if (!MACHINE_SPECIFIC.includes(WIN ? k.toUpperCase() : k) && !WINDOWS_ONLY.includes(k.toUpperCase())) fullEnv[k] = norm(r.env[k]);
  // each file's text is kept once, under a short hash; a run points at it
  const files = {};
  for (const [name, text] of Object.entries(r.files || {})) { const t = norm(text), h = crypto.createHash('sha256').update(t).digest('hex').slice(0, 12); contents[h] = t; files[name] = h; }
  return { argv: r.argv.map(norm), env, fullEnv, files };
};
// A finished run removes its tool-settings file a moment later, by name; the next run may use the same name (job and thread are both 'j1'), so wait.
const toolFileGone = async () => { const left = () => { try { return fs.readdirSync(path.join(config.STATE, 'run')).some(n => /^mcp-jade-j1-s[0-9a-f]{8}\.json$/.test(n)); } catch { return false; } }; for (let i = 0; i < 100 && left(); i++) await new Promise(r => setTimeout(r, 20)); };
let currentProvider = '';
const runs = {
  chat: m => warm.turn('t-' + Math.random(), { connectors: [], dirs: [], model: m, system: 'sys', edits: false, subagents: '' }, { prompt: 'hi' }).then(() => warm.shutdown?.()),
  // the same settings as agentEdit, but through a warm worker: it must build the same arguments as a cold start (the test compares them)
  chatEdit: m => warm.turn('j1', { connectors: ['web'], dirs: [], model: m, system: 'sys', edits: true, thread: 'j1', subagents: '' }, { prompt: 'hi' }).then(() => warm.shutdown?.()),
  agent: m => engines.run({ prompt: 'hi', system: 'sys', connectors: [], dirs: [], model: m }),
  agentEdit: m => engines.run({ prompt: 'hi', system: 'sys', connectors: ['web'], dirs: [], model: m, edits: true, job: 'j1' }),
  judge: m => judge.judge({ system: 'sys', prompt: 'hi', schema: { type: 'object' }, ...(m === '' ? {} : { model: m }) }),
  // reads the saved model setting rather than a choice; '' leaves the default untouched (the original's 'sonnet', the new ''), and
  // on Bedrock with a key only, the check's web call (the real Amazon address) is answered by a stand-in instead
  check: async m => {
    if (m !== '') config.save({ models: { claude: m } });
    const restore = currentProvider === 'bedrockKey' ? standInFetch() : () => {};
    try { return await engines.test(); } finally { restore(); config.save({ models: { claude: DEFAULT_MODEL } }); }
  },
};
const contents = {};   // hash -> text of a file the engine was handed
const result = { envs: {}, fullEnvs: {}, runs: {}, contents, extras: {} }; // the env is the same for every run of one set-up, so it is kept once
const combos = [];   // every set-up (provider, pins, model list), in the order they are recorded
for (const [pn, pe] of Object.entries(PROVIDERS)) for (const [kn, pins] of Object.entries(PINS)) {
  if ((pn === 'plan') !== PLAN || (pn === 'plan' && kn !== 'none')) continue;
  for (const [cn, cache] of Object.entries(CACHES)) combos.push({ pn, pe, kn, pins, cn, cache });
}
const part = Math.ceil(combos.length / SHARDS);
for (const { pn, pe, kn, pins, cn, cache } of combos.slice((SHARD - 1) * part, SHARD * part)) {
  {
    currentProvider = pn;
    fs.writeFileSync(ENV, Object.entries({ ...pe, ...pins }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    if (cache) { fs.writeFileSync(MODELS, JSON.stringify(cache)); fs.utimesSync(MODELS, new Date(), new Date(Date.now() + 1000 * (Object.keys(result.runs).length + 1))); } else fs.rmSync(MODELS, { force: true });
    for (const [rn, run] of Object.entries(runs)) for (const choice of CHOICES) {
      seen.length = 0; seenHeaders.length = 0;
      let err = '';
      try { await run(choice); } catch (e) { err = e.message; }
      await toolFileGone();
      const rec = recorded() || { argv: null };
      const { env, fullEnv, ...rest } = rec;
      if (fullEnv) { const k = pn + ' | ' + kn, j = JSON.stringify(fullEnv); if (result.fullEnvs[k] && JSON.stringify(result.fullEnvs[k]) !== j) throw new Error('whole env differs within ' + k); result.fullEnvs[k] = fullEnv; }
      if (env) { const k = pn + ' | ' + kn, j = JSON.stringify(env); if (result.envs[k] && JSON.stringify(result.envs[k]) !== j) throw new Error('env differs within ' + k); result.envs[k] = env; }
      result.runs[[pn, kn, cn, rn, JSON.stringify(choice)].join(' | ')] = { ...rest, ...(err ? { err: norm(err) } : {}), ...(rn === 'check' ? { requests: seen.map(norm), requestHeaders: seenHeaders.map(h => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, norm(v)]))) } : {}),
        engineModel: engines.engineModel(choice) };
    }
  }
}

// ---------------------------------------------------------------- extra scenarios (recorded once, by the first part)
// Each writes engine.env, may add variables to the PARENT environment for the run, then records the whole run: argv, file contents, whole env.
if (SHARD === 1) {
  const AMBIENT = { ANTHROPIC_API_KEY: 'ambient-key', ANTHROPIC_AUTH_TOKEN: 'ambient-token', ANTHROPIC_BASE_URL: 'http://ambient.invalid', ANTHROPIC_MODEL: 'ambient-model',
    CLAUDE_CODE_USE_BEDROCK: '1', AWS_BEARER_TOKEN_BEDROCK: 'ambient-bearer', AWS_REGION: 'ambient-region', AWS_PROFILE: 'ambient-profile', AWS_ACCESS_KEY_ID: 'ambient-id',
    AWS_SECRET_ACCESS_KEY: 'ambient-secret', NODE_EXTRA_CA_CERTS: '/certs/ambient.pem', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', JADE_TOKEN: 'ambient-jade-key' };
  // every provider variable the matrix does not use, with a fake value
  const OTHER = { ANTHROPIC_MODEL: 'other-model', ANTHROPIC_CUSTOM_HEADERS: 'X-Team: t1', CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1', AWS_DEFAULT_REGION: 'eu-west-1',
    ANTHROPIC_BEDROCK_REGION_PREFIX: 'eu', ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION: 'eu-west-2', ANTHROPIC_BEDROCK_SERVICE_TIER: 'priority',
    CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_VERTEX_BASE_URL: 'https://vertex.test', CLAUDE_CODE_SKIP_VERTEX_AUTH: '1', CLAUDE_CODE_USE_FOUNDRY: '1',
    ANTHROPIC_FOUNDRY_BASE_URL: 'https://foundry.test', ANTHROPIC_FOUNDRY_API_KEY: 'fk-test', ANTHROPIC_FOUNDRY_AUTH_TOKEN: 'ft-test', CLAUDE_CODE_USE_MANTLE: '1',
    ANTHROPIC_BEDROCK_MANTLE_BASE_URL: 'https://mantle.test', CLAUDE_CODE_SKIP_MANTLE_AUTH: '1', CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1', NODE_EXTRA_CA_CERTS: '/certs/own.pem', DISABLE_PROMPT_CACHING: '1', ENABLE_PROMPT_CACHING_1H: '1',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000', CLAUDE_CODE_DISABLE_BEDROCK_CONTENT_TYPE_DEFAULT: '1',
    JADE_MODEL_OVERRIDES: JSON.stringify({ 'us.anthropic.claude-sonnet-4-6': 'my-profile' }) };
  const dirA = path.join(tmp, 'folder-a'); fs.mkdirSync(dirA, { recursive: true });
  const write = e => { fs.writeFileSync(ENV, Object.entries(e).map(([k, v]) => `${k}=${/[\s#"']/.test(v) ? JSON.stringify(v) : v}`).join('\n') + '\n'); fs.rmSync(MODELS, { force: true }); };
  async function scenario(name, e, { parent = {}, answer } = {}, go) {
    if (name.includes('| plan |') !== PLAN) return;   // the plain-login record holds only its own scenario
    write(e);
    const saved = {}; for (const k of Object.keys(parent)) { saved[k] = process.env[k]; process.env[k] = parent[k]; }
    seen.length = 0; seenHeaders.length = 0;
    const restore = answer === undefined ? () => {} : standInFetch(answer);
    let value, err = '';
    try { value = await go(); } catch (x) { err = x.message; }
    finally { restore(); for (const k of Object.keys(saved)) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]); }
    await toolFileGone();
    const rec = recorded();
    const out = { ...(rec ? { argv: rec.argv, files: rec.files, fullEnv: rec.fullEnv } : { argv: null }), ...(err ? { err: norm(err) } : {}) };
    if (value && typeof value === 'object' && 'ok' in value) out.check = { ...value, ms: undefined, ...(value.error ? { error: norm(value.error) } : {}), requests: seen.map(norm), requestHeaders: seenHeaders.map(h => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, norm(v)]))) };
    result.extras[name] = out;
  }
  const agent = (o = {}) => () => engines.run({ prompt: 'hi', system: 'sys', connectors: [], dirs: [], model: '', ...o });
  // a parent environment that already holds provider variables: the run is built from Jade's own choice only
  await scenario('ambient | plan | agent', PROVIDERS.plan, { parent: AMBIENT }, agent());
  await scenario('ambient | bedrockGateway | agent', PROVIDERS.bedrockGateway, { parent: AMBIENT }, agent());
  await scenario('ambient | anthropicGateway | chat', PROVIDERS.anthropicGateway, { parent: AMBIENT }, () => runs.chat(''));
  await scenario('ambient | apiKey | check', PROVIDERS.apiKey, { parent: AMBIENT, answer: 200 }, () => engines.test());
  // every other provider variable, given through engine.env
  await scenario('other variables | bedrockGateway | agent', { ...PROVIDERS.bedrockGateway, ...OTHER }, {}, agent());
  await scenario('other variables | bedrockGateway | check', { ...PROVIDERS.bedrockGateway, ...OTHER }, {}, () => engines.test());
  await scenario('other variables | bedrockKey | check', { ...PROVIDERS.bedrockKey, ...OTHER }, { answer: 200 }, () => engines.test());
  await scenario('other variables | anthropicGateway | agent', { ...PROVIDERS.anthropicGateway, ANTHROPIC_MODEL: 'other-model', ANTHROPIC_CUSTOM_HEADERS: 'X-Team: t1' }, {}, agent());
  await scenario('other variables | anthropicGateway | check', { ...PROVIDERS.anthropicGateway, ANTHROPIC_MODEL: 'other-model', ANTHROPIC_CUSTOM_HEADERS: 'X-Team: t1' }, {}, () => engines.test());
  // the Bedrock-with-a-key connection check: what it asks for and how it reads each answer
  for (const [label, answer] of [['200', 200], ['400', 400], ['401', 401], ['403', 403], ['500', 500], ['unreachable', 'throw']])
    await scenario('bedrockKey check | answer ' + label, PROVIDERS.bedrockKey, { answer }, () => engines.test());
  await scenario('bedrockKey check | region and pinned model', { ...PROVIDERS.bedrockKey, AWS_REGION: 'eu-west-1', ANTHROPIC_DEFAULT_SONNET_MODEL: 'pin-sonnet' }, { answer: 200 }, () => engines.test());
  // inputs the matrix holds constant: folders, effort, sub-agents, a read-only run with no file reading, a long system prompt
  const SYSTEM = 'You are Jade.\n\n## Rules\n- "Quote" and \'quote\', tab\there, unicode: é ü —\n- path ' + config.JADE_HOME + '/x\n';
  for (const pn of ['bedrockGateway', 'anthropicGateway']) {
    write({ ...PROVIDERS[pn], ...PINS.all }); fs.rmSync(MODELS, { force: true });
    await scenario(`inputs | ${pn} | edits, folder, effort, sub-agents, long system`, { ...PROVIDERS[pn], ...PINS.all }, {},
      () => engines.run({ prompt: 'hi', system: SYSTEM, connectors: ['web'], dirs: [dirA, path.join(tmp, 'missing')], model: 'opus', edits: true, job: 'j1', effort: 'high', subagents: '{"worker":{"description":"d","prompt":"p"}}' }));
    await scenario(`inputs | ${pn} | read-only, no file reading, no web`, { ...PROVIDERS[pn], ...PINS.all }, {}, () => engines.run({ prompt: 'hi', system: SYSTEM, connectors: [], dirs: [dirA], model: 'haiku', noRead: true, denyWeb: true, effort: 'low' }));
    await scenario(`inputs | ${pn} | chat with effort and folder`, { ...PROVIDERS[pn], ...PINS.all }, {},
      () => warm.turn('t-inputs', { connectors: [], dirs: [dirA], model: 'sonnet', system: SYSTEM, effort: 'xhigh', edits: false, subagents: '' }, { prompt: 'hi' }).then(() => warm.shutdown?.()));
  }
}
gateway.close();
// one run per line: readable in a diff without being huge
const sortedContents = Object.fromEntries(Object.entries(contents).sort(([a], [b]) => (a < b ? -1 : 1)));
fs.writeFileSync(out, `{\n"envs": ${JSON.stringify(result.envs, null, 1)},\n"fullEnvs": ${JSON.stringify(result.fullEnvs, null, 1)},\n"contents": ${JSON.stringify(sortedContents, null, 1)},\n"extras": ${JSON.stringify(result.extras, null, 1)},\n"runs": {\n${Object.entries(result.runs).map(([k, v]) => JSON.stringify(k) + ': ' + JSON.stringify(v)).join(',\n')}\n}\n}\n`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
