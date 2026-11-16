// Pins what Jade hands Claude Code on a gateway or Amazon Bedrock: argv and env for a chat run, an agent run (read-only and
// with edits), a locked-down judge run and the connection check, over every provider mode, model pins, a discovered model
// list or none, and seven model choices. The gateway fixture was recorded from the ORIGINAL code (claude-ring-bridge, where
// nothing chosen was 'sonnet'), so it fails if the new code ever drifts from what is proven on Bedrock. The plain-login
// fixture is the designed behaviour: nothing chosen resolves to the model discovery found, or to no --model at all.
// Beyond argv it pins the CONTENTS of the files argv only names (tool settings, MCP config, system prompt), the whole environment the
// child gets (less a short documented list of machine-specific names), a parent environment already holding provider variables,
// the Bedrock-with-a-key connection check, and that a warm chat worker builds the same arguments as a cold start.
// How to read a failure and how to re-record: test/fixtures/README.md. Re-record only on purpose: node scripts/parity-harness.mjs <tree> <out.json> [--plan]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-parity-test-'));

// The record is made in SHARDS parts side by side (each part is its own process with its own folders and stand-in), then joined in
// order. What is recorded is the same as one long run; the wait is shorter. Each part gets 5 minutes, which is several times what
// a part takes on a busy machine.
const SHARDS = Math.max(1, Math.min(4, os.availableParallelism?.() || 2));
const LIMIT = (process.platform === 'win32' ? 8 : 5) * 60 * 1000;   // starting a .cmd stand-in is slower on Windows

function part(flag, k, n) {
  const out = path.join(tmp, `out${flag ? '-plan' : ''}-${k}.json`);
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [path.join(ROOT, 'scripts/parity-harness.mjs'), ROOT, out, `--shard=${k}/${n}`, ...(flag ? [flag] : [])],
      { env: { ...process.env, JADE_HOME: path.join(tmp, `jh${k}`), JADE_CLAUDE_HOME: path.join(tmp, `ch${k}`) }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { c.kill(); reject(new Error(`part ${k}/${n} took more than ${LIMIT / 1000} s`)); }, LIMIT);
    c.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(JSON.parse(fs.readFileSync(out, 'utf8'))) : reject(new Error(`part ${k}/${n} failed: ${err}`)); });
  });
}
async function record(flag) {
  const n = flag ? 1 : SHARDS;   // the plain-login record is small
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => part(flag, i + 1, n)));
  const all = k => Object.assign({}, ...parts.map(p => p[k]));
  return { envs: all('envs'), fullEnvs: all('fullEnvs'), contents: all('contents'), extras: all('extras'), runs: all('runs') };
}
const frozen = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures', f), 'utf8'));

// A run (or scenario) points at the text of each file the engine was handed by a hash; compare the text, so a failure shows the words that changed.
const withText = (rec, contents) => (rec.files ? { ...rec, files: Object.fromEntries(Object.entries(rec.files).map(([n, h]) => [n, contents[h]])) } : rec);

// Windows environment names ignore case, and cmd.exe adds PROMPT when it starts a .cmd shim: on win32 only, compare the whole
// environment with names folded to upper case (a lower-case and an upper-case copy of one name are one variable) and without PROMPT.
const foldEnv = env => {
  if (process.platform !== 'win32') return env;
  const out = {};
  for (const [k, v] of Object.entries(env)) if (k.toUpperCase() !== 'PROMPT') out[k.toUpperCase()] = v;
  return out;
};

function compare(now, want) {
  assert.deepEqual(Object.keys(now.envs), Object.keys(want.envs), 'same set-ups');
  for (const k of Object.keys(want.envs)) assert.deepEqual(now.envs[k], want.envs[k], `env for ${k}`);
  assert.deepEqual(Object.keys(now.fullEnvs), Object.keys(want.fullEnvs), 'same set-ups (whole environment)');
  for (const k of Object.keys(want.fullEnvs)) assert.deepEqual(foldEnv(now.fullEnvs[k]), foldEnv(want.fullEnvs[k]), `whole environment for ${k}`);
  assert.deepEqual(Object.keys(now.extras), Object.keys(want.extras), 'same extra scenarios');
  for (const k of Object.keys(want.extras)) assert.deepEqual(withText(now.extras[k], now.contents), withText(want.extras[k], want.contents), k);
  assert.deepEqual(Object.keys(now.runs), Object.keys(want.runs), 'same runs');
  for (const k of Object.keys(want.runs)) assert.deepEqual(withText(now.runs[k], now.contents), withText(want.runs[k], want.contents), k);
}

