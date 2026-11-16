// A file in <data folder>/agents with the same id as a built-in agent but no handler is a note to that agent, not a replacement: the built-in
// keeps its handler (so its answer is still saved), context, connectors and schedule, and the note's text is added after its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-override-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const agents = await import('../server/core/agents.js');
config.load(); store.init();

const put = (name, text) => fs.writeFileSync(path.join(store.dirs.agents, name), text);

test('a note with no handler adds to the built-in agent and keeps what makes it work', () => {
  const builtIn = agents.get('dashboard-builder');
  assert.equal(builtIn.loop, 'dashboard');
  put('dashboard-builder.md', '---\nname: dashboard-builder\ndescription: Filtered dashboard.\n---\nBefore publishing, include the build number.\n');
  const a = agents.get('dashboard-builder');
  assert.equal(a.loop, 'dashboard', 'the loop that saves the answer is kept');
  assert.equal(a.schedule, builtIn.schedule, 'the schedule survives');
  assert.deepEqual(a.context, builtIn.context);
  assert.deepEqual(a.connectors, builtIn.connectors);
  assert.equal(a.name, builtIn.name);
  assert.equal(a.custom, true);
  assert.ok(a.body.includes(builtIn.body.trim().slice(0, 40)), 'the built-in text is still there');
  assert.ok(a.body.includes('include the build number'), 'the note is added');
  assert.ok(a.body.indexOf('You are working on the dashboard') < a.body.indexOf('include the build number'));
});

test('a file that names a handler is a whole agent and replaces the built-in', () => {
  put('dashboard-builder.md', '---\nid: dashboard-builder\nname: Mine\nhandler: markdown\ninput: none\n---\nMy own.\n');
  const a = agents.get('dashboard-builder');
  assert.equal(a.handler, 'markdown');
  assert.equal(a.name, 'Mine');
  assert.equal(a.body.trim(), 'My own.');
});

test('a note may still change the context or schedule when it says so', () => {
  put('dashboard-builder.md', '---\nname: dashboard-builder\nschedule: weekdays 06:30\n---\nExtra.\n');
  const a = agents.get('dashboard-builder');
  assert.equal(a.loop, 'dashboard');
  assert.equal(a.schedule, 'weekdays 06:30');
});
