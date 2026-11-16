// The key is only given to a caller that already has it: the page without the cookie carries nothing, the start link sets the cookie,
// no file route serves the key file or engine.env, /api/engines says only that Jade is running, and the start line is printed once
// to the terminal and never written to a file. Each of these fails on the code before the key gate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { freePort, waitFor } from './helpers/server.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-keygate-'));
const HOME = path.join(tmp, 'home');
const free = freePort;
let child, PORT, KEY, out = '';
const env = extra => { const e = { ...process.env, JADE_HOME: HOME, JADE_CLAUDE_HOME: path.join(tmp, 'claude'), JADE_PORT: String(PORT), JADE_SHOW_LINK: '1', ...extra }; delete e.JADE_TOKEN; return e; };
const base = () => `http://127.0.0.1:${PORT}`;
const start = async () => {
  out = '';
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: env(), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  await waitFor(async () => (await fetch(base() + '/api/engines')).ok, { timeout: 12000, interval: 100, message: 'the server to start' });
};
const stop = () => new Promise(r => { if (!child || child.exitCode !== null) return r(); child.once('exit', r); child.kill(); });
before(async () => {
  PORT = await free();
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(path.join(HOME, 'engine.env'), 'ANTHROPIC_AUTH_TOKEN=do-not-leak-this\n');
  // a memory folder that is the data folder itself, so the index and the memory route could reach the secrets
  fs.writeFileSync(path.join(HOME, 'config.json'), JSON.stringify({ memory: { folders: [HOME], extensions: ['.md', '.env', '.txt', ''] } }));
  fs.writeFileSync(path.join(HOME, 'readme.md'), '# hello\nplain note');
  await start();
  KEY = fs.readFileSync(path.join(HOME, '.state', 'token'), 'utf8').trim();
});
after(async () => { await stop(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('the page without the cookie, or with a wrong key, carries no key and sets no cookie', async () => {
  for (const u of ['/', '/?key=nope', '/?key=' + KEY.slice(0, -1) + 'x', '/?key=', '/index.html', '/projects']) {
    const r = await fetch(base() + u, { redirect: 'manual' });
    const t = await r.text();
    assert.equal(r.status, 200, u);
    assert.ok(!t.includes(KEY), u + ' leaked the key');
    assert.ok(!/jade-token/.test(t), u);
    assert.equal(r.headers.get('set-cookie'), null, u + ' set a cookie');
    assert.match(t, /Jade is running/); assert.match(t, /name="key"/);
  }
  const wrong = await (await fetch(base() + '/?key=nope')).text(), none = await (await fetch(base() + '/')).text();
  assert.equal(wrong, none, 'a wrong key gets the same answer as no key');
});

test('the right key sets the cookie and answers with a page that moves on without the key in the address', async () => {
  const r = await fetch(base() + '/?key=' + KEY, { redirect: 'manual' });
  assert.equal(r.status, 200, 'not a redirect: a start link opened from a file would lose a SameSite=Strict cookie on one');
  assert.equal(r.headers.get('location'), null);
  const body = await r.text();
  assert.match(body, /http-equiv="refresh" content="0;url=\/"/);
  assert.ok(!body.includes(KEY) && !/<script/i.test(body));
  assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  const c = r.headers.get('set-cookie');
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Path=\//);
  const pasted = await fetch(base() + '/?key=' + encodeURIComponent(`http://127.0.0.1:${PORT}/?key=${KEY}`), { redirect: 'manual' });
  assert.equal(pasted.status, r.status, 'the whole link can be pasted into the box');
});

test('the page with the cookie carries the key; the cookie keeps working after a restart', async () => {
  const cookie = 'jade=' + KEY;
  const r = await fetch(base() + '/', { headers: { cookie } });
  assert.ok((await r.text()).includes(`<meta name="jade-token" content="${KEY}">`));
  await stop(); await start();
  assert.equal(fs.readFileSync(path.join(HOME, '.state', 'token'), 'utf8').trim(), KEY, 'the key file persists');
  assert.equal((await fetch(base() + '/api/projects', { headers: { cookie } })).status, 200, 'an open window keeps working');
});

test('pages outside /api that can carry data need the key', async () => {
  assert.equal((await fetch(base() + '/modules/x/views/a.json')).status, 401);
  const old = await fetch(base() + '/dashboards/p/d', { headers: { cookie: 'jade=' + KEY } });   // the raw dashboard page route is gone: this is only the app page
  assert.ok(!(await old.text()).includes('JADE_DATA'));
  assert.equal((await fetch(base() + '/js/app.js')).status, 200, 'scripts and styles stay open');
});

test('no file route returns or indexes the key file or engine.env, even with the key', async () => {
  const h = { 'x-jade': KEY };
  const enc = encodeURIComponent;
  for (const f of [path.join(HOME, '.state', 'token'), path.join(HOME, 'engine.env'), path.join(HOME, '.state', '..', 'engine.env'), path.join(HOME, '.state', 'open.html')]) {
    for (const route of ['/api/files/raw', '/api/files/text', '/api/memory/file']) {
      const r = await fetch(base() + route + '?path=' + enc(f), { headers: h });
      const t = await r.text();
      assert.ok(r.status >= 400, `${route} ${path.basename(f)} -> ${r.status}`);
      assert.ok(!t.includes(KEY) && !t.includes('do-not-leak-this'), route);
    }
  }
  // a link to the key file inside a reachable folder
  try { fs.symlinkSync(path.join(HOME, '.state', 'token'), path.join(HOME, 'link.txt')); } catch { /* no symlinks here */ }
  const r = await fetch(base() + '/api/files/raw?path=' + enc(path.join(HOME, 'link.txt')), { headers: h });
  assert.ok(r.status >= 400); assert.ok(!(await r.text()).includes(KEY));
  // the file list and the search index
  const list = await (await fetch(base() + '/api/files?limit=200', { headers: h })).text();
  assert.ok(!/engine\.env|\.state|[\\/]token/.test(list), 'the file list names no secret');
  assert.ok(list.includes('readme.md'), 'ordinary files are still listed');
  for (const q of ['do-not-leak-this', KEY, 'ANTHROPIC_AUTH_TOKEN']) {
    const s = await (await fetch(base() + '/api/search?q=' + enc(q), { headers: h })).text();
    assert.ok(!s.includes(KEY) && !s.includes('do-not-leak-this'), 'search for ' + q.slice(0, 8));
  }
});

test('/api/engines without the key says only that Jade is running; the key and files hold nothing more', async () => {
  const body = await (await fetch(base() + '/api/engines')).json();
  assert.deepEqual(body, { running: true });
  const full = await fetch(base() + '/api/engines', { headers: { 'x-jade': KEY } });
  assert.ok(!(await full.text()).includes(KEY));
  for (const u of ['/api/config', '/api/boot']) assert.ok(!(await (await fetch(base() + u, { headers: { 'x-jade': KEY } })).text()).includes(KEY), u + ' shows the key');
});

test('the start line is printed once, to the terminal only, and the key is in no file but its own', async () => {
  assert.equal(out.split(KEY).length - 1, 1, 'the key appears once in what the server printed');
  assert.match(out, new RegExp(`Open Jade: http://127\\.0\\.0\\.1:${PORT}/\\?key=${KEY}`));
  await stop();
  // without a terminal (a launcher's log) the link is not printed at all
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: env({ JADE_SHOW_LINK: '0' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let quiet = ''; child.stdout.on('data', d => { quiet += d; }); child.stderr.on('data', d => { quiet += d; });
  await waitFor(async () => (await fetch(base() + '/api/engines')).ok, { timeout: 12000, interval: 100, message: 'the server to start again' });
  assert.ok(!quiet.includes(KEY), 'no key when output is not a terminal');
  await stop();
  const found = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (!e.isSymbolicLink()) { try { if (fs.readFileSync(p, 'utf8').includes(KEY)) found.push(path.relative(tmp, p).split(path.sep).join('/')); } catch { /* unreadable */ } } } };
  walk(tmp);
  assert.deepEqual(found, ['home/.state/token'], 'the key is in no log or other file: ' + found.join(', '));
});
