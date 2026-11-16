// Unit tests for the parsing pieces. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const util = await import('../server/core/util.js');
const scheduler = await import('../server/core/scheduler.js');

test('frontmatter round-trips scalars, lists and nested maps', () => {
  const text = util.stringifyFrontmatter({ name: 'x', tags: ['a', 'b'], automation: 'fri 14:00', n: 3, flag: true, nested: { k: 'v' } }, 'body\n');
  const { data, body } = util.parseFrontmatter(text);
  assert.equal(data.name, 'x');
  assert.deepEqual(data.tags, ['a', 'b']);
  assert.equal(data.automation, 'fri 14:00');
  assert.equal(data.n, 3);
  assert.equal(data.flag, true);
  assert.deepEqual(data.nested, { k: 'v' });
  assert.equal(body, 'body\n');
});

test('frontmatter reads "- item" lists', () => {
  const { data } = util.parseFrontmatter('---\ncontext:\n  - project\n  - memory\nname: a\n---\n');
  assert.deepEqual(data.context, ['project', 'memory']);
  assert.equal(data.name, 'a');
});

test('extractJSON finds fenced and bare JSON in model replies', () => {
  assert.deepEqual(util.extractJSON('here:\n```json\n{"a":1}\n```\nbye'), { a: 1 });
  assert.deepEqual(util.extractJSON('Sure! {"health":"amber","x":[1,2]} hope that helps'), { health: 'amber', x: [1, 2] });
  assert.equal(util.extractJSON('no json here'), null);
});

test('schedule strings parse', () => {
  assert.deepEqual(scheduler.parse('every 30m'), { every: 30 * 60e3 });
  assert.deepEqual(scheduler.parse('weekdays 07:30'), { days: [1, 2, 3, 4, 5], h: 7, min: 30 });
  assert.deepEqual(scheduler.parse('mon,thu 16:00'), { days: [1, 4], h: 16, min: 0 });
  assert.equal(scheduler.parse('off'), null);
  assert.ok(scheduler.nextRun('daily 02:30'));
});

test('a failed or interrupted run can be run again with the same request', async () => {
  const jobs = await import('../server/core/jobs.js');
  const store = await import('../server/core/store.js');
  const config = await import('../server/core/config.js');
  const fs = await import('node:fs'); const path = await import('node:path');
  store.init();
  fs.writeFileSync(path.join(config.STATE, 'jobs.json'), JSON.stringify([
    { id: 'jold', agent: 'dashboard-builder', title: 'Tweak dashboard · Example', input: { project: 'p1', tweak: 'make the risks red' }, engine: 'claude', model: 'sonnet', status: 'running', createdAt: new Date().toISOString() },
    { id: 'jchat', agent: 'jade', title: 'hi', input: { message: 'hi' }, status: 'error', createdAt: new Date().toISOString() },
  ]));
  jobs.init(); // the "running" one comes back as interrupted
  assert.equal(jobs.get('jold').status, 'error');
  const again = jobs.rerun('jold');
  assert.notEqual(again.id, 'jold');
  assert.equal(again.agent, 'dashboard-builder'); assert.equal(again.title, 'Tweak dashboard · Example');
  assert.deepEqual(again.input, { project: 'p1', tweak: 'make the risks red' });
  assert.equal(again.engine, 'claude'); assert.equal(again.model, 'sonnet'); assert.equal(again.trigger, 'rerun');
  jobs.cancel(again.id);
  assert.throws(() => jobs.rerun('jchat'), /from the chat/);
  assert.throws(() => jobs.rerun('nope'), /no longer in the list/);
});

// (the engine.env half of this is a behaviour test now: test/engine-env-watch.test.js)

// On Windows a plain read can update a file's last-access time, which fs.watch reports as a change. Every watcher that restarts
// or reloads something must compare contents first, or a read restarts Jade ("Interrupted by restart") or reloads the window.
test('no file watcher acts on a read: each compares contents before restarting or reloading', () => {
  const launcher = fs.readFileSync(path.join(import.meta.dirname, '..', 'jade.js'), 'utf8');
  const lw = launcher.slice(launcher.indexOf('const seen = new Map()'));
  assert.ok(lw.length > 20, 'the launcher keeps what each server file says');
  assert.ok(lw.indexOf('now === seen.get(full)) return') < lw.indexOf('restart(f)'), 'the launcher checks contents before restarting');
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'server', 'index.js'), 'utf8');
  const asset = index.slice(index.indexOf('watchDir(PUBLIC'));
  assert.ok(asset.indexOf("assetText.get(file) === now) return") < asset.indexOf("emit('asset'"), 'the window reloads only on a real change');
  assert.match(index, /now === apiText\) return; apiText = now; reloadApi\(\)/, 'api.js reloads only on a real change');
});
