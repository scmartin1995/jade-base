// One place decides which model the checking agent uses: its own file, Settings, or one size above the Transcript agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-checker-'));
process.env.JADE_HOME = home;
process.env.JADE_CLAUDE_HOME = path.join(home, 'claude');
const config = await import('../server/core/config.js');
const provider = await import('../server/core/provider.js');
const pick = await import('../server/core/checker.js');
const judge = await import('../server/core/judge.js');
const skeptic = await import('../server/core/skeptic.js');
const meetings = await import('../server/core/meetings.js');
const setupMod = (await import('../server/modules/setup.js')).default;
const meetingsMod = (await import('../server/modules/meetings.js')).default;
config.addDefaults(setupMod.defaults); config.addDefaults(meetingsMod.defaults);
const routes = {};
setupMod.init({ on: (m, p, fn) => { routes[m + ' ' + p] = fn; } });

const cache = models => { fs.mkdirSync(config.STATE, { recursive: true }); fs.writeFileSync(path.join(config.STATE, 'models.json'), JSON.stringify({ at: 'now', current: '', aliases: [], models, suggested: {}, notes: [] })); };
const gateway = () => fs.writeFileSync(provider.describe().file, 'ANTHROPIC_BASE_URL=https://gw.example.com\nANTHROPIC_AUTH_TOKEN=tok\n');
const set = a => config.save({ agents: { model: '', checkerModel: '', effort: '', checkerEffort: '', ...a } });
const LIST = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'];
gateway();

test('blank checker model: one size above the Transcript agent, found among the discovered models', () => {
  cache(LIST);
  set({ model: 'claude-haiku-4-5' });
  assert.deepEqual(pick.checker(), { model: 'claude-sonnet-4-6', source: 'one-size-up', note: '' });
  set({ model: 'claude-sonnet-4-6' });
  assert.equal(pick.checker().model, 'claude-opus-4-7');
});

test('a checker chosen in Settings wins over the rule', () => {
  set({ model: 'claude-haiku-4-5', checkerModel: 'claude-haiku-4-5' });
  assert.deepEqual(pick.checker(), { model: 'claude-haiku-4-5', source: 'setting', note: '' });
});

test('the strongest agent model has nothing above it: same model, and it says so', () => {
  set({ model: 'claude-opus-4-7' });
  const c = pick.checker();
  assert.equal(c.model, 'claude-opus-4-7'); assert.equal(c.source, 'same'); assert.match(c.note, /no larger model/);
});

test('a model family Jade does not recognise: same model and a stated reason, never a silent guess', () => {
  cache([...LIST, 'claude-fable-5-2']);
  set({ model: 'claude-fable-5-2' });
  const c = pick.checker();
  assert.equal(c.model, 'claude-fable-5-2'); assert.equal(c.source, 'same'); assert.match(c.note, /does not recognise/);
});

test('no agent model chosen: the checker is blank too, and says why', () => {
  set({});
  const c = pick.checker();
  assert.equal(c.model, ''); assert.equal(c.source, 'none'); assert.ok(c.note);
});

test('set-up can ask what the checker would be for a model that is not saved yet', () => {
  cache(LIST); set({});
  assert.equal(routes['GET /api/setup/checker']({ q: new URLSearchParams({ agent: 'claude-haiku-4-5' }) }).model, 'claude-sonnet-4-6');
  assert.equal(routes['GET /api/setup']().used.checker.source, 'none');
});

test('an agent file model: is honoured for a trusted agent when discovery found it, and ignored with a reason when it did not', () => {
  const dir = path.join(config.JADE_HOME, 'agents'); fs.mkdirSync(dir, { recursive: true });
  const claudeAgents = path.join(process.env.JADE_CLAUDE_HOME, 'agents'); fs.mkdirSync(claudeAgents, { recursive: true });
  fs.writeFileSync(path.join(claudeAgents, 'jade-skeptic.md'), '---\nname: jade-skeptic\njade-id: skeptic\ndescription: x\nmodel: claude-opus-4-7\n---\nbody\n');
  cache(LIST); set({ model: 'claude-haiku-4-5' });
  const a = pick.checker();
  assert.deepEqual([a.model, a.source], ['claude-opus-4-7', 'file']);
  fs.writeFileSync(path.join(claudeAgents, 'jade-skeptic.md'), '---\nname: jade-skeptic\njade-id: skeptic\ndescription: x\nmodel: claude-opus-9-9\n---\nbody\n');
  const b = pick.checker();
  assert.notEqual(b.model, 'claude-opus-9-9');
  assert.match(b.note, /ignored/);
  fs.rmSync(path.join(claudeAgents, 'jade-skeptic.md'));
});

test('the checking agent really runs on the resolved model (through skeptic and a meeting check)', async () => {
  cache(LIST); set({ model: 'claude-haiku-4-5' });
  const seen = [];
  judge.use(async a => { seen.push(a.model); return { data: { verdicts: [], missed: [] }, model: a.model }; });
  try {
    await skeptic.verifyAgainstInstructions({ workflowId: 'transcript', instructions: 'i', source: 'a b c d', items: [] });
    assert.deepEqual(seen, ['claude-sonnet-4-6']);
  } finally { judge.use(null); }
});
