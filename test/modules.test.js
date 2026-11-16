// Module manifests, the shared router, jobs.register and agents.addHandler / addContext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpHome } from './helpers/env.js';
import { startServer } from './helpers/server.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-mod-'));
process.env.JADE_HOME = home;
process.env.JADE_CLAUDE_HOME = path.join(home, 'claude');
fs.mkdirSync(path.join(home, 'modules'), { recursive: true });
// a user manifest that replaces the built-in Notes, and a new one with an init that returns a service
fs.writeFileSync(path.join(home, 'modules', 'notes.js'), "export default { id: 'notes', name: 'My notes', icon: 'pen', order: 50, desc: 'mine' };\n");
fs.writeFileSync(path.join(home, 'modules', 'hello.js'), "export default { id: 'hello', name: 'Hello', order: 300, desc: 'x', defaults: { hello: { greeting: 'hi' } }, nav: [{ route: 'hello', label: 'Hello' }], init({ on }) { on('GET', '/api/hello', () => ({ hi: 1 })); return { v: 7 }; } };\n");
fs.writeFileSync(path.join(home, 'modules', 'broken.js'), "export default { nope: true };\n");

const config = await import('../server/core/config.js');
const modules = await import('../server/core/modules.js');
const router = await import('../server/core/router.js');
const jobs = await import('../server/core/jobs.js');
const agents = await import('../server/core/agents.js');

test('built-in manifests are found in nav order; a bad manifest is skipped', () => {
  const ids = modules.list().map(m => m.id);
  assert.deepEqual(ids.slice(0, 5), ['home', 'chat', 'projects', 'dashboards', 'meetings']);
  for (const id of ['memory', 'skills', 'agents', 'routines', 'voice', 'modules', 'settings']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('broken'));
});

test('a user manifest with the same id wins; the list carries no functions', () => {
  assert.equal(modules.list().find(m => m.id === 'notes').name, 'My notes');
  assert.equal(modules.list().find(m => m.id === 'hello').init, undefined);
  assert.doesNotThrow(() => JSON.stringify(modules.list()));
});

test('defaultOff modules are off until config says otherwise; core ones stay on', () => {
  assert.equal(modules.enabled('voice'), false);
  assert.equal(modules.enabled('routines'), false);
  assert.equal(modules.enabled('chat'), true);
  modules.set('voice', true);
  assert.equal(modules.enabled('voice'), true);
  modules.set('voice', false);
  assert.equal(modules.enabled('voice'), false);
  assert.throws(() => modules.set('chat', false));
  assert.equal(modules.enabled('nope'), false);
});

test('a manifest can bring config defaults', () => assert.equal(config.get().hello.greeting, 'hi'));

test('init gets the core pieces, registers routes under its scope and publishes a service', async () => {
  await modules.init({ jobs, agents, store: {}, bus: {} });
  assert.deepEqual(modules.services.hello, { v: 7 });
  const hit = router.match('GET', '/api/hello', false);
  assert.deepEqual(await hit.fn({}), { hi: 1 });
});

test('router: scope replaces its own routes, raw routes are separate, * and :name capture', () => {
  let on = router.scope('t');
  on('GET', '/t/:id', () => 1); on('GET', '/t/raw/*', () => 2, { raw: true });
  on = router.scope('t'); // a re-import: the old ones go
  assert.equal(router.match('GET', '/t/5', false), null);
  on('GET', '/t/:id', () => 1); on('GET', '/t/raw/*', () => 2, { raw: true });
  assert.equal(router.match('GET', '/t/a%20b', false).p.id, 'a b');
  assert.equal(router.match('GET', '/t/raw/x/y.js', false), null);
  assert.equal(router.match('GET', '/t/raw/x/y.js', true).p['*'], 'x/y.js');
  assert.equal(router.match('POST', '/t/5', false), null);
  assert.equal(router.jsonLimit({}), 2 * 1024 * 1024);
  assert.equal(router.jsonLimit({ limits: { jsonBody: 10 } }), 10);
  assert.equal(config.get().limits.jsonBody, 2 * 1024 * 1024);
});

test('jobs.register, agents.addHandler and agents.addContext exist and the old entries still work', async () => {
  assert.equal(typeof jobs.register, 'function');
  jobs.register('x', () => 1);
  agents.addContext('zz', () => 'ctx');
  agents.addHandler('zz', () => ({ ok: 1 }));
  assert.deepEqual(await agents.finish({ handler: 'zz' }, {}, '', {}), { ok: 1 });
  assert.deepEqual(await agents.finish({ handler: 'nonexistent' }, {}, '', {}), {}, 'unknown falls back to markdown');
});

test('the server refuses a JSON body over the limit (413) and serves a raw route before reading the body', async () => {
  const t = tmpHome('jade-413-');
  fs.writeFileSync(path.join(t.home, 'config.json'), JSON.stringify({ limits: { jsonBody: 1000 } }));
  const srv = await startServer({ home: t.home, claudeHome: t.claudeHome, bin: t.bin, token: process.env.JADE_TOKEN });
  try {
    const base = srv.base;
    const post = body => fetch(base + '/api/config', { method: 'POST', headers: { 'x-jade': '1', 'content-type': 'application/json' }, body });
    assert.equal((await post(JSON.stringify({ name: 'a' }))).status, 200);
    assert.equal((await post(JSON.stringify({ name: 'a'.repeat(2000) }))).status, 413);
    assert.equal((await fetch(base + '/modules/nope/views/a.js', { headers: { 'x-jade': '1' } })).status, 404);
  } finally { await srv.stop(); t.cleanup(); }   // stop() waits for the server to exit: it writes into its folder until then
});
