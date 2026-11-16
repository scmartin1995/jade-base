// What remains of the old safety tests: deleting a dashboard stays inside the project's Dashboards folder, and the app's file
// preview frame (which opens older dashboard pages and other HTML files) has script rights only. The model-written page checks,
// served policy and frame guard are gone with the pages they guarded: a model no longer writes script (see dashboard.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-dash-safe-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const dashboards = await import('../server/core/dashboards.js');
config.load(); store.init();

test('removing a dashboard only deletes a file inside the project\'s Dashboards folder', () => {
  const folder = path.join(tmp, 'proj'); fs.mkdirSync(folder, { recursive: true });
  const P = store.saveProject({ name: 'Safe', folders: [folder] });
  const outside = path.join(folder, 'precious.html'); fs.writeFileSync(outside, 'keep me');
  const sibling = path.join(tmp, 'elsewhere.txt'); fs.writeFileSync(sibling, 'keep me too');
  const inside = path.join(store.projectDir(P.id, 'Dashboards'), 'Mine.html'); fs.mkdirSync(path.dirname(inside), { recursive: true }); fs.writeFileSync(inside, 'x');
  const tricky = path.join(store.projectDir(P.id, 'Dashboards'), '..', '..', 'elsewhere.txt');
  store.patchProject(P.id, { dashboards: [{ id: 'a', name: 'a', path: outside }, { id: 'b', name: 'b', path: sibling }, { id: 'c', name: 'c', path: inside }, { id: 'd', name: 'd', path: tricky }] });
  for (const id of ['a', 'b', 'd']) dashboards.remove(P.id, id);
  assert.ok(fs.existsSync(outside) && fs.existsSync(sibling), 'files outside the Dashboards folder stay');
  assert.deepEqual(store.getProject(P.id).dashboards.map(x => x.id), ['c'], 'the records are still dropped');
  dashboards.remove(P.id, 'c');
  assert.ok(!fs.existsSync(inside), 'the dashboard\'s own page is deleted');
});

test('the file preview frame in the app has no forms and no pop-ups', () => {
  const ui = fs.readFileSync(new URL('../public/js/ui.js', import.meta.url), 'utf8');
  const frames = [...ui.matchAll(/<iframe[^>]*sandbox="([^"]*)"/g)].map(m => m[1]);
  assert.ok(frames.length && frames.every(f => f === 'allow-scripts'), frames.join(' | '));
});