// A warm chat worker is started with the stream arguments added; apart from those it must be exactly what a cold start builds.
const STREAM = ['--input-format', 'stream-json'];
const unstream = argv => { const i = argv.indexOf(STREAM[0]); return i < 0 ? argv : [...argv.slice(0, i), ...argv.slice(i + 2)]; };
function warmMatchesCold(runs) {
  let n = 0;
  for (const k of Object.keys(runs)) {
    const m = / \| (chat|chatEdit) \| /.exec(k);
    if (!m) continue;
    const cold = runs[k.replace(m[0], m[1] === 'chat' ? ' | agent | ' : ' | agentEdit | ')];
    assert.ok(cold, `no cold run to compare with ${k}`);
    assert.deepEqual(unstream(runs[k].argv), cold.argv, `${k}: warm and cold arguments differ`);
    assert.ok(runs[k].argv.includes(STREAM[0]), `${k}: a warm worker streams its input`);
    // the same settings and system prompt text (the MCP config differs only in saying which thread or job asked)
    for (const f of ['settings', 'system']) assert.equal(runs[k].files?.[f], cold.files?.[f], `${k}: ${f} file differs`);
    assert.deepEqual(runs[k].env, cold.env, `${k}: environment differs`);
    n++;
  }
  assert.ok(n > 0);
}

test('gateway and Bedrock: argv, env and model mapping are exactly what the original code built', { timeout: LIMIT + 60000 }, async () => {
  const want = frozen('provider-parity-gateway.json');
  assert.ok(Object.keys(want.runs).length > 1000);
  const now = await record('');
  compare(now, want);
  warmMatchesCold(now.runs);

  // proxy and certificate variables of the parent reach the engine in every set-up
  for (const [k, env] of Object.entries(now.fullEnvs)) {
    for (const v of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE']) assert.ok(env[v], `${v} is passed to the engine (${k})`);
  }
  // a parent that already holds provider variables never redirects a run: only Jade's own choice applies
  const ambient = now.extras['ambient | bedrockGateway | agent'].fullEnv;
  assert.equal(ambient.AWS_BEARER_TOKEN_BEDROCK, 'bk-test');
  assert.equal(ambient.AWS_REGION, 'us-east-1');
  assert.equal(ambient.CLAUDE_CODE_USE_BEDROCK, '1');
  assert.equal(ambient.ANTHROPIC_BEDROCK_BASE_URL, '<GATEWAY>');
  for (const v of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'NODE_EXTRA_CA_CERTS', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'JADE_TOKEN'])
    assert.equal(ambient[v], undefined, `${v} from the parent does not reach the engine`);
  for (const [name, run] of Object.entries(now.extras)) if (name.startsWith('ambient |') && run.fullEnv) assert.equal(run.fullEnv.JADE_TOKEN, undefined, `${name}: the server key is never given to a run`);

  // the Bedrock-with-a-key connection check asks the real Amazon address in the documented shape (here answered by a stand-in)
  const check = now.runs['bedrockKey | none | empty | check | ""'];
  assert.ok(check, 'the Bedrock-with-a-key check is recorded');
  assert.match(check.requests[0], /^POST https:\/\/bedrock-runtime\.us-east-1\.amazonaws\.com\/model\/[^/]+\/invoke /);
  assert.equal(check.requestHeaders[0].authorization, 'Bearer bk-test');
  assert.equal(now.extras['bedrockKey check | answer 401'].check.ok, false);
  assert.equal(now.extras['bedrockKey check | answer 200'].check.ok, true);
});

test('plain login: nothing chosen resolves to the discovered model; every choice passes through', { timeout: LIMIT + 60000 }, async () => {
  const want = frozen('provider-parity-plan.json');
  const now = await record('--plan');
  compare(now, want);
  warmMatchesCold(now.runs);
  const arg = k => { const a = now.runs[k].argv; return a.includes('--model') ? a[a.indexOf('--model') + 1] : null; };
  assert.equal(arg('plan | none | empty | agent | ""'), null);
  assert.equal(arg('plan | none | discovered | agent | ""'), 'sonnet');
  assert.equal(arg('plan | none | empty | agent | "opus"'), 'opus');
});
