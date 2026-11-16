// What a chat message costs: skills go in by name and file, not in full, and a warm chat is not sent context it already has.
// Uses a stand-in "claude" on PATH that records every prompt line it is given.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { writeStub } from './helpers/stub.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-token-test-'));
const bin = path.join(dir, 'bin');
fs.mkdirSync(bin);
const log = path.join(dir, 'prompts.jsonl');
writeStub(bin, 'claude', `const fs = require('node:fs');
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', l => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(JSON.parse(l).message.content) + '\\n');
  console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'stand-in' }));
  console.log(JSON.stringify({ type: 'result', result: 'ok' }));
});
`);
process.env.PATH = bin + path.delimiter + process.env.PATH;
process.env.JADE_HOME = path.join(dir, 'home');
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
config.load(); store.init();
const warm = await import('../server/core/warm.js');
const skills = await import('../server/core/skills.js');

const settings = { connectors: [], dirs: [], model: '', system: 'x', effort: 'low', edits: false };
const prompts = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []);
const parts = { sections: ['## profile\nUser: A\nNow: Mon 9:00', '## facts\n- likes short answers\n' + '- a saved fact of ordinary length that is kept in memory\n'.repeat(60), '## projects\n- Atlas, green'], skillBlock: '', turn: '# This turn\nhello' };

test('a matched skill goes in by name, description and file, not as its full text', () => {
  const skillDir = path.join(dir, 'big-skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: big-skill\ndescription: Does a big thing\n---\n${'step '.repeat(1500)}`);
  const s = { name: 'big-skill', description: 'Does a big thing', dir: skillDir, body: 'step '.repeat(1500) };
  const block = skills.promptBlock([s]);
  assert.match(block, /big-skill/); assert.match(block, /Does a big thing/);
  assert.ok(block.includes(path.join(skillDir, 'SKILL.md')), 'the agent is told where to read it');
  assert.ok(block.length < 500, `the block is small (${block.length} characters), not the 6,000 of the body`);
  assert.doesNotMatch(block, /step step step/);
  // with no file to read, there is nothing to point to, so the text goes in
  assert.match(skills.promptBlock([{ name: 'no-file', description: 'd', dir: '', body: 'the whole text' }]), /the whole text/);
  assert.equal(skills.promptBlock([]), '');
});

test('the first turn sends all the context; the next sends only what changed', { timeout: 20000 }, async () => {
  const first = warm.contextFor('t1', settings, parts);
  assert.equal(first.kept.length, 0, 'a new chat has been given nothing yet');
  await warm.turn('t1', settings, { prompt: first.prompt, accepted: first.remember });
  const second = warm.contextFor('t1', settings, { ...parts, sections: parts.sections.map(s => s.replace('Mon 9:00', 'Mon 9:05')).map(s => s.replace('Atlas, green', 'Atlas, amber')), turn: '# This turn\nagain' });
  assert.deepEqual(second.kept, ['profile', 'facts'], 'the clock alone is not a change; the project status is');
  await warm.turn('t1', settings, { prompt: second.prompt, accepted: second.remember });
  const [one, two] = prompts();
  assert.match(one, /likes short answers/); assert.match(one, /Atlas, green/);
  assert.doesNotMatch(two, /likes short answers/, 'the unchanged facts are not repeated');
  assert.match(two, /Atlas, amber/); assert.match(two, /Unchanged since earlier in this conversation, so not repeated: profile, facts/);
  assert.ok(two.length < one.length, 'the second message is smaller');
  warm.shutdown();
});

test('a different chat, a restarted worker, or changed settings gets everything again', { timeout: 20000 }, async () => {
  const a = warm.contextFor('t2', settings, parts);
  await warm.turn('t2', settings, { prompt: a.prompt, accepted: a.remember });
  assert.equal(warm.contextFor('t3', settings, parts).kept.length, 0, 'another chat has its own worker');
  assert.equal(warm.contextFor('t2', { ...settings, effort: 'high' }, parts).kept.length, 0, 'changed settings mean a new worker, which has seen nothing');
  warm.forget('t2');
  assert.equal(warm.contextFor('t2', settings, parts).kept.length, 0, 'a restarted worker has seen nothing');
  warm.shutdown();
});

test('what a worker is told it has seen is recorded only when the turn is accepted', { timeout: 20000 }, async () => {
  const c = warm.contextFor('t4', settings, parts);   // computed, but never sent
  assert.equal(warm.contextFor('t4', settings, parts).kept.length, 0, 'planning a turn does not count as having sent it');
  await warm.turn('t4', settings, { prompt: c.prompt, accepted: c.remember });
  assert.equal(warm.contextFor('t4', settings, parts).kept.length, 3);
  warm.shutdown();
});
