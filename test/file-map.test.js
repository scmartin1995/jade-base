// The file map, the file ring and search: the remembered answer is exactly what a fresh walk gives (also after a file is added,
// changed, renamed and deleted), a walk of a big folder never holds up other work, only one walk runs at a time, and
// search stays bounded.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { idleLag } from './helpers/timing.js';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-filemap-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const files = await import('../server/core/files.js');
const outputs = await import('../server/core/outputs.js');
const search = await import('../server/core/search.js');
config.load(); store.init();
after(() => files.stopWatching());

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-filemap-proj-'));
const put = (rel, text = 'x') => { const p = path.join(proj, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
for (let d = 0; d < 30; d++) for (let i = 0; i < 100; i++) put(`area-${d}/file-${i}.${['md', 'docx', 'pdf', 'xlsx'][i % 4]}`);
put('Deliverables/budget-review.docx'); put('Deliverables/plan.pdf'); put('notes/budget draft.md');
store.saveProject({ name: 'Atlas', folders: [proj] });

const countDirs = d => 1 + fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).reduce((n, e) => n + countDirs(path.join(d, e.name)), 0);
const normal = list => JSON.stringify(list.map(f => [f.path, f.size, f.mtime, f.project, f.kind]));
const waitFor = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 20)); } return false; };
/** What a walk made from nothing says (the old behaviour: scan(true) walks everything again). */
const fresh = () => normal(files.scan(true));

test('list() equals a fresh walk, and a second call reads nothing again', async () => {
  const a = await files.list();
  assert.equal(normal(a), fresh());
  const real = fs.readdirSync; let reads = 0;
  fs.readdirSync = (...x) => { if (String(x[0]).startsWith(proj)) reads++; return real(...x); };
  try { await files.list(); await files.list(); } finally { fs.readdirSync = real; }
  assert.equal(reads, 0, 'a remembered list is returned without touching the disk');
});

test('after a file is added, changed, renamed and deleted the answer is the fresh walk', async () => {
  await files.list();
  const check = async what => assert.equal(normal(await files.list()), fresh(), what);
  put('area-1/new-file.md'); files.invalidate(); await check('added');
  const f = put('area-1/new-file.md', 'longer text than before'); files.invalidate(); await check('changed');
  fs.renameSync(f, path.join(proj, 'area-1', 'renamed.md')); files.invalidate(); await check('renamed');
  fs.rmSync(path.join(proj, 'area-1', 'renamed.md')); files.invalidate(); await check('deleted');
  assert.ok(!(await files.list()).some(x => x.name === 'renamed.md'));
});

test('a change on disk is noticed by the watcher, with no invalidate and no clock', async (t) => {
  if (process.platform === 'win32') return t.skip('watching differs on Windows');
  await files.list();   // starts watching
  await files.list();
  put('area-2/appeared.md');
  assert.ok(await waitFor(async () => (await files.list()).some(x => x.name === 'appeared.md')), 'the new file is listed');
  fs.rmSync(path.join(proj, 'area-2', 'appeared.md'));
  assert.ok(await waitFor(async () => !(await files.list()).some(x => x.name === 'appeared.md')), 'the removed file is gone');
  assert.equal(normal(await files.list()), fresh());
});

test('a change inside one folder reads only that folder, and the answer still equals a fresh walk', async (t) => {
  if (process.platform === 'win32') return t.skip('watching differs on Windows');
  await files.list(); await files.list();
  const real = fs.readdirSync; let read = [];
  fs.readdirSync = (...x) => { if (String(x[0]).startsWith(proj)) read.push(String(x[0])); return real(...x); };
  try {
    put('area-3/only-this.md');
    assert.ok(await waitFor(async () => (await files.list()).some(x => x.name === 'only-this.md')));
    assert.deepEqual([...new Set(read)], [path.join(proj, 'area-3')], 'one folder of 33 was read');
  } finally { fs.readdirSync = real; }
  assert.equal(normal(await files.list()), fresh());
});

