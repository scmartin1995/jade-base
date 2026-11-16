// Jade only offers models that discovery found, smallest first, and says where the list came from. Gateway or Bedrock with an empty
// endpoint list means an empty list (no alias names stand in). Set-up pre-selects by tier. Nothing here may change what reaches Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-offer-'));
process.env.JADE_HOME = home;
process.env.JADE_CLAUDE_HOME = path.join(home, 'claude');
const config = await import('../server/core/config.js');
const models = await import('../server/core/models.js');
const provider = await import('../server/core/provider.js');
const connection = await import('../server/core/connection.js');
const setupMod = (await import('../server/modules/setup.js')).default;
config.addDefaults(setupMod.defaults);
const routes = {};
setupMod.init({ on: (m, p, fn) => { routes[m + ' ' + p] = fn; } });

const cache = (c = {}) => { fs.mkdirSync(config.STATE, { recursive: true }); fs.writeFileSync(path.join(config.STATE, 'models.json'), JSON.stringify({ at: 'now', current: '', aliases: [], models: [], suggested: {}, notes: [], ...c })); };
const gatewayOn = () => fs.writeFileSync(provider.describe().file, 'ANTHROPIC_BASE_URL=https://gw.example.com\nANTHROPIC_AUTH_TOKEN=tok\n');
const bedrockOn = () => fs.writeFileSync(provider.describe().file, 'CLAUDE_CODE_USE_BEDROCK=1\nAWS_BEARER_TOKEN_BEDROCK=tok\n');
const planOn = () => fs.rmSync(provider.describe().file, { force: true });
const ids = o => o.choices.map(c => c.id);

