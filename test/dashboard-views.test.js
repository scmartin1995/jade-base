// The Dashboards page and the project card, with a stand-in api and page: a failed load says so (and is not "none yet"), a stale
// "Change answers" link says the dashboard is gone, and a section that cannot be drawn is reported on the page and in the console.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ui = { esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]), icon: () => '', ago: () => 'now', copy() {}, toast() {} };
const page = () => ({ innerHTML: '', querySelector: () => null, querySelectorAll: () => [] });
const ctxOf = (api, query = '') => ({ api, ui, state: { query: new URLSearchParams(query), jobs: [] }, go() {} });
const quiet = fn => async (...a) => { const e = console.error; console.error = () => {}; try { return await fn(...a); } finally { console.error = e; } };

const dashboards = (await import('../public/js/views/dashboards.js')).default;
const panel = (await import('../public/js/views/dashboard-panel.js')).default;

const PROJECTS = [{ id: 'p1', name: 'Helios', claude: [], dashboards: [{ id: 'd1', name: 'Steering', answers: {} }] }];

test('a failed load of the Dashboards page says so and does not claim there are none', quiet(async () => {
  const root = page();
  await dashboards.render(root, ctxOf(async () => { throw new Error('Server is down'); }));
  assert.match(root.innerHTML, /could not be loaded/);
  assert.match(root.innerHTML, /Server is down/);
  assert.doesNotMatch(root.innerHTML, /No projects yet|No dashboards yet/);
}));

test('a "Change answers" link to a dashboard that no longer exists says so instead of asking questions', async () => {
  const root = page(); const calls = [];
  await dashboards.render(root, ctxOf(async (m, p) => { calls.push(m + ' ' + p); return PROJECTS; }, 'edit=p1~gone'));
  assert.match(root.innerHTML, /not there any more/);
  assert.doesNotMatch(root.innerHTML, /data-ask/);
  assert.deepEqual(calls, ['GET /api/dashboards']);   // nothing was created
});

test('the project card lets a failed load reach the project page instead of drawing "none yet"', async () => {
  const root = page();
  await assert.rejects(() => panel.render(root, ctxOf(async () => { throw new Error('Server is down'); }), { id: 'p1', name: 'Helios' }), /Server is down/);
  assert.doesNotMatch(root.innerHTML, /No dashboards yet/);
});

test('the project card still says "none yet" when the list is really empty', async () => {
  const root = page();
  await panel.render(root, ctxOf(async () => []), { id: 'p1', name: 'Helios' });
  assert.match(root.innerHTML, /No dashboards yet/);
});

test('a section that fails to draw is reported on the page and in the console', async () => {
  const tags = [];
  class Node { constructor(t) { this.tag = t; this.kids = []; } setAttribute() {} appendChild(k) { this.kids.push(k); return k; } }
  globalThis.document = { createElement: t => new Node(t), createElementNS: (n, t) => new Node(t), createTextNode: t => ({ text: String(t) }) };
  const textOf = n => (n.text !== undefined ? n.text : n.kids.map(textOf).join(' '));
  const { renderDashboard } = await import('../public/js/dashboard/view.js');
  const logged = []; const e = console.error; console.error = (...a) => logged.push(a);
  try {
    const out = await renderDashboard({ title: 'T', intro: '', sections: [{ layout: 'table', title: 'Broken one' }] },
      { project: { name: 'P' }, generatedAt: '2026-11-13T10:00:00Z', sources: {} }, { layouts: { table: {} } }, { load: async () => { throw new Error('boom'); } });
    assert.match(textOf(out), /could not be drawn \(boom\)/);
  } finally { console.error = e; }
  assert.equal(logged.length, 1);
  assert.ok(logged[0].some(x => x === 'Broken one'));
});
