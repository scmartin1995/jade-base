// Conversations: one file each, moved over safely from the old single chats.json, written one at a time, never lost to a cut-short save.
// Through the store's public functions; a "restart" is a second copy of the module reading the same folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { NO_READ_ONLY } from './helpers/env.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-chats-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
config.load();
const STATE = config.STATE;
const dir = path.join(STATE, 'chats');
let n = 0;
const fresh = async () => { const s = await import(`../server/core/store.js?restart=${++n}`); s.init(); return s; };
const isRoot = process.getuid?.() === 0;

// what an earlier build wrote: every conversation in one indented file
const turn = (i, role, text, extra = {}) => ({ at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), role, text, via: 'text', ...extra });
const old = { threads: [
  { id: 'c-0', title: 'Budget talk', titled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', turns: [turn(0, 'user', 'What is the budget?'), turn(1, 'jade', 'It is   large.\nReally large.', { job: 'j1' })] },
  { id: 'c-1', title: 'Risks', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z', model: 'm-x', effort: 'high', turns: [turn(0, 'user', 'List the risks')] },
  { id: 'c-2', title: 'Empty one', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', turns: [] },
] };
const oldText = JSON.stringify(old, null, 2);
fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(path.join(STATE, 'chats.json'), oldText);
const preview = ts => (ts.at(-1)?.text || '').replace(/\s+/g, ' ').slice(0, 120);

const store = await fresh();

test('an old chats.json is moved into one file per conversation, with every answer the same, and kept as a backup', async () => {
  assert.deepEqual(fs.readdirSync(dir).sort(), ['c-0.json', 'c-1.json', 'c-2.json']);
  assert.equal(fs.existsSync(path.join(STATE, 'chats.json')), false, 'no longer the file in use');
  assert.equal(fs.readFileSync(path.join(STATE, 'chats.json.migrated'), 'utf8'), oldText, 'the backup is the old file, byte for byte');
  for (const t of old.threads) assert.deepEqual(JSON.parse(JSON.stringify(store.getThread(t.id))), t, `conversation ${t.id} is whole`);
  const list = store.listThreads();
  assert.deepEqual(list.map(t => t.id), ['c-1', 'c-0', 'c-2'], 'newest first');
  for (const t of old.threads) {
    const { turns, ...rest } = t;
    assert.deepEqual(JSON.parse(JSON.stringify(list.find(x => x.id === t.id))), { ...rest, count: turns.length, preview: preview(turns) });
  }
  // a start after the move does not move anything again
  const again = await fresh();
  assert.deepEqual(again.listThreads().map(t => t.id), ['c-1', 'c-0', 'c-2']);
  assert.equal(fs.readdirSync(STATE).filter(f => f.startsWith('chats.json')).length, 1);
});

test('a message writes that conversation only; the others are not touched', () => {
  const old = new Date('2020-01-01T00:00:00Z');
  for (const f of ['c-0.json', 'c-2.json']) fs.utimesSync(path.join(dir, f), old, old);
  const before = fs.readFileSync(path.join(dir, 'c-0.json'), 'utf8');
  store.appendTurn('c-1', { role: 'user', text: 'and the issues?' });
  assert.equal(fs.statSync(path.join(dir, 'c-0.json')).mtimeMs, old.getTime());
  assert.equal(fs.statSync(path.join(dir, 'c-2.json')).mtimeMs, old.getTime());
  assert.equal(fs.readFileSync(path.join(dir, 'c-0.json'), 'utf8'), before);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'c-1.json'), 'utf8'));
  assert.deepEqual(saved.turns.map(t => t.text), ['List the risks', 'and the issues?']);
  assert.equal(fs.existsSync(path.join(STATE, 'chats.json')), false, 'the old single file is not written again');
  assert.ok(!fs.readFileSync(path.join(dir, 'c-1.json'), 'utf8').includes('\n'), 'compact, one line');
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), [], 'no temporary file is left behind');
});

test('titles, previews, counts, marks and settings are what they were, and all of it survives a restart', async () => {
  const t = store.newThread();
  store.appendTurn(t.id, { role: 'user', text: 'Plan the launch\nplease' });
  await new Promise(r => setTimeout(r, 5));   // turns are found by their time stamp
  const reply = store.appendTurn(t.id, { role: 'jade', text: 'Sure.' }).turns[1];
  assert.equal(store.getThread(t.id).title, 'Plan the launch please', 'titled by the first thing typed');
  store.markTurn(t.id, reply.at, { touched: [{ path: '/x' }] });
  store.updateThread(t.id, { model: 'm-y', effort: 'low' });
  store.updateThread('c-0', { title: 'Renamed' });
  store.appendTurn('c-0', { role: 'user', text: 'still here' });
  assert.equal(store.getThread('c-0').title, 'Renamed', 'a chosen title is kept');
  const again = await fresh();
  assert.deepEqual(JSON.parse(JSON.stringify(again.getThread(t.id))), JSON.parse(JSON.stringify(store.getThread(t.id))));
  assert.deepEqual(again.getThread(t.id).turns[1].touched, [{ path: '/x' }]);
  assert.equal(again.getThread(t.id).model, 'm-y');
  assert.deepEqual(JSON.parse(JSON.stringify(again.listThreads())), JSON.parse(JSON.stringify(store.listThreads())));
  assert.equal(again.listThreads().find(x => x.id === t.id).count, 2);
  assert.equal(store.markTurn(t.id, 'no-such-time', { a: 1 }), null);
  store.deleteThread(t.id);
  assert.equal(store.getThread(t.id), null);
  assert.equal(fs.existsSync(path.join(dir, `${t.id}.json`)), false);
  assert.equal((await fresh()).getThread(t.id), null);
});

