// The renderers: what a model writes into a specification shows up as text, never as markup; numbers come from the data; every
// layout in the schema has one renderer file and the other way round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const spec = await import('../server/core/dashboardspec.js');

// A very small DOM: elements, text nodes, attributes; and a serializer that escapes text the way a browser shows it.
const tags = [];
class Node { constructor(tag) { this.tag = tag; this.attrs = {}; this.kids = []; } setAttribute(k, v) { this.attrs[k] = String(v); } appendChild(k) { this.kids.push(k); return k; } }
globalThis.document = { createElement: t => { tags.push(t); return new Node(t); }, createElementNS: (ns, t) => { tags.push(t); return new Node(t); }, createTextNode: t => ({ text: String(t) }) };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ser = n => (n.text !== undefined ? esc(n.text) : `<${n.tag}${Object.entries(n.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}>${n.kids.map(ser).join('')}</${n.tag}>`);
const textOf = n => (n.text !== undefined ? n.text : n.kids.map(textOf).join(' '));
const walk = (n, fn) => { fn(n); (n.kids || []).forEach(k => walk(k, fn)); };

const { renderDashboard } = await import('../public/js/dashboard/view.js');
const engine = await import('../public/js/dashboard/engine.js');

const EVIL = '<img src=x onerror="window.pwn=1"><script>window.pwn=1</script>';
const schema = spec.publicSchema();
const data = { project: { id: 'p', name: 'Proj ' + EVIL }, generatedAt: '2026-11-13T10:00:00Z', today: '2026-11-13', sources: {
  actions: [{ text: EVIL, owner: 'Ann', due: '2026-11-15', status: 'open', overdue: false, source: '' }, { text: 'Late one', owner: 'Ann', due: '2026-11-01', status: 'open', overdue: true, source: '' }, { text: 'Done', owner: 'Bo', due: '', status: 'done', overdue: false, source: '' }],
  notes: [{ title: 'N ' + EVIL, date: '2026-11-02', excerpt: 'x' }],
  meetings: [{ title: 'M ' + EVIL, date: '2026-11-03', decisions: 1, risks: 1, actions: 1, _path: '/p/Jade/Meetings/m.md', _lists: { decisions: [EVIL], risks: ['r'], actions: ['a'] } }],
  files: [{ name: 'f ' + EVIL, folder: '', kind: 'note', modified: '2026-11-01', _path: '/p/f.md' }],
  claudesetup: [{ folder: 'proj', claudeMd: true, agents: 2, skills: 0, commands: 0, tools: 1, settings: false, git: true, sessions: 3, lastSession: '2026-11-10' }] } };
const full = { title: 'T ' + EVIL, intro: 'I ' + EVIL, sections: [
  { layout: 'headline', title: 'H ' + EVIL, figures: [{ label: 'L <b>x</b><i>', source: 'actions', filter: [{ field: 'status', op: 'is', value: 'open' }] }, { label: 'All', source: 'files', filter: [] }] },
  { layout: 'table', title: 'Tbl', source: 'actions', fields: ['text', 'owner', 'due'], filter: [], note: 'N ' + EVIL },
  { layout: 'grouped', title: 'G', source: 'actions', group: 'owner', fields: ['text'], filter: [] },
  { layout: 'bars', title: 'B', source: 'actions', group: 'owner', filter: [] },
  { layout: 'timeline', title: 'TL', source: 'notes', group: 'date', fields: ['title'], filter: [] },
  { layout: 'due', title: 'Due', source: 'actions', filter: [] },
  { layout: 'text', title: 'Words', note: 'Para ' + EVIL + '\n\nSecond' },
  { layout: 'meetings', title: 'Mtgs', source: 'meetings', filter: [] },
  { layout: 'table', title: 'Files', source: 'files', fields: ['name', 'modified'], filter: [] },
  { layout: 'table', title: 'Setup', source: 'claudesetup', fields: ['folder', 'agents', 'git'], filter: [] },
] };

test('the fixture is a valid specification that uses every layout', () => {
  assert.deepEqual(spec.validateSpec(full).problems, []);
  assert.deepEqual([...new Set(full.sections.map(s => s.layout))].sort(), Object.keys(spec.LAYOUTS).sort());
});

