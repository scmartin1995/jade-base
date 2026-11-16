// A watched folder that is deleted must stop being watched (on Windows with Node 22+ the watcher otherwise reports without end and
// the process never exits), and a watcher that floods is closed too. The folder is watched again when it comes back.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { waitFor } from './helpers/server.js';
import { removeDir } from './helpers/rm.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-wguard-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const { guardedWatch, watcherCount } = await import('../server/core/util.js');
config.load(); store.init();
after(() => removeDir(tmp));

const fake = () => { const w = new EventEmitter(); w.closed = 0; w.close = () => { w.closed++; }; w.unref = () => w; return w; };

test('a fake watcher is closed when its folder no longer exists', () => {
  const w = fake(); let fire; const heard = [], closed = [];
  guardedWatch(path.join(tmp, 'gone-dir'), null, (ev, f) => heard.push(f), { watchFn: (d, cb) => { fire = cb; return w; }, onClose: why => closed.push(why) });
  assert.equal(watcherCount() >= 1, true);
  fire('rename', 'x');
  assert.deepEqual(closed, ['gone']); assert.equal(w.closed, 1); assert.deepEqual(heard, []);
  fire('rename', 'x');   // nothing more is passed on or closed twice
  assert.equal(w.closed, 1);
});

test('a fake watcher in a storm of events is closed', () => {
  const w = fake(); let fire; const heard = [], closed = [];
  guardedWatch(tmp, null, (ev, f) => heard.push(f), { watchFn: (d, cb) => { fire = cb; return w; }, onClose: why => closed.push(why), maxPerSecond: 50 });
  for (let i = 0; i < 49; i++) fire('change', 'a');
  assert.deepEqual(closed, []);
  for (let i = 0; i < 5; i++) fire('change', 'a');
  assert.deepEqual(closed, ['storm']); assert.equal(heard.length, 50);
});

test('a project folder that is deleted loses its watcher, and is watched again when it comes back', async () => {
  const proj = fs.mkdtempSync(path.join(tmp, 'proj-'));
  const before = watcherCount();
  store.saveProject({ name: 'Guard', folders: [proj] });
  assert.ok(watcherCount() > before, 'the project folder is watched');
  const during = watcherCount();
  fs.rmSync(proj, { recursive: true });
  assert.ok(await waitFor(() => watcherCount() < during, 3000), 'the watcher is closed once the folder is gone');
  fs.mkdirSync(proj);
  store.syncWatches();
  assert.ok(watcherCount() >= during, 'watched again once the folder is back');
});