test('folders added, renamed and removed are followed, and the answer equals a fresh walk each time', async (t) => {
  if (process.platform === 'win32') return t.skip('watching differs on Windows');
  await files.list(); await files.list();
  const same = async (what, until) => {
    assert.ok(await waitFor(async () => until(await files.list())), what + ': noticed');
    const got = normal(await files.list());
    assert.equal(got, fresh(), what);
  };
  put('fresh-folder/deep/deeper/a.md'); put('fresh-folder/b.md');
  await same('a new folder with sub-folders', l => l.some(x => x.name === 'a.md'));
  fs.renameSync(path.join(proj, 'fresh-folder'), path.join(proj, 'renamed-folder'));
  await same('a renamed folder', l => l.some(x => x.rel.startsWith('renamed-folder')) && !l.some(x => x.rel.startsWith('fresh-folder')));
  fs.rmSync(path.join(proj, 'renamed-folder'), { recursive: true });
  await same('a removed folder', l => !l.some(x => x.rel.startsWith('renamed-folder')));
  fs.rmSync(path.join(proj, 'area-4', 'file-0.md'));
  await same('a removed file', l => !l.some(x => x.rel === path.join('area-4', 'file-0.md')));
});

test('a folder that cannot be watched is checked by its own modified time, not walked again', async () => {
  files.stopWatching();
  const saved = { ...files.timing }; files.timing.unwatched = 0;   // every call checks (the real wait is a minute)
  try {
    await files.list();
    const real = fs.readdirSync; let read = [];
    fs.readdirSync = (...x) => { if (String(x[0]).startsWith(proj)) read.push(String(x[0])); return real(...x); };
    try {
      await new Promise(r => setTimeout(r, 2100));   // past the "changed just before it was read" margin
      await files.list(); read = [];
      put('area-6/no-watcher.md');
      const got = await files.list();
      assert.ok(got.some(x => x.name === 'no-watcher.md'), 'the new file is listed');
      assert.deepEqual([...new Set(read)], [path.join(proj, 'area-6')], 'only the changed folder was read');
      fs.rmSync(path.join(proj, 'area-7'), { recursive: true });
      const after = await files.list();
      assert.ok(!after.some(x => x.rel.startsWith('area-7')), 'a removed folder is gone');
      assert.equal(normal(after), fresh());
    } finally { fs.readdirSync = real; }
  } finally { Object.assign(files.timing, saved); }
});

test('a folder cut off at the limit: adding and changing stay incremental and exact, removing is read in full', async (t) => {
  if (process.platform === 'win32') return t.skip('watching differs on Windows');
  const big = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-filemap-big-'));
  for (let d = 0; d < 21; d++) { fs.mkdirSync(path.join(big, 'd' + d)); for (let i = 0; i < 1000; i++) fs.writeFileSync(path.join(big, 'd' + d, `f${i}.txt`), 'x'); }   // 21,000 files: past the limit
  const hourAgo = Date.now() / 1000 - 3600; for (const d of [big, ...fs.readdirSync(big).map(n => path.join(big, n))]) fs.utimesSync(d, hourAgo, hourAgo);   // old folders: the "changed a moment ago" check would otherwise re-read them all once
  store.saveProject({ name: 'Big', folders: [big] });
  files.invalidate();   // the data folder just got the new project's file; do not wait for the system to say so (macOS may report it late), read the folders in full
  try {
    const first = await files.list();
    assert.ok(first.filter(f => f.rel.startsWith('d')).length === 20000, 'cut at 20,000');
    await files.list();
    const real = fs.readdirSync; let read = [];
    fs.readdirSync = (...x) => { if (String(x[0]).startsWith(big)) read.push(String(x[0])); return real(...x); };
    try {
      fs.writeFileSync(path.join(big, 'd0', 'added.txt'), 'y');
      assert.ok(await waitFor(async () => (await files.list()).some(x => x.name === 'added.txt')));
      assert.deepEqual([...new Set(read)], [path.join(big, 'd0')], 'adding read one folder');
      read = [];
      fs.rmSync(path.join(big, 'd1', 'f5.txt')); fs.rmSync(path.join(big, 'd1', 'f6.txt'));   // the added file made up for one; two leave the list short of the limit
      assert.ok(await waitFor(async () => !(await files.list()).some(x => x.path === path.join(big, 'd1', 'f6.txt'))));
      assert.ok(read.length > 20, 'removing read the whole folder again');
    } finally { fs.readdirSync = real; }
    const got = normal(await files.list());
    assert.equal(got, fresh());
  } finally { store.deleteProject?.(store.listProjects().find(p => p.name === 'Big')?.id); fs.rmSync(big, { recursive: true, force: true }); }
});

test('a caller that cannot wait (scan) during a walk gets the full right answer', async () => {
  files.invalidate();
  const slow = files.list();
  put('area-5/while-walking.md');
  const now = files.scan();   // blocks, and must include the file
  assert.ok(now.some(x => x.name === 'while-walking.md'));
  await slow;
  assert.equal(normal(await files.list()), fresh());
});

