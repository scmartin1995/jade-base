// Modules add panels to the project page through projectPanels in their manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-panels-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const { projectPanels, renderPanels } = await import('../public/js/views/project.js');
const modules = await import('../server/core/modules.js');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const mods = [
  { id: 'late', name: 'Late', order: 200, enabled: true, source: 'user', projectPanels: [{ id: 'b', title: 'Second', view: 'b.js', order: 20 }] },
  { id: 'early', name: 'Early', order: 100, enabled: true, source: 'builtin', projectPanels: [{ id: 'a', title: 'First', view: 'a.js', order: 10 }, { id: 'x', view: '../evil.js' }, { id: 'y', view: 'sub/dir.js' }, { view: 'n.js' }] },
  { id: 'off', name: 'Off', order: 50, enabled: false, projectPanels: [{ id: 'z', title: 'Hidden', view: 'z.js', order: 1 }] },
  { id: 'none', name: 'None', order: 60, enabled: true },
];

test('panels come from enabled modules, in order, with the right file location and no unsafe file names', () => {
  const p = projectPanels(mods);
  assert.deepEqual(p.map(x => x.key), ['early/a', 'late/b']);
  assert.equal(p[0].url, '/js/views/a.js');
  assert.equal(p[1].url, '/modules/late/views/b.js');
  assert.equal(p[0].title, 'First');
});

test('no modules, nothing', () => { assert.deepEqual(projectPanels(), []); assert.deepEqual(projectPanels([{ id: 'q', enabled: true }]), []); });

test('each panel view gets its root, the page context and the project; a broken one does not stop the rest', async () => {
  const bodies = {};
  const host = { innerHTML: '', querySelector: sel => bodies[sel] ||= { innerHTML: '', sel } };
  const calls = [];
  const views = {
    '/js/views/a.js': { default: { render(root, ctx, project) { calls.push(['a', root.sel, project.id, ctx.marker]); root.innerHTML = 'A'; } } },
    '/modules/late/views/b.js': { default: {} },
  };
  const ctx = { marker: 7, ui: { esc }, state: { boot: { modules: mods } } };
  await renderPanels(host, ctx, { id: 'p1' }, async u => views[u]);
  assert.deepEqual(calls, [['a', '[data-panel-body="early/a"]', 'p1', 7]]);
  assert.match(host.innerHTML, /<h2>First<\/h2>/);
  assert.match(host.innerHTML, /<h2>Second<\/h2>/);
  assert.equal(bodies['[data-panel-body="early/a"]'].innerHTML, 'A');
  assert.match(bodies['[data-panel-body="late/b"]'].innerHTML, /could not be shown/);
});

test('a manifest with projectPanels reaches the browser as it is, and a user view file is served', async () => {
  const dir = path.join(process.env.JADE_HOME, 'modules');
  fs.mkdirSync(path.join(dir, 'pan', 'views'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pan.js'), "export default { id: 'pan', name: 'Pan', projectPanels: [{ id: 'p', title: 'Pan', view: 'p.js', order: 5 }] };\n");
  await modules.discover();
  const m = modules.list().find(x => x.id === 'pan');
  assert.deepEqual(m.projectPanels, [{ id: 'p', title: 'Pan', view: 'p.js', order: 5 }]);
  assert.equal(projectPanels(modules.list()).find(x => x.module === 'pan').url, '/modules/pan/views/p.js');
});
