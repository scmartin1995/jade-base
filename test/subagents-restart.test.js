// A reply cut off by a restart leaves its sub-agent cards closed off and slim in the chat, never "Working" for ever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-sub-restart-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const jobs = await import('../server/core/jobs.js');
config.load(); store.init();

test('init() writes the interrupted reply\'s cards as stopped, without step lists, with an end time', () => {
  const cid = store.resolveThread('new');
  fs.mkdirSync(config.STATE, { recursive: true });
  fs.writeFileSync(path.join(config.STATE, 'jobs.json'), JSON.stringify([{
    id: 'j1', agent: 'jade', status: 'running', input: { thread: cid },
    agents: [{ id: 'a', type: 'worker', description: 'd', status: 'running', steps: 3, startedAt: 1, tools: [{ name: 'Read', detail: 'x' }] }],
  }]));
  jobs.init();
  const note = store.getThread(cid).turns.at(-1);
  assert.equal(note.failed, true);
  assert.equal(note.agents[0].status, 'stopped');
  assert.equal(note.agents[0].tools, undefined);
  assert.ok(note.agents[0].endedAt);
});
