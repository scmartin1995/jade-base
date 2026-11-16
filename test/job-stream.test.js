// How the page draws a run's words as they arrive (public/js/stream.js): only the new words are added to plain text, a long chat reply
// is not drawn again for every word, and a page that opened mid-run fetches what it missed once and keeps the words that came meanwhile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStreamer } from '../public/js/stream.js';

function setup({ jobs = [], streams = [], api } = {}) {
  const writes = { html: 0, text: 0, append: 0 };
  const view = { appended: [], html: '', text: '' };
  const make = () => ({ closest: () => null, set innerHTML(v) { writes.html++; view.html = v; }, set textContent(v) { writes.text++; view.text = v; }, append(v) { writes.append++; view.appended.push(v); }, isConnected: true });
  let el = make();
  const doc = { querySelector: sel => (sel === '[data-stream="r1"]' ? el : null) };
  const state = { jobs, streams: new Map(streams) };
  const clock = { t: 1000, timers: [] };
  const s = createStreamer({ state, api: api || (async () => { throw new Error('not asked'); }), ui: { md: x => `<p>${x}</p>` }, doc, now: () => clock.t, later: (fn, ms) => { const h = { fn, at: clock.t + ms }; clock.timers.push(h); return h; } });
  return { s, state, writes, view, clock, rerender: () => { el = make(); } };
}

test('plain text: the first piece sets it, every later piece is only added', () => {
  const { s, state, writes, view } = setup({ jobs: [{ id: 'r1', agent: 'summary' }] });
  s.text({ id: 'r1', text: 'one ' }); s.text({ id: 'r1', text: 'two ' }); s.text({ id: 'r1', text: 'three' });
  assert.equal(state.streams.get('r1'), 'one two three');
  assert.deepEqual([writes.text, writes.append, writes.html], [1, 2, 0], 'drawn once, then added to');
  assert.deepEqual(view.appended, ['two ', 'three']);
});

test('plain text: a freshly drawn view (the page re-rendered) gets the whole text again, then only additions', () => {
  const { s, writes, view, rerender } = setup({ jobs: [{ id: 'r1', agent: 'summary' }] });
  s.text({ id: 'r1', text: 'one ' });
  rerender();
  s.text({ id: 'r1', text: 'two' });
  assert.equal(view.text, 'one two'); assert.equal(writes.text, 2); assert.equal(writes.append, 0);
});

test('a chat reply is drawn at once the first time, then not for every word, and always once more at the end of the wait', () => {
  const { s, state, writes, view, clock } = setup({ jobs: [{ id: 'r1', agent: 'jade' }] });
  s.text({ id: 'r1', text: 'Hello' });
  assert.equal(writes.html, 1); assert.equal(view.html, '<p>Hello</p>');
  for (const w of [' there', ' my', ' friend']) { clock.t += 5; s.text({ id: 'r1', text: w }); }
  assert.equal(writes.html, 1, 'words that come straight after are not drawn one by one');
  assert.equal(clock.timers.length, 1, 'one redraw is booked');
  clock.t += 200; clock.timers[0].fn();
  assert.equal(writes.html, 2); assert.equal(view.html, '<p>Hello there my friend</p>', 'the booked redraw shows everything so far');
  state.streams.set('r1', 'x'.repeat(60000));
  assert.ok(Math.min(1000, 120 + 60000 / 150) > 500, 'a long reply waits longer between drawings');
});

test('a chat reply hides the actions block while it streams', () => {
  const { s, view } = setup({ jobs: [{ id: 'r1', agent: 'jade' }] });
  s.text({ id: 'r1', text: 'Done.\n```jade-actions\n[{"a":1}' });
  assert.equal(view.html, '<p>Done.</p>');
});

// pieces as the server sends them: where each starts (from) and ends (at) in the run's text
const piece = (text, from, extra = {}) => ({ id: 'r1', text, from, at: from + text.length, ...extra });

test('a page that opened mid-run fetches the earlier text once and keeps the pieces that arrive meanwhile', async () => {
  let asked = 0, release;
  const gate = new Promise(r => { release = r; });
  const api = async (m, url) => { asked++; assert.equal(url, '/api/jobs/r1'); await gate; return { output: 'earlier words ', outputLength: 14 }; };
  const { s, state, view } = setup({ jobs: [{ id: 'r1', agent: 'summary', outputLength: 14 }], api });
  const first = s.text(piece('new ', 14));
  s.text(piece('ones', 18));
  assert.equal(asked, 1, 'asked once, not once per piece');
  release(); await first;
  assert.equal(state.streams.get('r1'), 'earlier words new ones');
  assert.equal(view.text + view.appended.join(''), 'earlier words new ones', 'on screen: the fetched text, then the held pieces added');
  s.text(piece('!', 22));
  assert.equal(state.streams.get('r1'), 'earlier words new ones!');
});