test('the list is ordered smallest first by tier, newest version first within a tier, alphabetical order is not used', () => {
  gatewayOn();
  cache({ models: ['claude-3-haiku-20240307', 'claude-opus-4-1', 'claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'] });
  const o = models.offerable();
  assert.deepEqual(ids(o), ['claude-haiku-4-5', 'claude-3-haiku-20240307', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-opus-4-7', 'claude-opus-4-1']);
  assert.equal(o.source, 'endpoint');
  assert.deepEqual(o.choices.map(c => c.tierName).filter((x, i, a) => a.indexOf(x) === i), ['Quick', 'Everyday', 'Strong']);
});

test('on a gateway or Bedrock with an empty endpoint list the offerable list is empty, whatever Claude Code reports', () => {
  cache({ models: [], aliases: ['sonnet', 'opus', 'haiku'], current: 'sonnet' });
  for (const on of [gatewayOn, bedrockOn]) {
    on();
    const o = models.offerable();
    assert.deepEqual(o.choices, []);
    assert.equal(o.source, 'none');
    assert.equal(o.defaults.agent, '');
    assert.deepEqual(routes['GET /api/setup']().models.choices, [], 'set-up gets the same empty list');
  }
  assert.ok(models.choices().choices.length, 'the old function is untouched and still falls back to the aliases');
});

test('on a plain plan the list is what Claude Code itself reports, smallest first', () => {
  planOn();
  cache({ aliases: ['opus', 'sonnet', 'haiku'], current: 'sonnet', models: ['claude-ignored-1'] });
  const o = models.offerable();
  assert.deepEqual(ids(o), ['haiku', 'sonnet', 'opus']);
  assert.equal(o.source, 'claude-code');
  assert.equal(o.choices.find(c => c.id === 'sonnet').note, 'current');
  cache({});
  assert.equal(models.offerable().source, 'none');
});

test('the agents get the smallest, the checker the next tier up (not the next entry), or the same model when there is one tier', () => {
  gatewayOn();
  cache({ models: ['claude-haiku-4-5', 'claude-haiku-3-5', 'claude-sonnet-4-6', 'claude-opus-4-7'] });
  let d = models.offerable().defaults;
  assert.equal(d.agent, 'claude-haiku-4-5');
  assert.equal(d.checker, 'claude-sonnet-4-6', 'skips the other haiku');
  assert.equal(d.sameTier, false);
  cache({ models: ['claude-sonnet-4-5', 'claude-sonnet-4-6'] });
  d = models.offerable().defaults;
  assert.deepEqual({ a: d.agent, c: d.checker, s: d.sameTier }, { a: 'claude-sonnet-4-6', c: 'claude-sonnet-4-6', s: true });
  cache({ models: ['some-other-model', 'another-one'] });
  d = models.offerable().defaults;
  assert.deepEqual([d.agent, d.checker, d.sameTier], ['some-other-model', 'some-other-model', true], 'unknown names go in the order found and never count as a bigger tier');
});

test('every picker reads the offerable list', () => {
  const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.match(read('server/api.js'), /models: models\.offerable\(\)/);
  assert.match(read('server/api.js'), /'\/api\/models', \(\) => models\.offerable\(\)/);
  assert.match(read('server/api.js'), /refresh', async \(\) => \{ await models\.discover\(\); return models\.offerable\(\)/);
  assert.match(read('server/modules/setup.js'), /models: models\.offerable\(\)/);
  assert.ok(!/models\.choices\(\)/.test(read('server/api.js') + read('server/modules/setup.js')));
  for (const f of ['public/js/views/settings.js', 'public/js/views/chat.js', 'public/js/views/setup.js']) assert.ok(/No models were found/.test(read(f)), f);
  assert.match(read('public/js/views/settings.js'), /data-diagnose-link/);
});

test('set-up pre-selects the smallest for the agents and asks the server for the checker (the one-size-up rule lives in server/core/checker.js, tested in checker.test.js)', () => {
  const src = fs.readFileSync(new URL('../public/js/views/setup.js', import.meta.url), 'utf8');
  assert.ok(!/list\[0\]/.test(src) && !/findIndex\(o => o\.value === a\.model\) \+ 1/.test(src), 'no longer the first or next entry');
  assert.match(src, /d\.agent/); assert.match(src, /\/api\/setup\/checker/); assert.ok(!/m\.tier > /.test(src), 'the page holds no copy of the rule');
});

test('the effort menu does not look at model names', () => {
  const src = fs.readFileSync(new URL('../public/js/views/chat.js', import.meta.url), 'utf8');
  assert.ok(!/haiku|takesEffort/i.test(src.replace(/\/\/.*$/gm, '')));
});

test('no model name is written into the new code as a default or a choice', () => {
  for (const f of ['public/js/views/setup.js', 'public/js/views/settings.js', 'server/core/connection.js', 'server/modules/setup.js']) {
    const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(!/\b(?:sonnet|haiku|opus)\b|claude-\w+-\d/i.test(src.replace(/\/\/.*$/gm, '')), f);
  }
});

test('POST /api/setup/done refuses with 409 unless the server recorded a successful test of these very settings', () => {
  planOn(); connection.clear();
  const done = body => routes['POST /api/setup/done']({ body });
  assert.throws(() => done({}), e => e.status === 409 && /not yet heard back from Claude/.test(e.message));
  assert.equal(config.get().setup.done, false);
  connection.record(false);
  assert.throws(() => done({}), e => e.status === 409, 'a failed test is not a pass');
  connection.record(true);
  assert.equal(routes['GET /api/setup']().connectionChecked, true);
  assert.equal(done({}).done, true);
  routes['POST /api/setup/done']({ body: { done: false } });
  // a changed provider clears it
  provider.configure({ style: 'gateway', baseUrl: 'https://gw2.example.com', key: 'k', keyKind: 'token' });
  assert.equal(connection.passed(), false, 'the saved test no longer matches the settings');
  assert.throws(() => done({}), e => e.status === 409);
  connection.record(true);
  assert.equal(done({}).done, true);
});

test('the install choice starts unselected and the page will not go on until it is made', () => {
  const src = fs.readFileSync(new URL('../public/js/views/setup.js', import.meta.url), 'utf8');
  assert.ok(!/value \|\| 'yes'/.test(src));
  assert.match(src, /install: ''/);
  assert.match(src, /a\.install === 'yes'/, 'nothing is installed unless the answer is yes');
});

test('the meetings length limit is a setting with a plain explanation', () => {
  const src = fs.readFileSync(new URL('../public/js/views/settings.js', import.meta.url), 'utf8');
  assert.match(src, /data-k="meetings\.maxChars"/);
  assert.match(src, /cannot find out how much text each model can take in/);
});
