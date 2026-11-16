// Chat over HTTP, the way the page uses it: send a message, watch the reply stream in, stop a reply, read the history back.
// The real server runs as a child with a stand-in `claude` (test/helpers), on a free port and a temp home.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpHome } from './helpers/env.js';
import { installFakeClaude } from './helpers/fake-claude.js';
import { startServer, waitFor } from './helpers/server.js';

const t = tmpHome('jade-chat-http-');
const fake = installFakeClaude(t.bin, { putOnPath: false });
let srv;
before(async () => { srv = await startServer({ home: t.home, claudeHome: t.claudeHome, bin: t.bin }); });
after(async () => { await srv?.stop(); t.cleanup(); });

const job = id => srv.get('/api/jobs/' + id).then(r => r.body);
const finished = id => waitFor(async () => { const j = await job(id); return ['done', 'error', 'cancelled'].includes(j?.status) ? j : null; }, { timeout: 15000, message: `job ${id} to finish` });

/** Listen to /api/events; collect what arrives. */
async function listen() {
  const ctl = new AbortController(), events = [];
  const r = await fetch(srv.base + '/api/events', { headers: { 'x-jade': srv.token }, signal: ctl.signal });
  assert.equal(r.status, 200);
  (async () => {
    const dec = new TextDecoder(); let buf = '';
    try { for await (const c of r.body) { buf += dec.decode(c, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const m = /^data: (.*)$/m.exec(buf.slice(0, i)); buf = buf.slice(i + 2); if (m) events.push(JSON.parse(m[1])); } } } catch { /* closed */ }
  })();
  await waitFor(() => events.some(e => e.type === 'hello'), { message: 'the event stream to say hello' });
  return { events, close: () => ctl.abort() };
}

test('a message with no words and nothing attached is refused with a plain message', async () => {
  const r = await srv.post('/api/chat', { message: '   ' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Say something first/);
});

test('sending a message starts a chat, streams the reply as it arrives, and keeps both turns in the history', async () => {
  const ev = await listen();
  try {
    const sent = await srv.post('/api/chat', { message: 'Hello from the test', thread: 'new' });
    assert.equal(sent.status, 200);
    assert.ok(sent.body.id, 'the job is returned');
    assert.ok(sent.body.thread, 'and the chat it went to');
    const done = await finished(sent.body.id);
    assert.equal(done.status, 'done', done.error);
    assert.match(done.result?.text ?? done.output ?? '', /echo: Hello from the test/);
    // the reply came as streamed pieces on the event stream, not only at the end
    const pieces = ev.events.filter(e => e.type === 'job:text' && e.payload.id === sent.body.id);
    assert.ok(pieces.length >= 1, 'the page was sent text while the reply was being written');
    assert.match(pieces.map(p => p.payload.text).join(''), /echo: Hello from the test/);
    // each piece says where it starts and ends in the run's text, joined end to end, and the job answer counts the same way
    let at = 0; for (const p of pieces) { assert.equal(p.payload.from, at, 'each piece starts where the last ended'); at = p.payload.at; }
    assert.equal((await srv.get('/api/jobs/' + sent.body.id)).body.outputLength, at, 'the fetched run is counted the same way');
    assert.ok(ev.events.some(e => e.type === 'job' && e.payload.id === sent.body.id && e.payload.status === 'done'), 'a job event announced the end');
    // history: the PM's turn, then Jade's
    const chat = (await srv.get('/api/chats/' + sent.body.thread)).body;
    const turns = chat.turns.filter(x => !x.step);
    assert.deepEqual(turns.map(x => x.role), ['user', 'jade']);
    assert.equal(turns[0].text, 'Hello from the test');
    assert.match(turns[1].text, /echo: Hello from the test/);
    // and it is in the list of chats
    const list = (await srv.get('/api/chats')).body;
    assert.ok(list.some(c => c.id === sent.body.thread));
    // the engine was really asked: the stand-in saw the message
    assert.ok(fake.calls().some(c => /Hello from the test/.test(c.stdin)));
  } finally { ev.close(); }
});

test('a second message in the same chat goes to the same chat and is added to the history', async () => {
  const a = (await srv.post('/api/chat', { message: 'first question', thread: 'new' })).body;
  await finished(a.id);
  const b = (await srv.post('/api/chat', { message: 'second question', thread: a.thread })).body;
  assert.equal(b.thread, a.thread);
  await finished(b.id);
  const chat = (await srv.get('/api/chats/' + a.thread)).body;
  assert.deepEqual(chat.turns.filter(x => !x.step).map(x => x.text.replace(/^echo: .*/, 'echo')), ['first question', 'echo', 'second question', 'echo']);
});

test('stopping a reply that is still being written ends the job as cancelled and the chat can carry on', async () => {
  const sent = (await srv.post('/api/chat', { message: 'please HANG forever', thread: 'new' })).body;
  await waitFor(async () => (await job(sent.id))?.status === 'running', { message: 'the reply to start' });
  await waitFor(() => fake.calls().some(c => /HANG/.test(c.stdin)), { message: 'the engine to receive the message' });
  assert.equal((await srv.post(`/api/jobs/${sent.id}/cancel`)).status, 200);
  const done = await finished(sent.id);
  assert.equal(done.status, 'cancelled');
  // the chat still works afterwards
  const next = (await srv.post('/api/chat', { message: 'are you still there', thread: sent.thread })).body;
  assert.equal((await finished(next.id)).status, 'done');
  const turns = (await srv.get('/api/chats/' + sent.thread)).body.turns.filter(x => x.role === 'jade');
  assert.match(turns.at(-1).text, /echo: are you still there/);
});

test('chats can be renamed and deleted, and a chat that does not exist answers 404', async () => {
  const c = (await srv.post('/api/chats', { title: 'Plan' })).body;
  assert.ok(c.id);
  await srv.patch('/api/chats/' + c.id, { title: 'Renamed plan' });
  assert.equal((await srv.get('/api/chats/' + c.id)).body.title, 'Renamed plan');
  assert.equal((await srv.del('/api/chats/' + c.id)).status, 200);
  assert.equal((await srv.get('/api/chats/' + c.id)).status, 404);
});

test('without the key the chat routes answer 401 or 403', async () => {
  assert.equal((await srv.get('/api/chats', { 'x-jade': 'wrong' })).status, 401);
  assert.equal((await srv.post('/api/chat', { message: 'hi' }, { 'x-jade': 'wrong' })).status, 403);
});
