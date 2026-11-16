// An agent's files come from the user's own copy first, then Jade's bundled copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-agentfiles-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const agentfiles = await import('../server/core/agentfiles.js');
const skeptic = await import('../server/core/skeptic.js');

const bundled = path.join(config.APP_ROOT, 'agents', 'chat', 'criteria.md');
const criteriaPath = () => agentfiles.find('chat', 'criteria.md');

test('built in when the user has no copy', () => {
  assert.equal(criteriaPath(), bundled);
  assert.equal(agentfiles.origin(criteriaPath()), 'built in');
  assert.equal(agentfiles.homes('chat').length, 2);
});

test('the user\'s own copy wins over the built-in one, and Skeptic accepts it as the workflow\'s own', async () => {
  const mine = path.join(config.JADE_HOME, 'chat', 'criteria.md');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.copyFileSync(bundled, mine);
  assert.equal(criteriaPath(), mine);
  assert.equal(agentfiles.origin(mine), 'yours');
  const r = await skeptic.verify({ workflowId: 'chat', criteriaPath: mine, lessonsPath: '/tmp/none', items: [] });
  assert.deepEqual(r.verdicts, {});
  const elsewhere = await skeptic.verify({ workflowId: 'chat', criteriaPath: path.join(config.JADE_HOME, 'build', 'criteria.md'), lessonsPath: '/tmp/none', items: [{ item_id: 'T1', source: {}, output: {} }] });
  assert.equal(elsewhere.verdicts.T1.verdict, 'blocked', 'another workflow\'s folder is still refused');
});