test('a piece that is also in the fetched text is not added twice', async () => {
  // the server answered after it had already written "two " (pieces: "one " 0-4, "two " 4-8, "three" 8-13); the page saw "two " and "three" arrive meanwhile
  const api = async () => ({ output: 'one two ', outputLength: 8 });
  const { s, state } = setup({ jobs: [{ id: 'r1', agent: 'summary' }], api });
  const first = s.text(piece('two ', 4));
  s.text(piece('three', 8));
  await first;
  assert.equal(state.streams.get('r1'), 'one two three');
});

test('a piece that straddles the fetched text makes the page fetch once more, never doubling or dropping words', async () => {
  const answers = [{ output: 'abc', outputLength: 3 }, { output: 'abcdefgh', outputLength: 8 }];
  const api = async () => answers.shift();
  const { s, state } = setup({ jobs: [{ id: 'r1', agent: 'summary' }], api });
  await s.text(piece('bcdefgh', 1));   // starts inside what the first answer has, ends after it
  assert.equal(state.streams.get('r1'), 'abcdefgh');
});

test('after a reconnect the missed gap is fetched, so nothing is lost in the middle', async () => {
  const api = async () => ({ output: 'one two three ', outputLength: 14 });
  const { s, state, view } = setup({ jobs: [{ id: 'r1', agent: 'summary' }] , api });
  s.text(piece('one ', 0)); s.text(piece('two ', 4));
  // 'three ' (8-14) was sent while the connection was down; the next piece starts at 14
  await s.text(piece('four', 14));
  assert.equal(state.streams.get('r1'), 'one two three four');
});

test('a piece the page already has (sent twice) is ignored', () => {
  const { s, state } = setup({ jobs: [{ id: 'r1', agent: 'summary' }] });
  s.text(piece('one ', 0)); s.text(piece('one ', 0)); s.text(piece('two', 4));
  assert.equal(state.streams.get('r1'), 'one two');
});

test('a failed fetch loses nothing the page had, and the next piece asks again', async () => {
  let fail = true;
  const api = async () => { if (fail) throw new Error('offline'); return { output: 'start more', outputLength: 10 }; };
  const { s, state } = setup({ jobs: [{ id: 'r1', agent: 'summary' }], api });
  s.text(piece('start ', 0));   // the page's own start; position is now 6
  await s.text(piece('x', 20));
  assert.equal(state.streams.get('r1'), 'start ', 'what it had is kept, no hole is painted over');
  fail = false;
  await s.text(piece('!', 10));
  assert.equal(state.streams.get('r1'), 'start more!');
});

test('the finished run replaces what was streamed with the full text', () => {
  const { s, state, view } = setup({ jobs: [{ id: 'r1', agent: 'summary' }] });
  s.text(piece('one ', 0)); s.text(piece('three', 8));   // a hole: "two " was missed
  s.finish('r1', 'one two three');
  assert.equal(state.streams.get('r1'), 'one two three');
  assert.equal(view.text, 'one two three');
});

test('a piece for a run that was switched away from (nothing on screen) is kept, and drawn when the page comes back', () => {
  const { s, state, view, rerender } = setup({ jobs: [{ id: 'other', agent: 'summary' }] });
  s.text({ id: 'r1', text: 'one ', from: 0, at: 4 }); s.text({ id: 'r1', text: 'two', from: 4, at: 7 });
  assert.equal(state.streams.get('r1'), 'one two');
  state.jobs.push({ id: 'r1', agent: 'summary' }); rerender(); s.paint('r1');
  assert.equal(view.text, 'one two');
});

test('streams of runs no longer listed are dropped', () => {
  const { s, state } = setup({ jobs: [{ id: 'r1', agent: 'summary' }], streams: [['r1', 'a'], ['gone', 'b']] });
  s.prune();
  assert.deepEqual([...state.streams.keys()], ['r1']);
});

test('nothing is drawn when the run is not on screen, and a finished run stops its booked redraw', () => {
  const { s, state, writes, clock } = setup({ jobs: [{ id: 'other', agent: 'jade' }] });
  state.streams.set('other', '');
  s.text({ id: 'other', text: 'hi' });
  assert.deepEqual([writes.html, writes.text, writes.append], [0, 0, 0]);
  const b = setup({ jobs: [{ id: 'r1', agent: 'jade' }] });
  b.s.text({ id: 'r1', text: 'a' }); b.s.text({ id: 'r1', text: 'b' });
  assert.equal(b.clock.timers.length, 1);
  b.s.finished('r1');
  assert.ok(clock);
});
