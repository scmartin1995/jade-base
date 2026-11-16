// The server key must not be readable by a run: the per-run tool settings hold no key, sit in an owner-only folder outside the free
// `.state/tmp`, are removed when the run ends (and old ones at start), and the approval tool still reaches the server by reading
// the key file itself. Everything goes through the real seams: a real server, the real approve.mjs over stdio, claudeArgs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { removeDir } from './helpers/rm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const posix = process.platform !== 'win32';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-runsecrets-'));
const HOME = path.join(tmp, 'home'), STATE = path.join(HOME, '.state');
const free = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const mode = f => fs.statSync(f).mode & 0o777;
const env = extra => { const e = { ...process.env, JADE_HOME: HOME, JADE_CLAUDE_HOME: path.join(tmp, 'claude'), JADE_PORT: String(PORT), ...extra }; delete e.JADE_TOKEN; return e; };
const base = () => `http://127.0.0.1:${PORT}`;
let server, PORT, KEY;

before(async () => {
  PORT = await free();
  fs.mkdirSync(HOME, { recursive: true });
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: env(), stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base() + '/api/engines')).ok) break; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 100)); }
  KEY = fs.readFileSync(path.join(STATE, 'token'), 'utf8').trim();
});
// Stop the server first, then remove its folder: removing it while the server still writes there now and then failed (the folder was not
// empty), the hook ended before the server was stopped, and the test run never finished.
after(() => new Promise(r => { const done = () => { removeDir(tmp); r(); }; if (server.exitCode !== null) return done(); server.once('exit', done); server.kill(); }));

const ask = (headers, tool, input) => fetch(base() + '/api/permissions/ask', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ job: 'j', tool, input }) });
const workFile = () => path.join(HOME, 'work', 'scratch.txt');

test('POST /api/permissions/ask is refused without the key and answered with it', async () => {
  assert.equal((await ask({}, 'Write', { file_path: workFile() })).status, 403);
  assert.equal((await ask({ 'x-jade': 'wrong' }, 'Write', { file_path: workFile() })).status, 403);
  const r = await ask({ 'x-jade': KEY }, 'Write', { file_path: workFile() });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).behavior, 'allow');
});

test('the state folder and its key file are owner-only', { skip: !posix }, () => {
  assert.equal(mode(STATE), 0o700);
  assert.equal(mode(path.join(STATE, 'token')), 0o600);
});

// Speak MCP to the real approve.mjs the way Claude Code does.
async function viaApprove(envExtra, tool, input) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'mcp', 'approve.mjs')], { env: { PATH: process.env.PATH, JADE_PORT: String(PORT), JADE_JOB: 'j', ...envExtra }, stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  try {
    const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    const next = async () => JSON.parse((await lines.next()).value);
    send(1, 'initialize', { protocolVersion: '2024-11-05' }); assert.equal((await next()).result.serverInfo.name, 'jade');
    send(2, 'tools/list'); assert.equal((await next()).result.tools[0].name, 'approve');
    send(3, 'tools/call', { name: 'approve', arguments: { tool_name: tool, input } });
    return JSON.parse((await next()).result.content[0].text);
  } finally { child.kill(); }
}

test('approve.mjs gets the key from the state folder (not its settings) and the server answers allow or deny', async () => {
  const ok = await viaApprove({ JADE_STATE: STATE }, 'Write', { file_path: workFile() });
  assert.equal(ok.behavior, 'allow');
  // in "read" mode nothing may be changed, so the answer is a plain no that comes straight back
  const m = await fetch(base() + '/api/permissions/mode', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jade': KEY }, body: JSON.stringify({ mode: 'read' }) });
  assert.equal(m.status, 200);
  const no = await viaApprove({ JADE_STATE: STATE }, 'Write', { file_path: path.join(HOME, 'notes.md') });
  assert.equal(no.behavior, 'deny');
  assert.ok(no.message);
});

test('approve.mjs with no way to find the key is refused by the server and says so', async () => {
  const r = await viaApprove({ JADE_STATE: path.join(tmp, 'nowhere') }, 'Write', { file_path: workFile() });
  assert.equal(r.behavior, 'deny');
});

// claudeArgs in a fresh process, so the once-per-start clean-up can be seen.
test('a run\'s tool settings hold no key, are owner-only outside .state/tmp, and go when the run ends; old ones go at start', { skip: !posix }, () => {
  const home = path.join(tmp, 'home2'), st = path.join(home, '.state');
  fs.mkdirSync(path.join(st, 'tmp'), { recursive: true }); fs.mkdirSync(path.join(st, 'run'), { recursive: true });
  fs.writeFileSync(path.join(st, 'tmp', 'mcp-jade-old.json'), '{"JADE_TOKEN":"leaked"}');
  fs.writeFileSync(path.join(st, 'run', 'mcp-jade-crashed.json'), '{}');
  const script = `
    const { claudeArgs } = await import(${JSON.stringify(path.join(ROOT, 'server/core/engines.js'))});
    const a = claudeArgs({ edits: true, job: 'j9' });
    const f = a[a.indexOf('--mcp-config') + 1];
    const r = { f, text: (await import('node:fs')).readFileSync(f, 'utf8'), a };
    a.cleanup(); await new Promise(r => setTimeout(r, 200));
    r.stillThere = (await import('node:fs')).existsSync(f);
    console.log(JSON.stringify({ f: r.f, text: r.text, stillThere: r.stillThere }));`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...env(), JADE_HOME: home, JADE_TOKEN: 'k'.repeat(40) }, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const r = JSON.parse(out.stdout.trim().split('\n').pop());
  assert.ok(r.f.startsWith(path.join(st, 'run') + path.sep), 'not in the free tmp folder');
  assert.ok(!r.text.includes('k'.repeat(40)) && !/JADE_TOKEN/.test(r.text), 'the key is not in the settings');
  assert.equal(JSON.parse(r.text).mcpServers.jade.env.JADE_STATE, st);
  assert.equal(r.stillThere, false, 'removed when the run ends');
  assert.equal(fs.existsSync(path.join(st, 'tmp', 'mcp-jade-old.json')), false, 'an old file that held the key is removed');
  assert.equal(fs.existsSync(path.join(st, 'run', 'mcp-jade-crashed.json')), false, 'a file left by a crashed run is removed');
  assert.equal(mode(st), 0o700); assert.equal(mode(path.join(st, 'run')), 0o700); assert.equal(mode(path.join(st, 'tmp')), 0o700);
  assert.equal(fs.readFileSync(path.join(st, 'token'), 'utf8'), 'k'.repeat(40), 'the tool can read the key in use from the file');
  assert.equal(mode(path.join(st, 'token')), 0o600);
});

test('the settings file is owner-only too while it exists', { skip: !posix }, () => {
  const home = path.join(tmp, 'home3');
  const script = `const { claudeArgs } = await import(${JSON.stringify(path.join(ROOT, 'server/core/engines.js'))});
    const a = claudeArgs({ edits: true, job: 'j1' }); console.log(a[a.indexOf('--mcp-config') + 1]);`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...env(), JADE_HOME: home }, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(mode(out.stdout.trim()), 0o600);
});
