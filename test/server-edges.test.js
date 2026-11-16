// The server's edges, through the real server on a free port with a throw-away data folder: one guard for a switched-off module,
// secrets never listed or served, a failing file or request never takes the server down, a too-large body gets its 413 answer,
// and the launcher's pid file. No real `claude` is started (the server is never asked to run an agent here).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-edges-'));
const HOME = path.join(tmp, 'home');
const KEY = 'edge-key';
const free = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 100)); } };
const nodeOnlyPath = path.dirname(process.execPath);   // nothing here can start a real `claude`
let child, PORT, out = '';
const base = () => `http://127.0.0.1:${PORT}`;
const call = (method, url, body, headers = {}) => fetch(base() + url, { method, headers: { 'x-jade': KEY, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
const get = url => call('GET', url);
const alive = async () => { try { return (await get('/api/modules')).status === 200; } catch { return false; } };

before(async () => {
  PORT = await free();
  fs.mkdirSync(path.join(HOME, '.state'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.state', 'token'), KEY);
  fs.writeFileSync(path.join(HOME, 'engine.env'), 'ANTHROPIC_AUTH_TOKEN=do-not-leak-this\n');
  fs.writeFileSync(path.join(HOME, 'config.json'), JSON.stringify({ modules: { meetings: false, dashboards: false }, limits: { jsonBody: 2000 } }));
  // a user's module with only the two required fields, switched off by default, with routes, a view folder and a route that fails late
  fs.mkdirSync(path.join(HOME, 'modules', 'mine', 'views'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'modules', 'mine.js'), `export default { id: 'mine', name: 'Mine', defaultOff: true, init({ on }) {
    on('GET', '/api/mine', () => ({ hi: 1 }));
    on('POST', '/api/mine/raw', ({ res }) => { res.writeHead(200); res.end('raw'); }, { raw: true });
    on('GET', '/api/boom', ({ res }) => { setTimeout(() => { throw new Error('late failure'); }, 5); return new Promise(() => {}); });
    on('GET', '/api/reject', () => { Promise.reject(new Error('nobody waits for this')); return { ok: 1 }; });
  } };\n`);
  fs.writeFileSync(path.join(HOME, 'modules', 'mine', 'views', 'a.js'), 'export default 1;\n');
  fs.writeFileSync(path.join(HOME, 'modules', 'mine', 'views', 'a.json'), '{"a":1}');
  if (process.platform !== 'win32') fs.symlinkSync(path.join(HOME, '.state', 'token'), path.join(HOME, 'modules', 'mine', 'views', 'key.json'));
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PATH: nodeOnlyPath, JADE_HOME: HOME, JADE_CLAUDE_HOME: path.join(tmp, 'claude'), JADE_PORT: String(PORT), JADE_TOKEN: KEY }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  await until(alive, 20000);
});
after(async () => {
  if (child && child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('every route of a switched-off module answers the same way, whichever module it is', async () => {
  const answers = [];
  for (const [m, url, body] of [['GET', '/api/meetings'], ['GET', '/api/dashboards'], ['GET', '/api/dreams'], ['GET', '/api/routines'], ['GET', '/api/mine'],
    ['POST', '/api/projects/x/dashboards', {}], ['POST', '/api/meetings/x/rerun', {}], ['POST', '/api/dreams/run', {}], ['POST', '/api/voice/model', {}]]) {
    const r = await call(m, url, body);
    assert.equal(r.status, 403, `${m} ${url}`);
    answers.push(((await r.json()).error || '').replace(/^.*?(switched off)/, '$1'));
  }
  for (const a of answers) assert.match(a, /^switched off/, 'the answer names the module and says it is switched off');
  const names = answers.map(a => a); assert.equal(new Set(names).size, 1, 'the same wording for every module: ' + names[0]);
});

test('a raw route (an upload) of a switched-off module answers before the body is read', async () => {
  assert.equal((await call('POST', '/api/mine/raw')).status, 403);
  const r = await call('POST', '/api/meetings/upload?project=p&name=a.txt', null, { 'content-type': 'application/octet-stream' });
  assert.equal(r.status, 403);
});

test('switching the module on opens every route at once and switching it off closes them again', async () => {
  assert.equal((await call('POST', '/api/modules/mine', { enabled: true })).status, 200);
  assert.deepEqual(await (await get('/api/mine')).json(), { hi: 1 });
  assert.equal(await (await call('POST', '/api/mine/raw')).text(), 'raw');
  assert.equal((await get('/modules/mine/views/a.js')).status, 200);
  assert.equal((await call('POST', '/api/modules/mine', { enabled: false })).status, 200);
  assert.equal((await get('/api/mine')).status, 403);
  assert.equal((await get('/modules/mine/views/a.js')).status, 403, 'its view files are closed too');
});

test('set-up cannot be marked done through the general settings route', async () => {
  assert.equal((await call('POST', '/api/config', { setup: { done: true }, role: 'tester' })).status, 200);
  const c = await (await get('/api/config')).json();
  assert.equal(c.role, 'tester'); assert.equal(c.setup.done, false);
});

test('a user module that gives only an id and a name still loads, with the stated defaults', async () => {
  const m = (await (await get('/api/modules')).json()).find(x => x.id === 'mine');
  assert.ok(m); assert.equal(m.order, 500); assert.equal(m.icon, 'cpu'); assert.equal(m.desc, '');
});

test('a module view file that is a link to the secret key is not served; a plain one is', { skip: process.platform === 'win32' && 'not checked on Windows: a link needs rights an ordinary account lacks' }, async () => {
  await call('POST', '/api/modules/mine', { enabled: true });
  const r = await get('/modules/mine/views/key.json');
  assert.notEqual(r.status, 200); assert.ok(!(await r.text()).includes(KEY));
  assert.equal((await get('/modules/mine/views/a.json')).status, 200);
  await call('POST', '/api/modules/mine', { enabled: false });
});

test('the folder picker never lists or opens .state, and the data folder listing leaves it out', async () => {
  fs.mkdirSync(path.join(HOME, '.state', 'private-sub'), { recursive: true });
  fs.mkdirSync(path.join(HOME, 'visible'), { recursive: true });
  for (const p of [path.join(HOME, '.state'), path.join(HOME, '.state', 'private-sub')]) assert.equal((await get('/api/fs/dirs?hidden=1&path=' + encodeURIComponent(p))).status, 403, p);
  const r = await (await get('/api/fs/dirs?hidden=1&path=' + encodeURIComponent(HOME))).json();
  assert.ok(r.dirs.some(d => d.name === 'visible'));
  assert.ok(!r.dirs.some(d => d.name === '.state'), 'the secrets folder is not offered');
});

test('an unreadable file on a file route is answered, never a crash', { skip: (process.platform === 'win32' && 'not checked on Windows: chmod cannot make a file unreadable there') || (process.getuid && process.getuid() === 0) }, async () => {
  const f = path.join(HOME, 'locked.txt');
  fs.writeFileSync(f, 'x'); fs.chmodSync(f, 0);
  const r = await get('/api/files/raw?path=' + encodeURIComponent(f)).catch(() => null);
  assert.ok(r === null || r.status >= 200);
  if (r) await r.arrayBuffer().catch(() => {});
  assert.ok(await alive(), 'the server is still up');
  fs.chmodSync(f, 0o600);
});

test('a failure nobody was waiting for does not take the server down', async () => {
  await call('POST', '/api/modules/mine', { enabled: true });
  get('/api/boom').catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  assert.ok(await alive(), 'still answering after a late throw');
  assert.equal((await get('/api/reject')).status, 200);
  await new Promise(r => setTimeout(r, 200));
  assert.ok(await alive(), 'still answering after a rejected promise');
  assert.equal(child.exitCode, null);
  await call('POST', '/api/modules/mine', { enabled: false });
});

// A client that writes a body of n bytes (declared, or chunked) and reads the answer; resolves with the status, or the error that lost it.
const post = (n, declared) => new Promise(resolve => {
  const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/api/notes', headers: { 'x-jade': KEY, 'content-type': 'application/json', ...(declared ? { 'content-length': n } : {}) } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', e => resolve('error ' + e.code));
  const chunk = Buffer.alloc(16384, 97); let left = n;
  const pump = () => { while (left > 0) { const b = chunk.subarray(0, Math.min(left, chunk.length)); left -= b.length; if (!req.write(b)) return void req.once('drain', pump); } req.end(); };
  pump();
});
test('a JSON body over the limit gets its 413 answer every time, declared or not', async () => {
  for (let i = 0; i < 8; i++) {
    assert.equal(await post(3_000_000, true), 413, 'declared #' + i);
    assert.equal(await post(3_000_000, false), 413, 'chunked #' + i);
  }
  assert.ok(await alive());
});

test('the default port is written once for the server; the stand-alone scripts agree with it', async () => {
  const { DEFAULT_PORT } = await import('../server/core/config.js');
  assert.equal(typeof DEFAULT_PORT, 'number');
  const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of ['jade.js', 'server/index.js']) assert.ok(!/\b47\d\d\b/.test(rd(f)), f + ' has its own copy of the port');
  // files that cannot import config keep a copy on purpose; each must say the same number
  let seen = 0;
  for (const f of ['bridge/jade-bridge.mjs', 'server/mcp/approve.mjs', 'scripts/jade', 'scripts/jade.cmd']) {
    for (const m of rd(f).matchAll(/PORT\b[^\n]{0,40}?(?:\|\||:-|=)\s*["']?(\d{4})\b/g)) { seen++; assert.equal(Number(m[1]), DEFAULT_PORT, f); }
  }
  assert.ok(seen >= 4, 'the copies were found');
});

test('every setting the server reads has a default in config.js', async () => {
  const config = await import('../server/core/config.js');
  await import('../server/core/modules.js');   // a module brings its own defaults when it is found
  const missing = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) ? [path.join(d, e.name)] : []);
  for (const f of [...walk(path.join(ROOT, 'server')), path.join(ROOT, 'jade.js')]) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bconfig\.get\(\)((?:\??\.[A-Za-z]\w*)+)/g)) {
      const keys = m[1].split(/\??\./).filter(Boolean);
      if (/^(modules|connectors|schedules|skills|models)$/.test(keys[0]) && keys.length > 1) keys.length = 1;   // maps keyed by the user's own names
      let o = config.DEFAULTS, ok = true;
      for (const k of keys) { if (o && typeof o === 'object' && k in o) o = o[k]; else { ok = false; break; } }
      if (!ok && !/^(get|save|load)$/.test(keys[0])) missing.push(`${path.relative(ROOT, f)}: ${keys.join('.')}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('only claudesessions.js reads Claude Code session files', () => {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : /\.m?js$/.test(e.name) ? [path.join(d, e.name)] : []);
  // Jade's own logs are .jsonl too (skeptic's verdicts): what matters is who looks inside Claude Code's folder of conversations
  const users = walk(path.join(ROOT, 'server')).filter(f => /claudehome\.home\(\)[^;\n]*'projects'|\.jsonl/.test(fs.readFileSync(f, 'utf8')) && /cwd/.test(fs.readFileSync(f, 'utf8'))).map(f => path.basename(f));
  assert.deepEqual(users, ['claudesessions.js']);
});

test('a second launcher does not take over the first one\'s pid file, and --stop stops the first', { skip: process.platform === 'win32' && 'not checked on Windows: the launcher in question is the Unix script' }, async () => {
  const lhome = path.join(tmp, 'lhome'), lport = await free();
  const env = { ...process.env, PATH: process.env.PATH, JADE_HOME: lhome, JADE_CLAUDE_HOME: path.join(tmp, 'lclaude'), JADE_PORT: String(lport), JADE_APP: ROOT };
  delete env.JADE_TOKEN;
  const pidFile = path.join(lhome, '.state', 'jade.pid');
  const first = spawn(process.execPath, [path.join(ROOT, 'jade.js'), '--no-open'], { env, stdio: 'ignore' });
  try {
    await until(() => fs.existsSync(pidFile) && fetch(`http://127.0.0.1:${lport}/api/engines`).then(r => r.ok, () => false), 30000);
    assert.equal(fs.readFileSync(pidFile, 'utf8'), String(first.pid));
    const second = spawnSync(process.execPath, [path.join(ROOT, 'jade.js'), '--no-open'], { env, timeout: 8000, encoding: 'utf8' });
    assert.notEqual(second.status, 0, 'the second launcher gives up');
    assert.match(second.stdout + second.stderr, /already running/i);
    assert.equal(fs.readFileSync(pidFile, 'utf8'), String(first.pid), 'the pid file is still the first launcher\'s');
    const stop = spawnSync('bash', [path.join(ROOT, 'scripts', 'jade'), '--stop'], { env, timeout: 8000, encoding: 'utf8' });
    assert.match(stop.stdout, /Jade stopped/);
    await until(() => first.exitCode !== null || first.signalCode, 10000);
  } finally { if (first.exitCode === null && !first.signalCode) first.kill(); }
});