test('only one walk runs at a time: callers that arrive meanwhile wait for it', async () => {
  files.invalidate();
  const folders = countDirs(proj);
  const real = fs.readdirSync; let reads = 0;
  fs.readdirSync = (...x) => { if (String(x[0]).startsWith(proj)) reads++; return real(...x); };
  try { const rs = await Promise.all([files.list(), files.list(), files.searchAsync('budget'), outputs.listOutputsAsync()]); assert.equal(rs[0], rs[1]); } finally { fs.readdirSync = real; }
  assert.equal(reads, folders, 'every folder of the project was read once for four callers');
});

test('a walk never holds up the server for long (it works in slices)', async () => {
  files.invalidate();
  const lag = await idleLag();
  let worst = 0, last = Date.now();
  const tick = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last); last = n; }, 2);
  const t0 = Date.now();
  await files.list();
  const took = Date.now() - t0;
  clearInterval(tick);
  assert.ok(worst < 120 + 3 * lag, `the longest pause was ${worst} ms over a ${took} ms walk`);
});

test('search and the ring: the async answers equal the sync ones', async () => {
  store.appendTurn('c1', { role: 'user', text: 'About the budget review deadline' });
  assert.equal(JSON.stringify(await files.searchAsync('budget')), JSON.stringify(files.search('budget')));
  assert.equal(JSON.stringify(await files.searchAsync('')), JSON.stringify(files.search('')));
  assert.equal(JSON.stringify(await outputs.listOutputsAsync({ limit: 5000 })), JSON.stringify(outputs.listOutputs({ limit: 5000 })));
  const a = await search.searchAsync('budget review'), b = search.search('budget review');
  assert.ok(a.length >= 2, 'a file and a chat');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('the ring: worked out once, rebuilt when the files, a correction or the rules change', async () => {
  const all = await outputs.listOutputsAsync({ limit: 5000 });
  assert.ok(all.some(o => o.name === 'budget-review.docx'));
  // against the same machine now: working the list out from scratch, then asking again for the remembered one
  files.invalidate();
  let t0 = performance.now(); await outputs.listOutputsAsync({ limit: 5000 }); const cold = performance.now() - t0;
  t0 = performance.now();
  for (let i = 0; i < 20; i++) await outputs.listOutputsAsync({ limit: 5000 });
  const warm = (performance.now() - t0) / 20;
  assert.ok(warm < cold / 3 + 2, `a call on a remembered list (${warm.toFixed(2)} ms) is far cheaper than working it out (${cold.toFixed(2)} ms)`);
  put('Deliverables/second.pptx'); files.invalidate();
  assert.ok((await outputs.listOutputsAsync({ limit: 5000 })).some(o => o.name === 'second.pptx'), 'a new file');
  const key = (await outputs.listOutputsAsync({ limit: 5000 })).find(o => o.name === 'plan.pdf').key;
  outputs.setOverride(key, 'not-output');
  assert.ok(!(await outputs.listOutputsAsync({ limit: 5000 })).some(o => o.name === 'plan.pdf'), 'a correction');
  assert.equal(JSON.stringify(await outputs.listOutputsAsync({ limit: 5000 })), JSON.stringify(outputs.listOutputs({ limit: 5000 })));
});

test('the ring after a change seen by the watcher equals one worked out from nothing', async (t) => {
  if (process.platform === 'win32') return t.skip('watching differs on Windows');
  await outputs.listOutputsAsync({ limit: 5000 });
  put('Deliverables/third.docx'); put('Deliverables/quarterly/index.md'); fs.rmSync(path.join(proj, 'Deliverables', 'plan.pdf'), { force: true });
  assert.ok(await waitFor(async () => (await outputs.listOutputsAsync({ limit: 5000 })).some(o => o.name === 'third.docx')));
  const incremental = JSON.stringify(await outputs.listOutputsAsync({ limit: 5000 }));
  files.scan(true);   // every file entry is made anew, so nothing is reused
  assert.equal(incremental, JSON.stringify(outputs.listOutputs({ limit: 5000 })));
});

test('chat search is capped: a few results, from the newest chats', async () => {
  for (let i = 0; i < 12; i++) store.appendTurn('talk-' + i, { role: 'user', text: 'the budget review again ' + i });
  const r = await search.searchAsync('budget review', { kinds: ['chat'], limit: 60 });
  assert.ok(r.length >= 1 && r.length <= 6, 'at most six chats are shown: ' + r.length);
  assert.ok(r.every(x => x.kind === 'chat'));
});
