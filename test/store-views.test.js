// The Notes, Action items and Chats pages ask the server for one page at a time, say when there is more, and ask for the next page.
// Rendered into a stand-in root, no browser (the same way test/meetings-views.test.js does it).
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem: () => null, setItem() {} };
globalThis.window ??= { innerWidth: 1400 };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ui = {
  esc, icon: () => '', projectOptions: () => '', ago: () => 'just now', plain: s => String(s || ''), md: s => esc(s), daysUntil: () => null, dueLabel: d => d, fmtSize: n => String(n),
  askBtn: () => '', askPrompt: () => '', sidePanel: () => '', touchedList: () => '', latestFiles: () => [], mergeFiles: () => [], toast() {}, copy() {},
};
const handlers = {};
globalThis.document ??= { createElement: () => ({}), addEventListener() {}, removeEventListener() {}, title: '' };
const el = () => ({ remove() {}, setAttribute() {}, contains: () => false, innerHTML: '', value: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, scrollTo() {}, focus() {}, setSelectionRange() {}, requestSubmit() {}, hidden: false,
  scrollHeight: 0, scrollTop: 0, clientHeight: 0, addEventListener(ev, fn) { handlers[ev] = fn; }, removeEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], appendChild() {}, set onclick(f) {}, set oninput(f) {}, set onchange(f) {}, set onsubmit(f) {}, set onkeydown(f) {} });
const root = html => ({ isConnected: true, set innerHTML(v) { html.v = v; }, get innerHTML() { return html.v; }, querySelector: sel => (sel === '[data-more]' && html.v.includes('data-more>') ? el() : sel === '[data-more]' ? null : el()),
  querySelectorAll: () => [], offsetHeight: 0, style: {} });
const calls = [];
const apiWith = (routes) => async (method, url) => { calls.push(url); const hit = routes.find(([re]) => re.test(url)); if (!hit) throw new Error('no stub for ' + url); return typeof hit[1] === 'function' ? hit[1](url) : hit[1]; };
const notes = n => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, title: `Note ${i}`, project: '', tags: [], updated: '2026-01-01T00:00:00.000Z', preview: `preview ${i}` }));

