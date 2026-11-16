// `node jade.js --open`: the one way scripts/jade and scripts/jade.cmd open the window. It writes the start-link file, opens it in the
// configured mode and starts no server. The browser start is injected (or, for the whole command, a stand-in browser that records its arguments).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpHome, put } from './helpers/env.js';

const KEY = 'open-key-never-in-args-4d1b9';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t = tmpHome('jade-open-', { apply: true });
process.env.JADE_TOKEN = KEY;
const { openJade } = await import('../server/core/opener.js');
test.after(() => t.cleanup());

const rec = calls => (command, args, options) => { calls.push({ command, args, options }); const c = new EventEmitter(); c.unref = () => {}; setImmediate(() => c.emit('spawn')); return c; };

test('open: app mode passes the file address to --app, never the key', async () => {
  const calls = [], said = [];
  const used = await openJade({ port: 4999, argv: ['node', 'jade.js', '--open'], env: { JADE_BROWSER: process.execPath }, spawn: rec(calls), log: m => said.push(m), cfg: {} });
  assert.equal(used.kind, 'app');
  assert.equal(calls[0].command, process.execPath);
  assert.ok(calls[0].args[0].startsWith('--app=file:'), calls[0].args[0]);
  assert.ok(!JSON.stringify(calls).includes(KEY));
  assert.ok(fs.readFileSync(path.join(t.home, '.state', 'open.html'), 'utf8').includes(KEY), 'the key is in the owner-only file');
  assert.deepEqual(said, ['Jade opened in its own window.']);
});

test('open: --tab, JADE_WINDOW=tab and the setting each give a tab; the key is still not in the arguments', async () => {
  for (const o of [{ argv: ['--open', '--tab'], env: { JADE_BROWSER: process.execPath }, cfg: {} }, { argv: [], env: { JADE_WINDOW: 'tab', JADE_BROWSER: process.execPath }, cfg: {} }, { argv: [], env: { JADE_BROWSER: process.execPath }, cfg: { window: 'tab' } }]) {
    const calls = [];
    const used = await openJade({ port: 4999, spawn: rec(calls), log: () => {}, ...o });
    assert.equal(used.kind, 'tab');
    assert.ok(!JSON.stringify(calls).includes(KEY));
    assert.ok(calls[0].args.some(a => a.startsWith('file:')));
  }
});

test('node jade.js --open starts no server and no launcher, and runs the browser it was told to', { skip: process.platform === 'win32' && 'the stand-in browser is a shell script' }, () => {
  const stand = path.join(t.root, 'browser'), log = path.join(t.root, 'browser.log');
  put(stand, `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\n`); fs.chmodSync(stand, 0o755);
  const env = { ...process.env, JADE_HOME: t.home, JADE_CLAUDE_HOME: t.claudeHome, JADE_PORT: '4998', JADE_TOKEN: KEY, JADE_BROWSER: stand };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'jade.js'), '--open'], { env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Jade opened in its own window/);
  for (let i = 0; i < 50 && !fs.existsSync(log); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  const args = fs.readFileSync(log, 'utf8');
  assert.match(args, /--app=file:/);
  assert.ok(!args.includes(KEY));
  assert.ok(!fs.existsSync(path.join(t.home, '.state', 'jade.pid')), 'no launcher was started');
});
