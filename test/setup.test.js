// First-run set-up: the state the page reads, the done flag, and the rule that model choices are exactly what discovery found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-setup-'));
process.env.JADE_HOME = home;
process.env.JADE_CLAUDE_HOME = path.join(home, 'claude');

const config = await import('../server/core/config.js');
const models = await import('../server/core/models.js');
const mod = (await import('../server/modules/setup.js')).default;
config.addDefaults(mod.defaults);

const routes = {};
mod.init({ on: (m, p, fn) => { routes[m + ' ' + p] = fn; } });
const fake = list => { fs.mkdirSync(config.STATE, { recursive: true }); fs.writeFileSync(path.join(config.STATE, 'models.json'), JSON.stringify({ at: 'now', current: '', aliases: [], models: list, suggested: {}, notes: [] })); };

test('the state starts not done and carries no secrets', () => {
  const s = routes['GET /api/setup']();
  assert.equal(s.done, false);
  assert.equal(s.projectCount, 0);
  assert.equal(s.provider.hasKey, false);
  assert.ok(!JSON.stringify(s.provider).toLowerCase().includes('secret'));
  assert.ok(Array.isArray(s.agents.agents));
});

const connection = await import('../server/core/connection.js');
test('done flips with POST /api/setup/done and can be turned off again', () => {
  connection.record(true);
  assert.equal(routes['POST /api/setup/done']({ body: {} }).done, true);
  assert.equal(config.get().setup.done, true);
  assert.equal(routes['POST /api/setup/done']({ body: { done: false } }).done, false);
  assert.equal(config.get().setup.done, false);
});

test('an engine file already there counts as a configured provider', async () => {
  const provider = await import('../server/core/provider.js');
  assert.equal(routes['GET /api/setup']().provider.configured, provider.describe().exists || provider.describe().style !== 'plan');
  fs.writeFileSync(provider.describe().file, 'ANTHROPIC_BASE_URL=https://gw.example.com\nANTHROPIC_AUTH_TOKEN=abcd1234secretvalue\n');
  const p = routes['GET /api/setup']().provider;
  assert.equal(p.configured, true);
  assert.equal(p.hasKey, true);
  assert.ok(!JSON.stringify(p).includes('abcd1234secretvalue'));
});

test('model options equal exactly the discovered list, and are empty when nothing was found', () => {
  fake(['m-small', 'm-mid', 'm-big']);
  assert.deepEqual(routes['GET /api/setup']().models.choices.map(c => c.id), ['m-small', 'm-mid', 'm-big']);
  assert.deepEqual(models.choices().choices.map(c => c.id), ['m-small', 'm-mid', 'm-big']);
  fake([]);
  assert.deepEqual(routes['GET /api/setup']().models.choices, []);
});

test('agent model settings default to nothing chosen', () => {
  const s = routes['GET /api/setup']();
  assert.deepEqual(s.agentModels, { model: '', checkerModel: '' });
});
