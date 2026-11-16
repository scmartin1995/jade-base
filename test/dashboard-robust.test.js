// Dashboards stay standing whatever a model answers: validateSpec never throws, the builder follows the PM's chosen agents model,
// a section that cannot be drawn says so, and a stale edit link is not turned into a new dashboard.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-dashrobust-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const judge = await import('../server/core/judge.js');
const dashboards = await import('../server/core/dashboards.js');
const spec = await import('../server/core/dashboardspec.js');
config.load(); store.init();
after(async () => (await import('../server/core/files.js')).stopWatching());   // building a dashboard waits for the file list, which starts the folder watches

const ODD = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype', '', ' ', 'a'.repeat(100000), '\u0000', null, undefined, 0, -1, 1e308, NaN, true, [], {}, [[]], { constructor: 1 }, () => 1];
const deep = n => { let o = 'x'; for (let i = 0; i < n; i++) o = [o]; return o; };

test('validateSpec never throws, whatever the names and types in a model answer', () => {
  const tries = [];
  for (const v of ODD) {
    tries.push(v, { title: v, sections: v }, { title: 't', intro: v, sections: [v] }, { title: 't', sections: [{ layout: v, title: 'x' }] });
    for (const layout of Object.keys(spec.LAYOUTS)) {
      tries.push({ title: 't', sections: [{ layout, title: 'x', source: v, group: v, fields: v, filter: v, sort: v, limit: v, figures: v, note: v }] });
      tries.push({ title: 't', sections: [{ layout, title: 'x', source: 'actions', group: v, fields: [v], sort: { field: v, direction: v }, filter: [{ field: v, op: v, value: v }] }] });
      tries.push({ title: 't', sections: [{ layout, title: 'x', figures: [{ label: v, source: v, filter: [{ field: v, op: v }] }] }] });
    }
  }
  tries.push({ title: 't', sections: [{ layout: 'table', title: 'x', source: 'actions', fields: ['constructor'] }] });
  tries.push({ title: 't', sections: [{ layout: 'table', title: 'x', source: 'constructor', fields: ['text'] }] });
  tries.push({ title: deep(5000), sections: deep(5000) }, { title: 't', sections: Array.from({ length: 50000 }, () => ({})) });
  tries.push(JSON.parse('{"title":"t","sections":[{"__proto__":{"layout":"table"},"layout":"table","title":"x"}]}'));
  for (const t of tries) {
    let r;
    assert.doesNotThrow(() => { r = spec.validateSpec(t); });
    assert.ok(Array.isArray(r.problems));
    assert.ok(r.spec === null || r.problems.length === 0);
  }
});

test('inherited property names are rejected as layouts, operators, sources and fields', () => {
  const one = s => spec.validateSpec({ title: 't', sections: [s] });
  assert.ok(one({ layout: 'constructor', title: 'x' }).problems.length);
  assert.ok(one({ layout: 'table', title: 'x', source: 'actions', fields: ['constructor'] }).problems.length);
  assert.ok(one({ layout: 'table', title: 'x', source: 'toString', fields: ['text'] }).problems.length);
  assert.ok(one({ layout: 'table', title: 'x', source: 'actions', fields: ['text'], filter: [{ field: 'text', op: 'toString', value: 'a' }] }).problems.length);
  assert.ok(one({ layout: 'table', title: 'x', source: 'actions', fields: ['text'], sort: { field: '__proto__' } }).problems.length);
});

test('dashboards use the PM\'s agents model when no dashboards model is set, and the dashboards model when there is one', async () => {
  const P = store.saveProject({ name: 'Model check', description: '', folders: [] });
  const d = dashboards.create(P.id, { name: 'D' });
  const GOOD = { title: 'T', sections: [{ layout: 'text', title: 'x', note: 'hello' }] };
  const seen = [];
  judge.use(({ model }) => { seen.push(model); return { data: structuredClone(GOOD) }; });
  config.save({ agents: { model: 'agents-pick' } });
  await dashboards.build(P.id, d.id);
  config.save({ dashboards: { model: 'dash-pick' } });
  await dashboards.build(P.id, d.id);
  assert.deepEqual(seen, ['agents-pick', 'dash-pick']);
});

test('changing a dashboard deleted while the model was working does not bring its file back', async () => {
  const P = store.saveProject({ name: 'Resurrect', description: '', folders: [] });
  const d = dashboards.create(P.id, { name: 'Gone' });
  judge.use(() => ({ data: { title: 'T', sections: [{ layout: 'text', title: 'x', note: 'hello' }] } }));
  await dashboards.build(P.id, d.id);
  const file = path.join(store.projectDir(P.id, 'Dashboards'), 'Gone.json');
  assert.ok(fs.existsSync(file));
  judge.use(async () => { dashboards.remove(P.id, d.id); return { data: { title: 'T2', sections: [{ layout: 'text', title: 'y', note: 'new' }] } }; });
  await assert.rejects(() => dashboards.change(P.id, d.id, 'make it different'), /was removed/);
  assert.ok(!fs.existsSync(file), 'the removed dashboard\'s file must stay removed');
});

test('the builder prompt describes every layout from the LAYOUTS table, and a new layout appears by itself', () => {
  const p = { id: 'p', name: 'P' }, d = { name: 'D', answers: {} }, data = { project: { name: 'P' }, today: '2026-01-01', sources: {} };
  const built = () => dashboards.buildPrompt(p, d, data);
  for (const [id, l] of Object.entries(spec.LAYOUTS)) { assert.ok(built().includes(id), id); assert.ok(built().includes(l.help), 'help of ' + id); }
  spec.LAYOUTS.zzcalendar = { label: 'Calendar', help: 'Days in a grid, made up for this test.', uses: ['note'], need: ['note'] };
  try { assert.ok(built().includes('zzcalendar') && built().includes('made up for this test')); } finally { delete spec.LAYOUTS.zzcalendar; }
});
