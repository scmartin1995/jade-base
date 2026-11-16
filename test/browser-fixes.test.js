// Fixes found by driving the app in a browser: each is checked here without a browser, on the pieces that decide it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => fs.readFileSync(path.join(root, p), 'utf8');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('an action made from a meeting links back to the meeting; any other path shows only a file name', async () => {
  const { sourceHtml } = await import('../public/js/actionsource.js');
  const meetings = [{ id: 'm1', title: 'Warehouse weekly', date: '2026-11-10', recordPath: '/p/Jade/Meetings/2026-11-10 Warehouse weekly.md' }];
  const link = sourceHtml(esc, { source: '/p/Jade/Meetings/2026-11-10 Warehouse weekly.md' }, meetings);
  assert.match(link, /<a href="#\/meeting\/m1">From the meeting Warehouse weekly \(2026-11-10\)<\/a>/);
  assert.ok(!link.includes('/p/Jade'), 'the long path is not shown');
  assert.match(sourceHtml(esc, { source: 'C:\\p\\Jade\\Meetings\\2026-11-10 Warehouse weekly.md' }, [{ ...meetings[0], recordPath: 'C:/p/Jade/Meetings/2026-11-10 Warehouse weekly.md' }]), /<a href="#\/meeting\/m1">/, 'Windows slashes match too');
  assert.equal(sourceHtml(esc, { source: '/elsewhere/plan.docx' }, meetings), '<span>From plan</span>');
  assert.equal(sourceHtml(esc, { source: 'manual' }, meetings), '<span>manual</span>');
  assert.equal(sourceHtml(esc, { source: 'jade' }, []), '<span>jade</span>');
});

test('leaving the dashboard questionnaire takes it off the page before the list is drawn again', async () => {
  const { leaveAsk } = await import('../public/js/views/dashboards.js');
  const host = { innerHTML: '<div class="qn">review</div>' };
  let seen = null;
  leaveAsk(host, () => { seen = host.innerHTML; });
  assert.equal(seen, '', 'the guard that keeps a questionnaire open would otherwise stop the redraw');
});

test('a hidden form field stays hidden: no display rule may beat the attribute', () => {
  const css = rd('public/css/jade.css');
  assert.match(css, /\n\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.match(css, /input\[type=password\]/, 'the key box looks like the other boxes');
  for (const dead of ['.big-num', '.proj-row', '.voice-overlay', '.mod-card', '.memmap-canvas']) assert.ok(!css.includes(dead), dead + ' is no longer used');
});

test('voice does not start out listening, and Settings says so when Voice is off', async () => {
  const config = await import('../server/core/config.js');
  assert.equal(config.DEFAULTS.voice.wake, false);
  assert.match(rd('public/js/views/settings.js'), /Voice is switched off/);
});

test('the schedule menu offers neutral times only', () => {
  const js = rd('public/js/views/routines.js');
  for (const t of ['06:45', '07:15', '14:00', '16:30', '07:30']) assert.ok(!js.includes(t), t);
  assert.ok(!/true agents/.test(js));
});

test('Skills opens on the tab that has skills', async () => {
  const view = (await import('../public/js/views/skills.js')).default;
  const skills = ['a', 'b'].map(n => ({ name: 'jade-x-' + n, kind: 'claude', origin: 'claude', description: 'd', body: 'b', dir: '/c/skills/jade-x-' + n, enabled: true, runs: 0, tags: [], automation: '' }));
  const answers = { '/api/skills': skills, '/api/projects': [], '/api/agents': [{ id: 'x', name: 'X', skills: ['a', 'b'] }] };
  const stub = () => new Proxy({}, { set: () => true, get: () => '' });
  const root = { innerHTML: '', querySelector: stub, querySelectorAll: () => [] };
  const ui = { esc, icon: () => '', plain: s => s, ago: () => '' };
  const ctx = { api: async (_m, u) => answers[u], ui };
  await view.render.call({}, root, ctx);
  assert.match(root.innerHTML, /data-tab="claude" class="on"/);
  assert.match(root.innerHTML, /used by its agent whenever that agent runs/);
  assert.doesNotMatch(root.innerHTML, /not used yet/);
});

test('the last set-up step checks the connection before it changes anything, and adds the project once', async () => {
  const { finishSetup } = await import('../public/js/views/setup.js');
  const calls = [];
  const mk = (checked, projects = []) => ({ api: async (m, u, b) => { calls.push(`${m} ${u}`); if (u === '/api/setup') return { connectionChecked: checked }; if (u === '/api/projects' && m === 'GET') return projects; return {}; },
    ui: { toast() {} }, state: {}, go() {} });
  const answers = { name: 'Sam', model: '', checkerModel: '', install: 'yes', project: { name: 'Riverside', folder: '/r' } };
  await assert.rejects(finishSetup(answers, mk(false)), /not yet heard back/);
  assert.deepEqual(calls, ['GET /api/setup'], 'nothing was saved, installed or created');
  calls.length = 0;
  await finishSetup(answers, mk(true, [{ name: 'Riverside' }]));
  assert.ok(!calls.includes('POST /api/projects'), 'a project of that name is not made twice');
  assert.ok(calls.includes('POST /api/agents/install') && calls.at(-2) === 'POST /api/setup/done');
  calls.length = 0;
  await finishSetup(answers, mk(true, []));
  assert.ok(calls.includes('POST /api/projects'));
});

test('the page text does not send people to a folder that is not theirs', () => {
  for (const f of ['public/js/views/actions.js', 'public/js/views/notes.js']) assert.ok(!/JadeBase\//.test(rd(f)), f);
  assert.match(rd('server/api.js'), /\['Jade data', config\.JADE_HOME\]/);
});
