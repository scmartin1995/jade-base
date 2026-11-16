// "May this agent or skill run here, and with what rights?" has one answer (server/core/mayrun.js). This walks every combination of
// where the file came from, how it is started, the module switch and whether Jade can run it, then checks that each way of starting
// one (the queue, the schedule, the bridge, a chat's run_agent action, the lists a chat sees) gives that same answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-mayrun-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const { mayRun } = await import('../server/core/mayrun.js');
const modules = await import('../server/core/modules.js');
const jobs = await import('../server/core/jobs.js');
const agents = await import('../server/core/agents.js');
const bridge = await import('../server/core/bridge.js');
const scheduler = await import('../server/core/scheduler.js');
const agentfiles = await import('../server/core/agentfiles.js');
config.load();
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const MOD = modules.list().find(m => !m.core && !m.defaultOff)?.id;   // some switchable module, to turn on and off
const setModule = on => config.save({ modules: { [MOD]: on, routines: true } });

// where an agent file came from: yours or Jade's (trusted), a project's or a plugin's not yet allowed, one allowed once but changed since
const ORIGINS = {
  trusted: { needsAllowance: false, allowChanged: false, edits: true },
  notAllowed: { needsAllowance: true, allowChanged: false, edits: false },
  changed: { needsAllowance: true, allowChanged: true, edits: false },
};
const HAND = ['manual', 'rerun'], OWN = ['schedule', 'automation', 'chat', 'bridge', 'skill:budget', 'build-loop'];
const agent = (origin, extra = {}) => ({ name: 'Tidy', runnable: true, module: '', ...ORIGINS[origin], ...extra });

test('an agent: every origin by every way of starting it', () => {
  setModule(true);
  for (const way of [...HAND, ...OWN]) {
    const by = HAND.includes(way) ? 'hand' : 'own';
    // trusted: runs any way, with its edit right
    const t = mayRun({ agent: agent('trusted') }, way);
    assert.deepEqual([t.ok, t.ask, t.readOnly, t.edits], [true, false, false, true], `trusted by ${way}`);
    for (const origin of ['notAllowed', 'changed']) {
      const r = mayRun({ agent: agent(origin) }, way);
      if (by === 'hand') assert.deepEqual([r.ok, r.readOnly, r.edits], [true, true, false], `${origin} by ${way}: a read-only run`);
      else {
        assert.deepEqual([r.ok, r.ask, r.reason, r.status], [false, true, 'allow', 403], `${origin} by ${way}`);
        assert.match(r.message, /has not been allowed/);
        assert.equal(/since it changed/.test(r.message), origin === 'changed', 'only a changed file says it changed');
      }
    }
  }
});

test('a switched-off module stops every origin and every way, whoever asks', () => {
  setModule(false);
  for (const origin of Object.keys(ORIGINS)) for (const way of [...HAND, ...OWN]) {
    const r = mayRun({ agent: agent(origin, { module: MOD }) }, way);
    assert.deepEqual([r.ok, r.ask, r.reason], [false, false, 'module'], `${origin} by ${way}`);
    assert.match(r.message, /module, which is switched off/);
  }
  setModule(true);
  assert.equal(mayRun({ agent: agent('trusted', { module: MOD }) }, 'schedule').ok, true, 'and runs again once it is on');
  setModule(false);
  assert.equal(mayRun({ agent: agent('trusted', { module: MOD }) }, 'offer').ok, true, 'being listed to a chat is a question about the allowance only');
  setModule(true);
});

test('a Claude Code agent file Jade cannot run is refused for every origin and way, after the other rules', () => {
  for (const way of [...HAND, ...OWN]) {
    const r = mayRun({ agent: agent('trusted', { runnable: false }) }, way);
    assert.deepEqual([r.ok, r.reason], [false, 'runnable'], way);
    assert.match(r.message, /Claude Code agent Jade cannot run/);
    // not allowed and not runnable: by hand it is the runnable rule that stops it; on its own the allowance does
    assert.equal(mayRun({ agent: agent('notAllowed', { runnable: false }) }, way).reason, HAND.includes(way) ? 'runnable' : 'allow', way);
  }
});

