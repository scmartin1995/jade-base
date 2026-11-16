// A conversation can carry its own effort level (for planning), which is saved and checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-effort-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const engines = await import('../server/core/engines.js');
config.load(); store.init();

test('effort is saved on the conversation, any of the five levels, and "" returns to the default', () => {
  const cid = store.resolveThread('new');
  for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) assert.equal(store.updateThread(cid, { effort: e }).effort, e);
  assert.equal(store.updateThread(cid, { effort: 'bogus' }).effort, '');
  store.updateThread(cid, { effort: 'high' });
  assert.equal(store.updateThread(cid, { title: 'x' }).effort, 'high');   // other changes leave it alone
  assert.equal(store.getThread(cid).effort, 'high');
});

test('the engine gets --effort for each level', () => {
  for (const e of ['high', 'xhigh', 'max']) {
    const a = engines.claudeArgs({ effort: e, model: 'claude-sonnet-5-5' });
    assert.equal(a[a.indexOf('--effort') + 1], e);
  }
});

test('the model picker lists only what the endpoint lists, and falls back to Claude Code\'s names only when it lists none', async () => {
  const models = await import('../server/core/models.js');
  const file = path.join(config.STATE, 'models.json');
  fs.mkdirSync(config.STATE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ current: 'Opus 5.5', aliases: ['sonnet', 'opus', 'opusplan'], models: ['claude-sonnet-5-5', 'claude-haiku-5-5'] }));
  assert.deepEqual(models.choices().choices.map(c => c.id), ['claude-sonnet-5-5', 'claude-haiku-5-5']);
  fs.writeFileSync(file, JSON.stringify({ current: '', aliases: ['sonnet', 'opus'], models: [] }));
  assert.deepEqual(models.choices().choices.map(c => c.id), ['sonnet', 'opus']);
});