test('a conversation keeps its last 200 turns, and a turn is hidden of keys as before', () => {
  const t = store.newThread('Long');
  for (let i = 0; i < 205; i++) store.appendTurn(t.id, { role: i % 2 ? 'jade' : 'user', text: `turn ${i}` });
  const got = store.getThread(t.id);
  assert.equal(got.turns.length, 200);
  assert.equal(got.turns[0].text, 'turn 5');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, `${t.id}.json`), 'utf8')).turns.length, 200);
  const k = store.appendTurn(t.id, { role: 'jade', text: 'the key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }).turns.at(-1);
  assert.doesNotMatch(k.text, /abcdefghijklmnopqrstuvwxyz0123456789/);
});

test('a returned conversation cannot be changed by accident (it is the remembered copy)', () => {
  const t = store.getThread('c-0');
  assert.throws(() => { t.turns.push({}); }, TypeError);
  assert.throws(() => { t.turns[0].text = 'x'; }, TypeError);
});

test('more conversations than are kept in memory all still read back right', async () => {
  const ids = [];
  for (let i = 0; i < 90; i++) { const t = store.newThread(`many ${i}`); store.appendTurn(t.id, { role: 'user', text: `hello ${i}` }); ids.push(t.id); }
  for (const [i, id] of ids.entries()) assert.equal(store.getThread(id).turns[0].text, `hello ${i}`);
  const again = await fresh();
  for (const [i, id] of ids.entries()) assert.equal(again.getThread(id).turns[0].text, `hello ${i}`);
  assert.equal(again.listThreads({ limit: 5 }).length, 5);
  assert.equal(again.listThreads({ q: 'many 77' }).length, 1);
  assert.equal(again.listThreads({ limit: 10, offset: 88 }).length, again.listThreads().length - 88);
});

test('a save that was cut short leaves the old conversation whole; a temporary file and a damaged file do not stop the rest', async () => {
  const before = fs.readFileSync(path.join(dir, 'c-1.json'), 'utf8');
  fs.writeFileSync(path.join(dir, '.c-1.json.99999.1.tmp'), '{"id":"c-1","tit');   // what a crash during a save leaves
  fs.writeFileSync(path.join(dir, 'broken.json'), '{"id": "broken", "turns": [');
  const err = console.error; console.error = () => {};
  let again; try { again = await fresh(); } finally { console.error = err; }
  assert.equal(fs.readFileSync(path.join(dir, 'c-1.json'), 'utf8'), before);
  assert.ok(again.getThread('c-1').turns.length >= 2);
  assert.equal(again.getThread('broken'), null);
  assert.equal(fs.readFileSync(path.join(dir, 'broken.json'), 'utf8'), '{"id": "broken", "turns": [', 'a damaged file is left as it is');
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), [], 'the leftover temporary file is cleared');
});

test('the single-conversation chat.json of the earliest builds moves over once', async () => {
  const s2 = path.join(tmp, 'second');
  // a separate data folder, so use a child process that imports the store fresh
  const { spawnSync } = await import('node:child_process');
  fs.mkdirSync(path.join(s2, 'home', '.state'), { recursive: true });
  fs.writeFileSync(path.join(s2, 'home', '.state', 'chat.json'), JSON.stringify({ turns: [turn(0, 'user', 'an old question'), turn(1, 'jade', 'an old answer')] }, null, 2));
  const code = `const store = await import(${JSON.stringify(new URL('../server/core/store.js', import.meta.url).href)}); store.init();
    const l = store.listThreads(); console.log(JSON.stringify({ n: l.length, title: l[0]?.title, turns: store.getThread(l[0].id).turns.length }));`;
  const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, JADE_HOME: path.join(s2, 'home'), JADE_CLAUDE_HOME: path.join(s2, 'claude') }, encoding: 'utf8' });
  const r = run(); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { n: 1, title: 'an old question', turns: 2 });
  assert.ok(fs.existsSync(path.join(s2, 'home', '.state', 'chat.json.migrated')));
  fs.rmSync(path.join(s2, 'home', '.state', 'chats'), { recursive: true });   // every conversation deleted later must not bring the old one back
  const r2 = run(); assert.equal(r2.status, 1, 'no conversation to list, so nothing came back');
  assert.equal(fs.existsSync(path.join(s2, 'home', '.state', 'chat.json')), false);
});

test('if the move cannot be done, the old file is kept as it was and nothing is lost', { skip: NO_READ_ONLY || (isRoot && 'the folder cannot be made read-only for root') }, async () => {
  const s3 = path.join(tmp, 'third'); const st = path.join(s3, 'home', '.state');
  fs.mkdirSync(path.join(st, 'chats'), { recursive: true });
  fs.writeFileSync(path.join(st, 'chats.json'), oldText);
  fs.chmodSync(path.join(st, 'chats'), 0o500);
  const { spawnSync } = await import('node:child_process');
  const code = `const store = await import(${JSON.stringify(new URL('../server/core/store.js', import.meta.url).href)}); store.init();`;
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, JADE_HOME: path.join(s3, 'home'), JADE_CLAUDE_HOME: path.join(s3, 'claude') }, encoding: 'utf8' });
    assert.match(r.stderr, /old file was kept/);
    assert.equal(fs.readFileSync(path.join(st, 'chats.json'), 'utf8'), oldText);
    assert.equal(fs.existsSync(path.join(st, 'chats.json.migrated')), false);
  } finally { fs.chmodSync(path.join(st, 'chats'), 0o700); }
});

process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