test('a skill: allowed runs any way; not allowed or changed never runs, even by hand', () => {
  for (const way of [...HAND, ...OWN]) {
    assert.equal(mayRun({ skill: { name: 'budget', needsAllowance: false } }, way).ok, true, way);
    for (const changed of [false, true]) {
      const r = mayRun({ skill: { name: 'budget', needsAllowance: true, allowChanged: changed } }, way);
      assert.deepEqual([r.ok, r.ask, r.status], [false, true, 403], way);
      assert.match(r.message, /The skill budget comes from a project folder or a plugin and has not been allowed/);
      assert.equal(/since it changed/.test(r.message), changed);
    }
  }
});

test('offering to a chat (the lists, and which skills an agent may use) needs only the allowance', () => {
  for (const origin of Object.keys(ORIGINS)) {
    const r = mayRun({ agent: agent(origin, { runnable: false }) }, 'offer');
    assert.equal(r.ok, origin === 'trusted', origin);
    assert.equal(r.readOnly, origin !== 'trusted', origin);
  }
  assert.equal(mayRun({ skill: { name: 's', needsAllowance: true } }, 'offer').ok, false);
  assert.equal(mayRun({ skill: { name: 's', needsAllowance: false } }, 'offer').ok, true);
});

// ---- the callers give the same answer ----
const put = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const FILE = put(path.join(tmp, 'proj', '.claude', 'agents', 'sweeper.md'), '---\nname: sweeper\ndescription: Sweeps.\njade-handler: markdown\njade-schedule: every 1h\n---\nSweep.\n');
const store = await import('../server/core/store.js');
store.init();
store.saveProject({ name: 'P', folders: [path.join(tmp, 'proj')] });
const sweeper = () => agents.list().find(a => a.file === FILE);

test('the queue, the schedule, the bridge, a chat action and the chat lists all follow the same answer', () => {
  setModule(true);
  const a = sweeper();
  assert.equal(a.needsAllowance, true);
  const why = mayRun({ agent: a }, 'schedule').message;
  assert.throws(() => jobs.enqueue({ agent: a.id, trigger: 'schedule' }), e => e.message === why);
  assert.throws(() => bridge.run({ id: a.id }), e => e.status === 403 && e.message === mayRun({ agent: a }, 'bridge').message);
  assert.equal(agents.applyActions([{ type: 'run_agent', agent: a.id }], 'jade').applied[0], `Could not run_agent: ${mayRun({ agent: a }, 'jade').message}`);
  assert.ok(!scheduler.tasks().some(t => t.id === a.id));
  assert.ok(!agents.list().filter(x => mayRun({ agent: x }, 'offer').ok).some(x => x.id === a.id));
  // allowed: the same answer turns to yes everywhere
  agentfiles.allow(FILE);
  const b = sweeper();
  assert.equal(mayRun({ agent: b }, 'schedule').ok, true);
  assert.ok(scheduler.tasks().some(t => t.id === b.id), 'scheduled now');
  assert.ok(agents.applyActions([{ type: 'run_agent', agent: b.id }], 'jade').applied[0].startsWith('Started '));
  // changed since: no again, and the message says why
  fs.appendFileSync(FILE, 'More.\n');
  const c = sweeper();
  assert.equal(c.allowChanged, true);
  assert.match(mayRun({ agent: c }, 'schedule').message, /since it changed/);
  assert.throws(() => jobs.enqueue({ agent: c.id, trigger: 'chat' }), /since it changed/);
});

test('agents.js no longer imports the job queue, and dashboards.js no longer imports agents late', () => {
  const src = f => fs.readFileSync(new URL('../server/core/' + f, import.meta.url), 'utf8');
  assert.doesNotMatch(src('agents.js'), /from '\.\/jobs\.js'|import\('\.\/jobs\.js'\)/);
  assert.doesNotMatch(src('chatreply.js'), /from '\.\/(jobs|agents|review)\.js'/, 'chatreply.js is below both of them');
  assert.doesNotMatch(src('dashboards.js'), /await import\(/);
});
