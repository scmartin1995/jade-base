// The meetings pages tell a failed load from an empty list, and one table holds the status words. Rendered into a stand-in root, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem: () => null, setItem() {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ui = { esc, icon: () => '', fmtDate: d => d, projectOptions: () => '' };
const el = () => { const e = { innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, removeEventListener() {}, click() {}, append() {}, appendChild() {}, querySelector: () => el(), querySelectorAll: () => [] }; return e; };
const stub = html => ({ set innerHTML(v) { html.v = v; }, get innerHTML() { return html.v; }, querySelector: sel => (sel === '[data-bin-host]' || (sel === '[data-retry]' && html.v.includes('data-retry')) ? el() : null), querySelectorAll: () => [] });
const { default: panel } = await import('../public/js/views/meetings-panel.js');
const { default: page, statusText, statusDot, isWorking, byNewest } = await import('../public/js/views/meetings.js');

test('the project panel says it could not load, and does not say there are no meetings', async () => {
  const html = { v: '' };
  const err = console.error; console.error = () => {};
  try { await panel.render(stub(html), { api: async () => { throw new Error('Jade stopped answering'); }, ui, go() {} }, { id: 'p1', name: 'Alpha' }); } finally { console.error = err; }
  assert.match(html.v, /data-load-failed/); assert.match(html.v, /Jade stopped answering/);
  assert.doesNotMatch(html.v, /No meetings yet/);
});

test('the project panel still says "No meetings yet" for a list that really is empty', async () => {
  const html = { v: '' };
  await panel.render(stub(html), { api: async () => [], ui, go() {} }, { id: 'p1', name: 'Alpha' });
  assert.match(html.v, /No meetings yet/); assert.doesNotMatch(html.v, /data-load-failed/);
});

test('the Meetings page shows the failure instead of an empty project list', async () => {
  const html = { v: '' };
  const err = console.error; console.error = () => {};
  try { await page.render(stub(html), { api: async () => { throw new Error('boom'); }, ui, go() {} }); } finally { console.error = err; }
  assert.match(html.v, /data-load-failed/); assert.doesNotMatch(html.v, /No meetings yet/); assert.doesNotMatch(html.v, /data-intake/);
});

test('status words, dots and "working" come from one table', () => {
  for (const s of ['queued', 'reading', 'extracting', 'checking', 'repairing']) { assert.equal(isWorking({ status: s }), true); assert.equal(statusDot({ status: s }), 'running'); }
  assert.equal(isWorking({ status: 'review' }), false);
  assert.equal(statusDot({ status: 'failed' }), 'error'); assert.equal(statusDot({ status: 'paused' }), 'cancelled'); assert.equal(statusDot({ status: 'recorded' }), 'done');
  assert.equal(statusText({ status: 'review' }), 'Ready to review');
  assert.match(statusText({ status: 'failed', error: 'x' }), /Could not be read: x/);
  assert.equal(statusText({ status: 'odd' }), 'odd');
});

test('newest first: by date, then by when it was added', () => {
  const l = [{ id: 'a', date: '2026-01-01', createdAt: '1' }, { id: 'b', date: '2026-02-01', createdAt: '1' }, { id: 'c', date: '2026-01-01', createdAt: '2' }];
  assert.deepEqual(l.sort(byNewest).map(m => m.id), ['b', 'c', 'a']);
});

test('a row and the action link render from the summary the list sends (counts, no items)', async () => {
  const { meetingRow } = await import('../public/js/views/meetings.js');
  const { sourceHtml } = await import('../public/js/actionsource.js');
  const esc = s => String(s).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
  const m = { id: 'm1', title: 'Weekly', date: '2026-11-10', status: 'review', project: 'p', recordPath: '/x/Jade/Meetings/Weekly.md', counts: { passed: 3, corrected: 1, notChecked: 0 }, skills: [{ skill: 'action-items', heading: 'Actions', count: 4 }], missedCount: 0 };
  const html = meetingRow(m, { ui: { esc, fmtDate: d => d } });
  assert.match(html, /3 passed · 1 corrected/);
  assert.match(sourceHtml(esc, { source: '/x/Jade/Meetings/Weekly.md' }, [m]), /#\/meeting\/m1/);
});