test('markup or script in any model string or data value appears as text, never as elements', async () => {
  tags.length = 0;
  const root = await renderDashboard(full, data, schema);
  const html = ser(root);
  assert.ok(!html.includes('<script') && !html.includes('<img'), 'no element was made from text');
  assert.ok(!tags.some(t => ['script', 'img', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'form', 'input'].includes(t)), [...new Set(tags)].join());
  assert.ok(html.includes('&lt;script&gt;window.pwn=1&lt;/script&gt;'), 'it is there as text');
  const t = textOf(root);
  for (const where of ['T <img', 'I <img', 'H <img', 'L <b>x</b><i>', 'Para <img', 'N <img']) assert.ok(t.includes(where), where);
  walk(root, n => { for (const k of Object.keys(n.attrs || {})) assert.ok(!/^on/i.test(k), 'no event attribute'); if (n.attrs?.href) assert.match(n.attrs.href, /^#\//); });
  // files open only through the app's preview, by a path the server sent
  const links = []; walk(root, n => { if (n.attrs?.['data-preview-file']) links.push(n.attrs['data-preview-file']); });
  assert.deepEqual([...new Set(links)].sort(), ['/p/Jade/Meetings/m.md', '/p/f.md']);
  assert.equal(globalThis.window?.pwn, undefined);
});

test('numbers shown come from the data, not from the specification', async () => {
  const run = async d => textOf(await renderDashboard({ title: 't', sections: [full.sections[0]] }, d, schema));
  const a = await run(data);
  assert.match(a, /2\s+Actions/); assert.match(a, /1\s+Files/);
  const more = structuredClone(data); more.sources.actions.push({ text: 'x', owner: '', due: '', status: 'open', overdue: false, source: '' });
  assert.match(await run(more), /3\s+Actions/, 'same specification, different data, different number');
  const fewer = structuredClone(data); fewer.sources.actions = []; fewer.sources.files = [];
  assert.match(await run(fewer), /0\s+Actions[\s\S]*0\s+Files/);
  // the due list and bars count from rows too
  const due = textOf(await renderDashboard({ title: 't', sections: [full.sections[5]] }, data, schema));
  assert.match(due, /Late one/); assert.match(due, /Overdue/);
  const bars = []; walk(await renderDashboard({ title: 't', sections: [full.sections[3]] }, data, schema), n => { if (n.tag === 'title') bars.push(textOf(n)); });
  assert.deepEqual(bars, ['Ann: 2', 'Bo: 1']);
});

test('filters, sorting, grouping and dates work on the rows', () => {
  const rows = (f, extra = {}) => engine.select({ source: 'actions', filter: f, ...extra }, data, schema);
  assert.equal(rows([{ field: 'owner', op: 'contains', value: 'an' }]).length, 2);
  assert.equal(rows([{ field: 'due', op: 'before', value: 'today' }]).length, 1);
  assert.equal(rows([{ field: 'due', op: 'after', value: 'today+1' }]).length, 1);
  assert.equal(rows([{ field: 'due', op: 'empty' }]).length, 1);
  assert.deepEqual(rows([], { sort: { field: 'due', direction: 'desc' } }).map(r => r.text), [EVIL, 'Late one', 'Done'].map(x => x));
  assert.deepEqual(engine.groupRows(data.sources.actions, 'owner', schema.sources.actions).map(g => [g.key, g.rows.length]), [['Ann', 2], ['Bo', 1]]);
});

test('every layout has one renderer file and one schema entry, and nothing else', () => {
  const dir = new URL('../public/js/dashboard/layouts/', import.meta.url);
  assert.deepEqual(fs.readdirSync(dir).map(f => f.replace(/\.js$/, '')).sort(), Object.keys(spec.LAYOUTS).sort());
});

test('a section that cannot be drawn does not stop the others, and a layout name is checked before a file is loaded', async () => {
  const loaded = [];
  const root = await renderDashboard({ title: 't', sections: [{ layout: '../../evil', title: 'x' }, { layout: 'text', title: 'ok', note: 'fine' }] }, data, schema, { load: async id => { loaded.push(id); return import(`../public/js/dashboard/layouts/${id}.js`); } });
  assert.deepEqual(loaded, ['text']);
  assert.match(textOf(root), /could not be drawn[\s\S]*fine/);
});