test('Notes: asks for a page and the total, shows a "more" button only when there is more, and filters on the server', async () => {
  const { default: page } = await import('../public/js/views/notes.js');
  const view = { ...page };
  let html = { v: '' };
  const api = apiWith([[/^\/api\/notes\?/, u => ({ items: notes(Number(new URL(u, 'http://x').searchParams.get('limit'))), total: 80 })], [/^\/api\/projects$/, []]]);
  await view.render(root(html), { api, ui, go() {}, runAgent() {}, params: [], state: { route: 'notes' } });
  assert.match(calls.at(-2), /^\/api\/notes\?limit=50&paged=1$/, 'a page of 50 and the total');
  assert.match(html.v, /Showing 50 of 80/);
  assert.equal((html.v.match(/href="#\/notes\/n/g) || []).length, 50);
  assert.match(html.v, /data-more/);
  html = { v: '' };
  await view.render(root(html), { api: apiWith([[/^\/api\/notes\?/, { items: notes(7), total: 7 }], [/^\/api\/projects$/, []]]), ui, go() {}, runAgent() {}, params: [], state: { route: 'notes' } });
  assert.equal((html.v.match(/href="#\/notes\/n/g) || []).length, 7);
  assert.doesNotMatch(html.v, /data-more/);
  view._q = 'budget'; view._project = 'p1'; view._n = 100; calls.length = 0;
  await view.render(root({ v: '' }), { api: apiWith([[/^\/api\/notes\?/, { items: [], total: 0 }], [/^\/api\/projects$/, []]]), ui, go() {}, runAgent() {}, params: [], state: { route: 'notes' } });
  const asked = new URL(calls.find(u => u.startsWith('/api/notes?')), 'http://x').searchParams;
  assert.deepEqual([asked.get('limit'), asked.get('q'), asked.get('project')], ['100', 'budget', 'p1']);
});

test('Action items: the server filters and orders, owners come from their own list, and "more" appears only when there is more', async () => {
  const { default: page } = await import('../public/js/views/actions.js');
  const view = { ...page };
  const acts = n => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, text: `Action ${i}`, status: 'open', due: '', owner: 'Pat', project: '', priority: 'normal' }));
  calls.length = 0;
  const html = { v: '' };
  const routes = n => [[/^\/api\/actions\?/, { items: acts(Math.min(n, 100)), total: n }], [/^\/api\/actions\/owners$/, ['Pat', 'Sam']], [/^\/api\/projects$/, []], [/^\/api\/meetings$/, []]];
  await view.render(root(html), { api: apiWith(routes(101)), ui, go() {}, state: { route: 'actions' } });
  const asked = new URL(calls.find(u => u.startsWith('/api/actions?')), 'http://x').searchParams;
  assert.deepEqual([asked.get('status'), asked.get('limit')], ['open', '100']);
  assert.match(html.v, /data-more/); assert.match(html.v, /Showing 100 of 101/); assert.match(html.v, />Sam</);
  const few = { v: '' };
  await view.render(root(few), { api: apiWith(routes(3)), ui, go() {}, state: { route: 'actions' } });
  assert.doesNotMatch(few.v, /data-more/); assert.match(few.v, /3 shown/);
  view._f = { status: 'done', project: 'p1', owner: 'Sam', q: 'chase' }; calls.length = 0;
  await view.render(root({ v: '' }), { api: apiWith(routes(0)), ui, go() {}, state: { route: 'actions' } });
  const q = new URL(calls.find(u => u.startsWith('/api/actions?')), 'http://x').searchParams;
  assert.deepEqual([q.get('status'), q.get('project'), q.get('owner'), q.get('q')], ['done', 'p1', 'Sam', 'chase']);
});

test('Chats: the latest 40 turns and a page of the list are asked for, and earlier turns can be loaded', async () => {
  const { default: page } = await import('../public/js/views/chat.js');
  const view = { ...page };
  const turns = Array.from({ length: 40 }, (_, i) => ({ at: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, role: i % 2 ? 'jade' : 'user', text: `turn ${i}` }));
  const state = { route: 'chat', boot: { config: {}, models: { choices: [] } }, jobs: [], panelAuto: new Set(), panel: { open: false, cards: new Set() }, streams: new Map() };
  const ctx = { api: apiWith([[/^\/api\/chats\?/, { items: [{ id: 'c1', title: 'One', preview: 'hi', updatedAt: new Date().toISOString() }], total: 1 }], [/^\/api\/chats\/c1\?limit=/, { id: 'c1', title: 'One', turns, total: 130 }]]),
    ui, state, go() {}, params: ['c1'], panelPast: () => ({ files: [], agents: [] }), panelFiles: () => [], enabled: () => false, face: { mount: () => ({ el: {}, update() {} }) }, send() {}, voice: {}, togglePanel() {} };
  calls.length = 0;
  const html = { v: '' };
  await view.render(root(html), ctx);
  assert.ok(calls.some(u => u === '/api/chats?limit=50&paged=1'));
  assert.ok(calls.some(u => u === '/api/chats/c1?limit=40'));
  assert.match(html.v, /Show earlier messages \(90 more\)/);
  assert.doesNotMatch(html.v, /data-more-threads/);
  view._earlier = { c1: 80 }; calls.length = 0;
  await view.render(root({ v: '' }), ctx);
  assert.ok(calls.some(u => u === '/api/chats/c1?limit=120'), 'asking for earlier turns raises the limit by 40 each time');
  const whole = { v: '' };
  await view.render(root(whole), { ...ctx, api: apiWith([[/^\/api\/chats\?/, { items: [], total: 0 }], [/^\/api\/chats\/c1\?/, { id: 'c1', title: 'One', turns, total: 40 }]]) });
  assert.doesNotMatch(whole.v, /Show earlier messages/);
});

test('Notes: a slow answer for an old search, or for a page the user has left, never paints', async () => {
  const { default: page } = await import('../public/js/views/notes.js');
  const view = { ...page };
  let release; const slow = new Promise(r => { release = r; });
  const stub = (q, then) => apiWith([[/^\/api\/notes\?/, async () => { if (then) await then; return { items: [{ id: q, title: q, preview: q }], total: 1 }; }], [/^\/api\/projects$/, []]]);
  const state = { route: 'notes' };
  const html = { v: '' };
  const old = view.render(root(html), { api: stub('old', slow), ui, go() {}, runAgent() {}, params: [], state });
  await view.render(root(html), { api: stub('new'), ui, go() {}, runAgent() {}, params: [], state });
  assert.match(html.v, /Note|new/); assert.doesNotMatch(html.v, />old</);
  release(); await old;
  assert.doesNotMatch(html.v, />old</, 'the older search finished last and was dropped');
  // left for another page while the answer was on its way
  const left = { v: 'ACTIONS PAGE' }; const st2 = { route: 'notes' };
  let rel2; const slow2 = new Promise(r => { rel2 = r; });
  const p = view.render(root(left), { api: stub('late', slow2), ui, go() {}, runAgent() {}, params: [], state: st2 });
  st2.route = 'actions'; rel2(); await p;
  assert.equal(left.v, 'ACTIONS PAGE');
});
