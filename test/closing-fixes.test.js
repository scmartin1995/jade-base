// One shared set of folder watches, watches put in place without holding the server up, a change to one record read again
// only in its folder, dashboards that use the waited-for file list, chat search from text kept per chat, and a tool file per start.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { idleLag, attempts } from './helpers/timing.js';
import { removeDir } from './helpers/rm.js';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-closing-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const files = await import('../server/core/files.js');
const util = await import('../server/core/util.js');
const search = await import('../server/core/search.js');
const engines = await import('../server/core/engines.js');
const dashboards = await import('../server/core/dashboards.js');
config.load(); store.init();
after(() => files.stopWatching());

const linux = process.platform === 'linux';
const waitFor = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 20)); } return false; };
const watches = () => { let n = 0; for (const fd of fs.readdirSync('/proc/self/fd')) { try { if (fs.readlinkSync('/proc/self/fd/' + fd).includes('inotify')) n += (fs.readFileSync('/proc/self/fdinfo/' + fd, 'utf8').match(/^inotify wd:/gm) || []).length; } catch { /* closed meanwhile */ } } return n; };
const tree = (n) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-closing-tree-')); for (let i = 0; i < n; i++) fs.mkdirSync(path.join(d, 'a' + (i % 20), 'b' + i), { recursive: true }); return old(d); };
// folders that look old, so the "changed a moment ago" safety check of the file map does not re-read them
const old = d => { const t = Date.now() / 1000 - 3600; for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) old(path.join(d, e.name)); fs.utimesSync(d, t, t); return d; };

test('two parts watching one folder share one set of watches, each hears only what it cares about', { skip: !linux }, async () => {
  const d = tree(40);
  const before = watches();
  const a = [], b = [];
  let readyA = false;
  const stopA = util.watchShared(d, f => a.push(f), { skip: /(^|[\\/])skipA([\\/]|$)/, onReady: () => { readyA = true; } });
  await waitFor(() => readyA);   // every folder is watched (not just the first few): counting earlier made this test depend on how busy the machine was
  const one = watches() - before;
  const stopB = util.watchShared(d, f => b.push(f), { skip: /(^|[\\/])skipB([\\/]|$)/ });
  await new Promise(r => setTimeout(r, 300));
  assert.equal(watches() - before, one, 'the second part adds no watches of its own');
  fs.writeFileSync(path.join(d, 'a1', 'b1', 'x.txt'), 'x');
  assert.ok(await waitFor(() => a.length && b.length), 'both hear a change');
  fs.mkdirSync(path.join(d, 'skipA')); fs.mkdirSync(path.join(d, 'skipB'));
  await new Promise(r => setTimeout(r, 200));
  a.length = 0; b.length = 0;
  fs.writeFileSync(path.join(d, 'skipA', 'f'), 'x'); fs.writeFileSync(path.join(d, 'skipB', 'f'), 'x');
  await new Promise(r => setTimeout(r, 300));
  assert.ok(!a.some(f => f.startsWith('skipA')) && a.some(f => f.startsWith('skipB')), 'A is not told about its skipped folder');
  assert.ok(!b.some(f => f.startsWith('skipB')) && b.some(f => f.startsWith('skipA')), 'B is not told about its skipped folder');
  stopA(); stopB();
  assert.ok(await waitFor(() => watches() === before), 'all watches are closed when the last part leaves');
  removeDir(d);
});

test('putting watches on a big tree in place does not hold the server up, and says when it is done', { skip: !linux }, async () => {
  const d = tree(1500);
  let stop;
  await attempts(5, async () => {
    const lag = await idleLag();
    let ready = 0, longest = 0, last = Date.now();
    const tick = setInterval(() => { const now = Date.now(); longest = Math.max(longest, now - last); last = now; }, 5);
    const t0 = Date.now();
    const st = util.watchTree(d, () => {}, { maxDirs: 2000, onReady: () => ready++ });
    const returned = Date.now() - t0;
    try {
      assert.equal(ready, 0, 'not ready the moment it returns');
      assert.ok(await waitFor(() => ready === 1), 'ready is announced once all folders are watched');
    } finally { clearInterval(tick); }
    if (returned < 60 + 3 * lag && longest < 100 + 3 * lag) { stop = st; return true; }
    st(); await waitFor(() => watches() === 0).catch(() => {});
    return `returned after ${returned} ms, longest pause ${longest} ms (idle lag ${lag} ms)`;
  });
  const seen = []; stop();
  const stop2 = util.watchTree(d, f => seen.push(f), { maxDirs: 2000, onReady: () => {} });
  await waitFor(() => watches() > 1000);
  stop2();
  removeDir(d);
});

test('a file added before the watch was ready is still found (the map looks again when it is told)', { skip: !linux }, async () => {
  const proj = tree(30); fs.writeFileSync(path.join(proj, 'a0', 'first.md'), 'x');
  store.saveProject({ name: 'Early', folders: [proj] });
  const fresh = () => JSON.stringify(files.scan(true).map(f => [f.path, f.size, f.mtime]));
  await files.list();
  fs.writeFileSync(path.join(proj, 'a3', 'late.md'), 'x');   // inside the gap, or after it: either way it must show
  assert.ok(await waitFor(async () => (await files.list()).some(f => f.name === 'late.md')), 'the file is listed');
  assert.equal(JSON.stringify((await files.list()).map(f => [f.path, f.size, f.mtime])), fresh());
  files.stopWatching();
  removeDir(proj);
});

