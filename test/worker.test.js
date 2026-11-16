// The Worker is a builder: not a job of its own, but a Claude Code sub-agent that a chat able to edit files hands build tasks to.
// It reaches the engine through --agents, with the full path of each skill it uses, and only on runs that can edit files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-worker-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const agents = await import('../server/core/agents.js');
const engines = await import('../server/core/engines.js');
config.load(); store.init();

const skill = (name, description) => {
  const d = path.join(store.dirs.skills, name); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nBody.\n`);
};

test('the Worker is a builder, kept out of the routines and the agents Jade can start as a job', () => {
  const w = agents.get('worker');
  assert.equal(w.kind, 'builder');
  assert.deepEqual(w.skills, [], 'names no skill this app does not ship');
  assert.ok(!/frontend-design|deliverable-design|power-design/.test(w.skills.join(' ')), 'no design skills');
  const prep = agents.list().find(a => a.id === 'jade');
  assert.ok(prep.body.includes('"worker" sub-agent'), 'Jade is told to hand code to it');
});

test('builder definitions name each installed skill by its file, and leave out the missing ones', () => {
  skill('tdd', 'Test-driven development.');
  const defs = agents.builderAgents();
  assert.ok(defs.worker, 'the worker is defined');
  assert.ok(defs.worker.description.length > 20);
  const f = agents.builderAgentsFile();
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), defs);
  assert.match(path.basename(f), /^agents-[0-9a-f]{64}\.json$/, 'named by the SHA-256 of its content');
  assert.equal(path.basename(f), `agents-${crypto.createHash('sha256').update(JSON.stringify(defs)).digest('hex')}.json`);
  assert.deepEqual(fs.readdirSync(path.dirname(f)).filter(n => n.endsWith('.tmp')), [], 'written then moved into place, no half file left');
  // your own builder, using a skill that does not exist anywhere on this computer
  fs.writeFileSync(path.join(store.dirs.agents, 'helper.md'), '---\nid: helper\nkind: builder\nhandler: markdown\nskills: [tdd, no-such-skill-zz9]\n---\nBuild it.\n');
  const helper = agents.builderAgents().helper;
  assert.ok(helper.prompt.includes(path.join(store.dirs.skills, 'tdd', 'SKILL.md')));
  assert.ok(!helper.prompt.includes('no-such-skill-zz9'), 'a skill that is not installed is not listed');
  assert.notEqual(agents.builderAgentsFile(), f, 'a changed set of builders gets a new file');
});

test('--agents is passed only on runs that can edit files', () => {
  const on = engines.claudeArgs({ edits: true, subagents: 'C:/x/agents.json' });
  assert.equal(on[on.indexOf('--agents') + 1], 'C:/x/agents.json');
  assert.ok(!engines.claudeArgs({ edits: false, subagents: 'C:/x/agents.json' }).includes('--agents'));
  assert.ok(!engines.claudeArgs({ edits: true }).includes('--agents'));
});

test('no built-in agent names a skill this app does not ship', () => {
  const shipped = new Set(fs.existsSync(path.resolve('skills')) ? fs.readdirSync(path.resolve('skills')) : []);
  for (const a of agents.list().filter(x => x.builtin)) for (const s of a.skills || []) assert.ok(shipped.has(s) || fs.existsSync(path.resolve('agents', a.id, 'skills', s)), `${a.id} names ${s}`);
});
