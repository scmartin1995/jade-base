// The list pages' paging and "newest answer wins" rules (public/js/paging.js), as plain functions, and the server's paged answers over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { showing, pageOf, hasMore, nextSize, createLatest } from '../public/js/paging.js';
import { tmpHome, put } from './helpers/env.js';
import { startServer } from './helpers/server.js';

test('showing says how many of how many, and nothing when all are shown', () => {
  assert.equal(showing(50, 312), 'Showing 50 of 312');
  assert.equal(showing(50, 312, 'notes'), 'Showing 50 of 312 notes');
  assert.equal(showing(30, 30), '');
  assert.equal(showing(0, 0), '');
});

test('pageOf takes { items, total } or an old plain list, and the total is never below what came', () => {
  assert.deepEqual(pageOf({ items: [1, 2], total: 9 }), { items: [1, 2], total: 9 });
  assert.deepEqual(pageOf([1, 2, 3]), { items: [1, 2, 3], total: 3 });
  assert.deepEqual(pageOf({ items: [1, 2, 3], total: 1 }), { items: [1, 2, 3], total: 3 });
  assert.deepEqual(pageOf(null), { items: [], total: 0 });
});

test('more is judged by the total, so a page that stopped at a server cap still says there is more', () => {
  assert.equal(hasMore(500, 800), true, 'a full page at the old 500 cap');
  assert.equal(hasMore(800, 800), false);
});

test('asking for more grows to the end and never past it, so it cannot get stuck below the total', () => {
  let n = 3000; const total = 7000, seen = [];
  while (hasMore(n, total)) { n = nextSize(n, 3000, total); seen.push(n); if (seen.length > 10) assert.fail('does not finish'); }
  assert.deepEqual(seen, [6000, 7000]);
});

test('only the newest request may draw; leaving the page makes every one stale', () => {
  const latest = createLatest();
  const a = latest.begin(), b = latest.begin();
  assert.equal(a(), false, 'the older search is dropped, whichever answers first');
  assert.equal(b(), true);
  latest.cancel();
  assert.equal(b(), false);
});

const t = tmpHome('jade-paging-');
let srv;
before(async () => {
  put(path.join(t.home, 'actions.json'), JSON.stringify(Array.from({ length: 1200 }, (_, i) => ({ id: `a-${i}`, text: `Action ${i}`, project: '', owner: '', due: '', priority: 'normal', status: 'open', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' }))));
  for (let i = 0; i < 620; i++) put(path.join(t.home, 'notes', `2026-01-01-note-${i}.md`), `---\ntitle: Note ${i}\n---\n\nbody ${i}\n`);
  srv = await startServer({ home: t.home, claudeHome: t.claudeHome, bin: t.bin });
});
after(async () => { await srv?.stop(); t.cleanup(); });

test('actions: paged=1 gives the true total and has no cap, so counts and "Show more" are right beyond 1000', async () => {
  const r = (await srv.get('/api/actions?status=open&paged=1&limit=1000000')).body;
  assert.equal(r.total, 1200); assert.equal(r.items.length, 1200);
  const page = (await srv.get('/api/actions?status=open&paged=1&limit=100&offset=1150')).body;
  assert.equal(page.total, 1200); assert.equal(page.items.length, 50);
  assert.equal((await srv.get('/api/actions?status=open&limit=5000')).body.length, 1000, 'without paged: still capped, as before');
});

test('notes: paged=1 gives the total and goes past 500; without it the answer is the same plain list', async () => {
  const r = (await srv.get('/api/notes?paged=1&limit=600')).body;
  assert.equal(r.total, 620); assert.equal(r.items.length, 600);
  assert.equal((await srv.get('/api/notes?limit=600')).body.length, 500);
});

test('the file map page can ask for more than 5000 (no cap)', async () => {
  const r = (await srv.get('/api/memory/files?limit=9000')).body;
  assert.equal(typeof r.total, 'number'); assert.ok(r.files.length <= r.total);
});
