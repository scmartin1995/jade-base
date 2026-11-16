// The remembered file list must never be staler than a fresh walk would say: folders that are deleted and made again, a watch that
// could not be put in place, and a few hundred random changes in a row. The truth is worked out here by a separate walk, never by
// asking the file map to walk again (that would repair the very thing being tested).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-fmrand-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const files = await import('../server/core/files.js');
config.load(); store.init();
const savedTiming = { ...files.timing };
after(() => { Object.assign(files.timing, savedTiming); files.stopWatching(); });

const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 25)); } return false; };
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
};
const mine = (list, proj) => list.filter(f => f.path.startsWith(proj + path.sep)).map(f => f.path).sort();
const truth = proj => walk(proj).sort();
const mkproj = name => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), name));
  store.saveProject({ name: path.basename(proj), folders: [proj] });
  return proj;
};
const put = (p, text = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const agrees = async (proj, ms) => waitFor(async () => JSON.stringify(mine(await files.list(), proj)) === JSON.stringify(truth(proj)), ms);
const show = async proj => `listed ${JSON.stringify(mine(await files.list(), proj).map(p => path.relative(proj, p)))}\n   on disk ${JSON.stringify(truth(proj).map(p => path.relative(proj, p)))}`;

test('a watched folder that is deleted and made again is watched again', async (t) => {
  if (process.platform === 'win32') return t.skip('watching differs on Windows');
  const proj = mkproj('jade-fmrand-a-');
  put(path.join(proj, 'sub', 'old.txt')); put(path.join(proj, 'top.txt'));
  await files.list(); await files.list();
  assert.ok(await agrees(proj, 3000), 'first list');
  fs.rmSync(path.join(proj, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'sub'));
  put(path.join(proj, 'sub', 'new1.txt'));
  assert.ok(await agrees(proj, 4000), 'the folder made again is listed\n   ' + await show(proj));
  put(path.join(proj, 'sub', 'new2.txt'));   // a file made later in it must be noticed too (the old watch was dead)
  assert.ok(await agrees(proj, 4000), 'a later file in the folder made again is listed\n   ' + await show(proj));
});

test('a watch that could not be put in place makes the list fall back to checking (never stale for long)', async (t) => {
  if (process.platform === 'win32') return t.skip('watching differs on Windows');
  const proj = mkproj('jade-fmrand-b-');
  put(path.join(proj, 'ok', 'a.txt')); put(path.join(proj, 'nowatch', 'old.txt'));
  const real = fs.watch;
  fs.watch = (p, ...rest) => { if (String(p).endsWith(path.join(proj, 'nowatch'))) { const e = new Error('no space'); e.code = 'ENOSPC'; throw e; } return real(p, ...rest); };
  files.stopWatching(); files.invalidate();
  Object.assign(files.timing, { unwatched: 100, unwatchedFull: 100 });   // so the map reads itself in full soon after the watch is ready
  try {
    const until = Date.now() + 900;
    while (Date.now() < until) { await files.list(); await new Promise(r => setTimeout(r, 50)); }
    Object.assign(files.timing, { unwatched: 300, unwatchedFull: 600 });   // the checking interval; watched lists are still believed for ten minutes
    put(path.join(proj, 'nowatch', 'later.txt'));
    assert.ok(await agrees(proj, 5000), 'a file in the unwatched folder is found by checking\n   ' + await show(proj));
  } finally { fs.watch = real; Object.assign(files.timing, savedTiming); }
});

test('a few hundred random changes leave the remembered list equal to the disk', async (t) => {
  if (process.platform === 'win32') return t.skip('watching differs on Windows');
  const seed = Number(process.env.FILE_MAP_SEED) || (Date.now() % 100000);
  let x = seed; const rnd = n => { x = (x * 1103515245 + 12345) % 2147483648; return Math.floor((x / 2147483648) * n); };
  const proj = mkproj('jade-fmrand-c-');
  const dirs = ['', 'a', 'b', 'a/x', 'a/y', 'b/z', 'c'];
  for (const d of dirs) fs.mkdirSync(path.join(proj, d), { recursive: true });
  for (let i = 0; i < 20; i++) put(path.join(proj, dirs[rnd(dirs.length)], `f${i}.txt`));
  files.stopWatching(); files.invalidate();
  await files.list(); await files.list();
  assert.ok(await agrees(proj, 4000), 'starting point');
  const log = [];
  for (let step = 0; step < 300; step++) {
    const live = truth(proj), dir = path.join(proj, dirs[rnd(dirs.length)]);
    const kind = rnd(7); let what = '';
    try {
      if (kind === 0 || kind === 1) { const p = path.join(dir, `n${step}.txt`); put(p); what = 'add ' + p; }
      else if (kind === 2 && live.length) { const p = live[rnd(live.length)]; fs.writeFileSync(p, 'more text ' + step); what = 'edit ' + p; }
      else if (kind === 3 && live.length) { const p = live[rnd(live.length)], q = path.join(dir, `r${step}.md`); fs.mkdirSync(dir, { recursive: true }); fs.renameSync(p, q); what = `rename ${p} -> ${q}`; }
      else if (kind === 4 && live.length) { const p = live[rnd(live.length)]; fs.rmSync(p); what = 'delete ' + p; }
      else if (kind === 5 && dir !== proj) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); put(path.join(dir, `again${step}.txt`)); what = 'recreate ' + dir; }
      else if (kind === 6 && dir !== proj) { fs.rmSync(dir, { recursive: true, force: true }); what = 'remove folder ' + dir; }
    } catch (e) { what += ' (failed: ' + e.code + ')'; }
    log.push(what);
    if (rnd(4) === 0) await new Promise(r => setTimeout(r, rnd(20)));
    if (rnd(40) === 0) await files.list();   // a request in the middle of it all
  }
  const ok = await agrees(proj, 8000);
  assert.ok(ok, `seed ${seed}: the list did not catch up within 8 seconds\n   ${await show(proj)}\n   last steps: ${log.slice(-6).join(' | ')}`);
});
