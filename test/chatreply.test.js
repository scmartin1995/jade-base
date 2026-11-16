// A chat reply has one home (server/core/chatreply.js): its prompt parts, what the conversation shows when a reply ends, tidying
// afterwards and the build-loop follow-up. Driven through its own functions and the real conversation store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-chatreply-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const chat = await import('../server/core/chatreply.js');
config.load(); store.init();
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const thread = () => store.newThread('t').id;
const last = id => store.getThread(id).turns.at(-1);

test('is() says which agents talk in a conversation', () => {
  assert.equal(chat.is({ handler: 'chat' }), true);
  assert.equal(chat.is({ handler: 'markdown' }), false);
  assert.equal(chat.is(undefined), false);
});

test('a reply that stopped leaves a note in the conversation; a stop that did nothing does not', () => {
  const t = thread();
  const j = { id: 'j1', agent: 'jade', input: { thread: t }, status: 'error', error: 'boom', agents: [], touched: [] };
  chat.ended(j, new Error('boom'));
  assert.match(last(t).text, /This reply stopped: boom\./); assert.equal(last(t).failed, true); assert.equal(last(t).job, 'j1');
  const n = store.getThread(t).turns.length;
  chat.ended({ ...j, status: 'cancelled', error: 'x' }, new Error('x'));
  assert.equal(store.getThread(t).turns.length, n, 'stopped with nothing done: no note');
  chat.ended({ ...j, status: 'cancelled', touched: [{ path: '/a/b.md', name: 'b.md' }] }, new Error('x'));
  assert.match(last(t).text, /You stopped this reply/); assert.equal(last(t).touched[0].name, 'b.md', 'what it had done stays with the note');
  chat.ended({ ...j, error: 'no output for 90s', status: 'error' }, Object.assign(new Error('x'), { stuck: true }));
  assert.match(last(t).text, /looked stuck/);
  const m = store.getThread(t).turns.length;
  chat.ended({ ...j, agent: 'note-actions' }, new Error('boom'));   // not a chat agent: nothing written
  chat.interrupted({ id: 'j9', agent: 'jade', input: {} });          // no conversation: nothing written
  assert.equal(store.getThread(t).turns.length, m);
  chat.interrupted({ id: 'j2', agent: 'jade', input: { thread: t } });
  assert.match(last(t).text, /Jade restarted before this reply finished/);
});

test('record() writes the reply with what it did, and marks a fix round', () => {
  const t = thread();
  chat.record({ thread: t, buildFix: true, round: 2 }, { id: 'j3', engine: 'claude', model: 'm', tools: [1, 2], connectors: ['web'], warm: true }, 'Done.', { applied: ['Added action: x'] });
  const turn = last(t);
  assert.deepEqual([turn.text, turn.job, turn.tools, turn.warm, turn.step, turn.label], ['Done.', 'j3', 2, true, true, "Fixed after Skeptic's check 2"]);
  assert.deepEqual(turn.applied, ['Added action: x']);
});

test('afterReply asks for a build check only when files changed, and carries a fix round on', () => {
  const touched = [{ path: '/a.md', name: 'a.md' }];
  const t = thread();
  assert.equal(chat.afterReply({ id: 'j', input: { thread: t, message: 'hi' }, touched: [] }), null, 'no files, no build');
  const first = chat.afterReply({ id: 'j', input: { thread: t, message: 'make it', requestAt: 'R' }, touched });
  assert.deepEqual([first.agent, first.trigger, first.title, first.input.round, first.input.requestAt, first.input.job], ['skeptic', 'build-loop', 'Skeptic: build check', 1, 'R', 'j']);
  const fix = chat.afterReply({ id: 'k', input: { thread: t, buildFix: true, round: 1, auto: true }, touched: [] });
  assert.deepEqual([fix.input.round, fix.title], [2, 'Skeptic: build check, round 2']);
  assert.equal(chat.afterReply({ id: 'k', input: { thread: t, buildFix: true, round: chat.buildRounds(), auto: true }, touched: [] }), null, 'the last round ends it');
  config.save({ build: { loop: false } });
  assert.equal(chat.afterReply({ id: 'j', input: { thread: t }, touched }), null, 'the setting turns the loop off');
  config.save({ build: { loop: true } });
});

test('afterReply puts the changed files on the written reply', () => {
  const t = thread();
  store.appendTurn(t, { role: 'jade', text: 'Made it.', job: 'jx' });
  const touched = [{ path: '/a.md', name: 'a.md', isNew: true }];
  chat.afterReply({ id: 'jx', input: { thread: t, message: 'make it', auto: true }, touched, agents: [] });
  assert.deepEqual(last(t).touched, touched);
});

test('the turn text names the page, the message and any connectors, and quotes safely', () => {
  const s = chat.turn({ message: 'say "hi"', route: 'notes', via: 'voice' }, ['calendar']);
  assert.match(s, /^# This turn\nThe user says \(by voice\): "say ”hi”"\nThey are looking at the "notes" page\.\nConnectors available for this turn: calendar\./);
  assert.match(chat.turn({ message: '', images: ['/x.png'] }, []), /with no message\.[\s\S]*pasted an image[\s\S]*- \/x\.png/);
  assert.match(chat.turn({ message: 'go', buildFix: true }, []), /sent back by Skeptic/);
});

test('warmTurn leaves a reply that cannot be warm to the caller', async () => {
  assert.equal(await chat.warmTurn({ engine: 'other', input: { thread: 't' } }, {}, {}, {}), null);
  assert.equal(await chat.warmTurn({ engine: 'claude', input: {} }, {}, {}, {}), null);
});
