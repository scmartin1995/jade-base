// Notes, actions and chats over HTTP, as the pages ask for them: pages of a list, the old answers still there, data from an earlier build
// (one big chats.json, an indented jobs.json) read as it is, and a running reply's events carrying only what is new.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpHome, put } from './helpers/env.js';
import { installFakeClaude } from './helpers/fake-claude.js';
import { startServer, waitFor } from './helpers/server.js';

const t = tmpHome('jade-store-routes-');
const fake = installFakeClaude(t.bin, { putOnPath: false });
const proj = { id: 'p1', name: 'Alpha', description: '', owner: '', folders: [], links: [], tags: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
put(path.join(t.home, 'projects', 'p1.json'), JSON.stringify(proj));
for (let i = 0; i < 30; i++) put(path.join(t.home, 'notes', `2026-01-${String(i + 1).padStart(2, '0')}-note-${i}.md`), `---\ntitle: Note ${i}\nproject: ${i % 2 ? 'p1' : ''}\n---\n\n${'long body '.repeat(80)}tail${i}\n`);
put(path.join(t.home, 'actions.json'), JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ id: `a-${i}`, text: `Action ${i}`, project: i % 4 ? 'p1' : '', owner: i % 3 ? 'Pat' : 'Sam', due: i % 5 ? `2031-01-${String(1 + (i % 28)).padStart(2, '0')}` : '', priority: 'normal', status: i % 6 ? 'open' : 'done', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' })), null, 2));
// what an earlier build kept: every conversation in one indented file, and the recent runs indented
const turns = c => Array.from({ length: 120 }, (_, i) => ({ at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), role: i % 2 ? 'jade' : 'user', text: `chat ${c} turn ${i}` }));
put(path.join(t.home, '.state', 'chats.json'), JSON.stringify({ threads: Array.from({ length: 6 }, (_, c) => ({ id: `c-${c}`, title: `Chat ${c}`, titled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: `2026-01-0${c + 1}T00:00:00.000Z`, turns: turns(c) })) }, null, 2));
put(path.join(t.home, '.state', 'jobs.json'), JSON.stringify([{ id: 'j-old', agent: 'jade', agentName: 'Jade', title: 'Old run', input: {}, trigger: 'chat', engine: 'claude', model: '', status: 'done', output: 'old answer', tools: [], createdAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z' }], null, 2));

let srv;
before(async () => { srv = await startServer({ home: t.home, claudeHome: t.claudeHome, bin: t.bin }); });
after(async () => { await srv?.stop(); t.cleanup(); });
const get = async p => { const r = await srv.get(p); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };

test('notes: a page at a time, without their text, newest first, filtered by the server', async () => {
  const page = await get('/api/notes?limit=10');
  assert.equal(page.length, 10);
  assert.ok(page.every(n => !('body' in n) && n.preview.length <= 220 && n.preview.trim().startsWith('long body') && n.title && n.updated));
  const all = await get('/api/notes?limit=500');
  assert.equal(all.length, 30);
  assert.deepEqual(all.slice(0, 10).map(n => n.id), page.map(n => n.id));
  assert.deepEqual((await get('/api/notes?limit=5&offset=10')).map(n => n.id), all.slice(10, 15).map(n => n.id));
  assert.equal((await get('/api/notes?project=p1&limit=500')).length, 15);
  assert.deepEqual((await get('/api/notes?q=note%2012')).map(n => n.title), ['Note 12']);
  assert.equal((await get('/api/notes')).length, 30, 'with no limit: up to 200');
  assert.match(JSON.stringify(await get('/api/notes/' + all[0].id)), /tail/, 'one note still comes whole');
});

test('notes: one saved over HTTP shows in the next list, and a file added by hand does too', async () => {
  const made = (await srv.post('/api/notes', { title: 'Made over HTTP', body: 'hello' })).body;
  assert.equal((await get('/api/notes?q=made%20over')).length, 1);
  await srv.post('/api/notes', { title: 'Made over HTTP', body: 'hello again' });   // the same title on the same day: the same note, updated
  assert.match((await get('/api/notes/' + made.id)).body, /hello again/);
  put(path.join(t.home, 'notes', 'by-hand.md'), '---\ntitle: Typed by hand\n---\n\nin an editor\n');
  assert.equal((await get('/api/notes?q=typed%20by%20hand')).length, 1);
  fs.rmSync(path.join(t.home, 'notes', 'by-hand.md'));
  assert.equal((await get('/api/notes?q=typed%20by%20hand')).length, 0);
});

test('actions: with no filter every action, as before; with a filter a page, soonest due first', async () => {
  const all = await get('/api/actions');
  assert.equal(all.length, 120);
  const open = await get('/api/actions?status=open&limit=500');
  assert.equal(open.length, all.filter(a => a.status !== 'done').length);
  assert.deepEqual(open.map(a => a.due || '9999'), [...open.map(a => a.due || '9999')].sort());
  assert.equal((await get('/api/actions?status=done')).every(a => a.status === 'done'), true);
  assert.equal((await get('/api/actions?status=open&project=p1&owner=Pat&limit=500')).every(a => a.project === 'p1' && a.owner === 'Pat' && a.status !== 'done'), true);
  assert.equal((await get('/api/actions?status=all&limit=7&offset=5')).length, 7);
  assert.equal((await get('/api/actions?q=ACTION%2011&status=all')).length, 11, 'Action 11 and Action 110 to 119');
  assert.deepEqual(await get('/api/actions/owners'), ['Pat', 'Sam']);
  const added = (await srv.post('/api/actions', { text: 'Brand new', owner: 'Zed' })).body;
  assert.ok((await get('/api/actions?q=brand%20new')).some(a => a.id === added.id));
  assert.ok((await get('/api/actions/owners')).includes('Zed'));
});

test('the project page sends the notes without text and the open actions with the latest finished ones', async () => {
  const d = await get('/api/projects/p1');
  assert.equal(d.notes.length, 15); assert.ok(d.notes.every(n => !('body' in n) && n.project === 'p1'));
  assert.ok(d.actions.every(a => a.project === 'p1'));
  assert.equal(d.actions.filter(a => a.status === 'done').length <= 3, true);
  const open = (await get('/api/actions')).filter(a => a.project === 'p1' && a.status !== 'done');
  assert.equal(d.actions.filter(a => a.status !== 'done').length, open.length);
});

test('chats: conversations from the old single file are all there; a page of the list; the last turns of one', async () => {
  const list = await get('/api/chats');
  assert.deepEqual(list.map(c => c.id), ['c-5', 'c-4', 'c-3', 'c-2', 'c-1', 'c-0']);
  assert.equal(list[0].count, 120); assert.equal(list[0].preview, 'chat 5 turn 119');
  assert.deepEqual((await get('/api/chats?limit=2&offset=1')).map(c => c.id), ['c-4', 'c-3']);
  assert.deepEqual((await get('/api/chats?q=chat%202')).map(c => c.id), ['c-2']);
  const whole = await get('/api/chats/c-1');
  assert.equal(whole.turns.length, 120); assert.equal('total' in whole, false, 'without limit the answer is the same as before');
  const last = await get('/api/chats/c-1?limit=40');
  assert.equal(last.turns.length, 40); assert.equal(last.total, 120);
  assert.deepEqual(last.turns, whole.turns.slice(-40));
  assert.equal((await get('/api/chats/c-1?limit=500')).turns.length, 120);
  assert.equal((await srv.get('/api/chats/nope?limit=5')).status, 404);
  assert.ok(fs.existsSync(path.join(t.home, '.state', 'chats', 'c-1.json')));
  assert.ok(fs.existsSync(path.join(t.home, '.state', 'chats.json.migrated')));
});

test('a search for a word that is in no conversation reads from memory, and finds the ones that have it', async () => {
  assert.deepEqual(await get('/api/search?q=zzzznotthere&kinds=chat'), []);
  const hits = await get('/api/search?q=turn%20117&kinds=chat&limit=20');
  assert.equal(hits.length, 6, 'a few of the conversations that have it');
  assert.ok(hits.every(h => h.kind === 'chat' && h.path.startsWith('#/chat/')));
});

/** Listen to /api/events; collect what arrives. */
async function listen() {
  const ctl = new AbortController(), events = [];
  const r = await fetch(srv.base + '/api/events', { headers: { 'x-jade': srv.token }, signal: ctl.signal });
  (async () => {
    const dec = new TextDecoder(); let buf = '';
    try { for await (const c of r.body) { buf += dec.decode(c, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const m = /^data: (.*)$/m.exec(buf.slice(0, i)); buf = buf.slice(i + 2); if (m) events.push(JSON.parse(m[1])); } } } catch { /* closed */ }
  })();
  await waitFor(() => events.some(e => e.type === 'hello'), { message: 'the event stream to say hello' });
  return { events, close: () => ctl.abort() };
}

test('a reply in progress tells the page only what is new; the finished run carries all of it', async () => {
  const ev = await listen();
  try {
    const sent = (await srv.post('/api/chat', { message: 'Say something', thread: 'c-0' })).body;
    const done = await waitFor(async () => { const j = (await srv.get('/api/jobs/' + sent.id)).body; return j?.status === 'done' ? j : null; }, { timeout: 15000, message: 'the reply' });
    const mine = ev.events.filter(e => e.type === 'job' && e.payload.id === sent.id).map(e => e.payload);
    await waitFor(() => ev.events.some(e => e.type === 'job' && e.payload.id === sent.id && e.payload.status === 'done'), { message: 'the finished event' });
    const going = mine.filter(p => !['done', 'error', 'cancelled'].includes(p.status));
    assert.ok(going.length >= 2, 'queued and running events');
    for (const p of going) { assert.equal(p.output, undefined, 'no text repeated while it is going'); assert.equal(typeof p.outputLength, 'number'); }
    const last = ev.events.filter(e => e.type === 'job' && e.payload.id === sent.id).at(-1).payload;
    assert.equal(last.status, 'done'); assert.match(last.output, /echo: Say something/);
    assert.equal(last.output, done.output);
    const text = ev.events.filter(e => e.type === 'job:text' && e.payload.id === sent.id).map(e => e.payload.text).join('');
    assert.match(text, /echo: Say something/, 'the words came as pieces');
  } finally { ev.close(); }
});

test('the recent runs: an indented jobs.json from an earlier build is read, and new runs are saved compactly', async () => {
  assert.equal((await get('/api/jobs/j-old')).output, 'old answer');
  const sent = (await srv.post('/api/chat', { message: 'one more', thread: 'c-0' })).body;
  await waitFor(async () => (await srv.get('/api/jobs/' + sent.id)).body?.status === 'done', { timeout: 15000, message: 'the reply' });
  const file = path.join(t.home, '.state', 'jobs.json');
  await waitFor(() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).some(j => j.id === sent.id && j.status === 'done'); } catch { return false; } }, { message: 'jobs.json to hold the finished run' });
  const text = fs.readFileSync(file, 'utf8');
  const saved = JSON.parse(text);
  assert.ok(saved.some(j => j.id === 'j-old' && j.output === 'old answer'));
  assert.ok(!text.includes('\n'), 'compact');
});

test('a message goes into the chat it was sent to and into no other file', async () => {
  const stamp = id => fs.statSync(path.join(t.home, '.state', 'chats', id + '.json')).mtimeMs;
  const before = { c1: stamp('c-1'), c2: stamp('c-2') };
  const sent = (await srv.post('/api/chat', { message: 'only for chat four', thread: 'c-4' })).body;
  await waitFor(async () => (await srv.get('/api/jobs/' + sent.id)).body?.status === 'done', { timeout: 15000, message: 'the reply' });
  const c4 = await get('/api/chats/c-4');
  assert.deepEqual(c4.turns.slice(-2).map(x => x.role), ['user', 'jade']);
  assert.equal(c4.turns.at(-2).text, 'only for chat four');
  assert.equal(stamp('c-1'), before.c1); assert.equal(stamp('c-2'), before.c2);
  assert.ok(fake.calls().length > 0);
});
