// Fixes from the final server review: the secret check survives an unreadable .state, a body with no length is cut off at the limit,
// one writer for every state file, no import cycle between redact and provider, `jade --stop` only stops Jade, and the chat move
// does not repeat itself.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-srvrev-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const files = await import('../server/core/files.js');
const util = await import('../server/core/util.js');
const { readBody } = await import('../server/core/body.js');
config.load(); store.init();
after(() => { files.stopWatching(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('isSecret and the file list keep working, and stay strict, when .state cannot be read', async () => {
  const state = path.join(config.JADE_HOME, '.state');
  fs.mkdirSync(state, { recursive: true }); fs.writeFileSync(path.join(state, 'token'), 'k'.repeat(30));
  const real = fs.statSync;
  fs.statSync = (p, ...r) => { if (String(p).startsWith(state) || String(p).endsWith('engine.env')) { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; } return real(p, ...r); };
  try {
    assert.equal(files.isSecret(path.join(state, 'token')), true, 'the key file is still secret');
    assert.equal(files.isSecret(state), true);
    assert.equal(files.isSecret(path.join(tmp, 'plain.txt')), false);
    assert.equal(files.allowed(path.join(state, 'token')), false, 'and is still refused');
    await assert.doesNotReject(() => files.list(), 'listing files does not fail');
  } finally { fs.statSync = real; }
});

test('a body with no length that goes over the limit is answered and then cut off', async () => {
  let result;
  const server = http.createServer(async (req, res) => {
    result = await readBody(req, 100, 300);
    res.writeHead(413); res.end('too big');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const sock = net.connect(port, '127.0.0.1');
  let got = '', closedAt = 0;
  const t0 = Date.now();
  sock.on('data', d => { got += d; });
  sock.on('close', () => { closedAt = Date.now() - t0; });
  sock.on('error', () => {});
  sock.write('POST /x HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n');
  sock.write('200\r\n' + 'a'.repeat(0x200) + '\r\n');   // 512 bytes: over the limit; the body then never ends
  const end = Date.now() + 4000;
  while (!closedAt && Date.now() < end) await new Promise(r => setTimeout(r, 25));
  sock.destroy(); await new Promise(r => server.close(r));
  assert.deepEqual(result, { over: true });
  assert.match(got, /^HTTP\/1\.1 413/, 'the 413 answer reached the client');
  assert.ok(closedAt > 0 && closedAt < 3000, 'the connection was cut off (after ' + closedAt + ' ms)');
});

test('one writer for state files: flushed, temp file removed on failure, and it says what it wrote', () => {
  const f = path.join(tmp, 'w', 'jobs.json');
  const st = util.writeText(f, '[1]');
  assert.equal(fs.readFileSync(f, 'utf8'), '[1]');
  assert.equal(st.size, 3);
  assert.equal(st.ino, fs.statSync(f).ino, 'the file number it reports is the one the saved file has');
  assert.throws(() => util.writeText(f, { not: 'text' }));
  assert.equal(fs.readFileSync(f, 'utf8'), '[1]', 'the old file is untouched by a failed save');
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['jobs.json'], 'no temporary file is left behind');
  const real = fs.fsyncSync; let synced = 0; fs.fsyncSync = (...a) => { synced++; return real(...a); };
  try { util.writeText(f, '[2]'); } finally { fs.fsyncSync = real; }
  assert.equal(synced, 1, 'flushed to disk before the rename');
});

test('the state files are all saved by that one writer (no second temp-and-rename copy in the server)', () => {
  const own = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|mjs)$/.test(e.name) && /renameSync\(tmp/.test(fs.readFileSync(p, 'utf8'))) own.push(path.relative(ROOT, p).split(path.sep).join('/')); } };
  walk(path.join(ROOT, 'server'));
  // util.js is the writer; transcripts.js (a streamed upload) names its own temp file as it receives bytes
  assert.deepEqual(own.filter(f => f !== 'server/core/util.js' && f !== 'server/core/transcripts.js'), [], 'these files carry their own writer: ' + own.join(', '));
});

test('redact.js and provider.js do not import each other, and still share one SECRET_NAME', async () => {
  const imports = f => [...fs.readFileSync(path.join(ROOT, 'server/core', f), 'utf8').matchAll(/from '\.\/([\w-]+\.js)'/g)].map(m => m[1]);
  const reach = (from, seen = new Set()) => { for (const i of imports(from)) if (!seen.has(i)) { seen.add(i); reach(i, seen); } return seen; };
  assert.ok(!reach('provider.js').has('provider.js'), 'provider.js does not lead back to itself');
  assert.ok(!reach('redact.js').has('redact.js'), 'redact.js does not lead back to itself');
  const a = await import('../server/core/redact.js'), b = await import('../server/core/secretname.js');
  assert.equal(a.SECRET_NAME, b.SECRET_NAME);
});

test('jade --stop leaves alone a process that is not Jade, even when the pid file names it', (t) => {
  if (process.platform === 'win32') return t.skip('the Unix launcher');
  const home = path.join(tmp, 'stophome'); fs.mkdirSync(path.join(home, '.state'), { recursive: true });
  const other = spawn('sleep', ['30'], { stdio: 'ignore' });
  try {
    fs.writeFileSync(path.join(home, '.state', 'jade.pid'), String(other.pid));
    const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'jade'), '--stop'], { env: { ...process.env, JADE_HOME: home, JADE_APP: ROOT }, encoding: 'utf8' });
    assert.match(r.stdout, /not running/);
    assert.doesNotThrow(() => process.kill(other.pid, 0), 'the other program is still there');
    assert.ok(!fs.existsSync(path.join(home, '.state', 'jade.pid')), 'the stale pid file is removed');
  } finally { try { process.kill(other.pid); } catch {} }
});

test('the single old chat file moved at a failed start is not moved a second time under another id', () => {
  const state = path.join(config.JADE_HOME, '.state');
  fs.mkdirSync(state, { recursive: true });
  const turns = [{ role: 'user', text: 'hello', at: '2026-01-01T00:00:00Z' }, { role: 'assistant', text: 'hi', at: '2026-01-01T00:00:01Z' }];
  const run = () => spawnSync(process.execPath, ['--input-type=module', '-e',
    `const s = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'server/core/store.js')).href)}); const c = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'server/core/config.js')).href)}); c.load(); s.init(); console.log(JSON.stringify(s.listThreads().map(t => t.id)));`],
    { env: { ...process.env, JADE_HOME: path.join(tmp, 'migrate'), JADE_CLAUDE_HOME: path.join(tmp, 'claude2') }, encoding: 'utf8' });
  const st = path.join(tmp, 'migrate', '.state'); fs.mkdirSync(st, { recursive: true });
  fs.writeFileSync(path.join(st, 'chat.json'), JSON.stringify({ turns }));
  const first = JSON.parse(run().stdout.trim().split('\n').pop());
  assert.equal(first.length, 1);
  // a start that was cut short before the old file was set aside: put it back and start again
  const moved = fs.readdirSync(st).find(n => n.startsWith('chat.json.migrated'));
  fs.renameSync(path.join(st, moved), path.join(st, 'chat.json'));
  const second = JSON.parse(run().stdout.trim().split('\n').pop());
  assert.deepEqual(second, first, 'still one conversation, with the same id');
});