test('invalidate(path) marks only the folder the path is in; a new folder marks the nearest known one above it', async () => {
  const proj = tree(10);
  store.saveProject({ name: 'One folder', folders: [proj] });
  await files.list();
  const real = fs.readdirSync; let read = new Set();
  fs.readdirSync = (...x) => { if (String(x[0]).startsWith(proj)) read.add(String(x[0])); return real(...x); };
  try {
    // Where the watch is put in place after the first read (everywhere but Linux's one-by-one watches), the map looks once more at what
    // changed meanwhile, and on Windows that look reads every folder. Let it settle first: ask until a round reads nothing.
    for (let i = 0; i < 20; i++) { read = new Set(); await new Promise(r => setTimeout(r, 100)); await files.list(); if (!read.size) break; }
    read = new Set();
    const f = path.join(proj, 'a2', 'b2', 'record.md'); fs.writeFileSync(f, 'x');
    files.invalidate(f);
    assert.ok((await files.list()).some(x => x.path === f));
    assert.deepEqual([...read], [path.join(proj, 'a2', 'b2')], 'only that folder was read');
    read = new Set();
    const g = path.join(proj, 'a2', 'brand-new', 'deeper', 'record.md'); fs.mkdirSync(path.dirname(g), { recursive: true }); fs.writeFileSync(g, 'x');
    files.invalidate(g);
    assert.ok((await files.list()).some(x => x.path === g), 'a file in a new folder is found');
    assert.ok(![...read].some(r => r === path.join(proj, 'a3')), 'folders elsewhere were not read');
  } finally { fs.readdirSync = real; }
  const mine = l => JSON.stringify(l.filter(f => f.path.startsWith(proj)).map(f => f.path));
  assert.equal(mine(await files.list()), mine(files.scan(true)));
  files.stopWatching();
});

test('dashboard answers worked out from a given file list equal those worked out from a scan', async () => {
  const proj = tree(3); fs.writeFileSync(path.join(proj, 'team-dashboard.html'), '<html><body>x</body></html>'); fs.writeFileSync(path.join(proj, 'a0', 'plan.md'), 'plan');
  const p = store.saveProject({ name: 'Dash', folders: [proj] });
  const list = await files.list();
  assert.deepEqual(dashboards.exemplars(p.id, list), dashboards.exemplars(p.id));
  assert.deepEqual(dashboards.questionOptions(p.id, list), dashboards.questionOptions(p.id));
  const a = dashboards.collect(p.id, list), b = dashboards.collect(p.id);
  assert.deepEqual(a.sources, b.sources);
  assert.ok(dashboards.exemplars(p.id, list).some(e => e.name === 'team-dashboard.html'));
  files.stopWatching();
});

test('chat search reads the text kept for each chat: no chat file is read again, and the answers are the same', async () => {
  const ids = [];
  for (let i = 0; i < 80; i++) { const id = 'k' + i; ids.push(id); store.appendTurn(id, { role: 'user', text: `chat ${i} about ${i % 7 === 0 ? 'zebracrossing' : 'plain things'}` }); store.appendTurn(id, { role: 'jade', text: 'ok ' + i }); }
  const q = 'zebracrossing';
  await search.searchAsync('nothing matches this', { kinds: ['chat'], limit: 60 });   // looks through every chat once
  const first = await search.searchAsync(q, { kinds: ['chat'], limit: 60 });
  assert.ok(first.length >= 1);
  const real = fs.readFileSync; let chatReads = 0;
  fs.readFileSync = (...x) => { if (String(x[0]).includes(path.join('.state', 'chats'))) chatReads++; return real(...x); };
  try {
    const second = await search.searchAsync('nothing matches this', { kinds: ['chat'], limit: 60 });
    assert.equal(second.length, 0);
    assert.equal(chatReads, 0, 'a search that matches no chat reads no chat file');
    const again = await search.searchAsync(q, { kinds: ['chat'], limit: 60 });
    assert.deepEqual(again.map(r => r.path), first.map(r => r.path));
  } finally { fs.readFileSync = real; }
  for (const id of ids.slice(0, 5)) { const t = store.getThread(id); assert.equal(store.chatSearchText(id), (t.title + '\n' + t.turns.map(x => x.text || '').join('\n')).toLowerCase()); }
  store.appendTurn('k3', { role: 'user', text: 'now it says quokka' });
  assert.ok(store.chatSearchText('k3').includes('quokka'), 'a save discards the old text');
  assert.equal(store.chatSearchText('no-such-chat'), null);
});

test('each start has its own tool file name, so the clean-up of an old worker cannot remove a new worker\'s file', () => {
  const a = engines.claudeArgs({ edits: true, job: 'j1' }), b = engines.claudeArgs({ edits: true, job: 'j1' });
  const fa = a[a.indexOf('--mcp-config') + 1], fb = b[b.indexOf('--mcp-config') + 1];
  assert.notEqual(fa, fb);
  assert.match(path.basename(fa), /^mcp-jade-j1-s[0-9a-f]{8}\.json$/);
  a.cleanup();
  return waitFor(() => !fs.existsSync(fa)).then(ok => { assert.ok(ok); assert.ok(fs.existsSync(fb), 'the newer file is still there'); b.cleanup(); });
});

test('the unused checker model default is gone from the settings', () => {
  assert.equal('skeptic' in config.get(), false);
});
