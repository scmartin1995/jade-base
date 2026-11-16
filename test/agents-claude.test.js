// Agents are Claude Code agent files: the built-ins' format, discovery from every folder, install without overwriting your edits,
// owned skills, and the watcher. JADE_HOME and JADE_CLAUDE_HOME are temp folders; nothing real is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { waitFor } from './helpers/server.js';
import crypto from 'node:crypto';
import { removeDir } from './helpers/rm.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-agents-cc-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const agents = await import('../server/core/agents.js');
const agentfiles = await import('../server/core/agentfiles.js');
const claudehome = await import('../server/core/claudehome.js');
const router = await import('../server/core/router.js');
const { bus } = await import('../server/core/bus.js');
config.load(); store.init();

const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const mine = name => path.join(claudehome.agentsDir(), name);

test('claudehome honours JADE_CLAUDE_HOME', () => {
  assert.equal(claudehome.home(), process.env.JADE_CLAUDE_HOME);
  assert.equal(claudehome.agentsDir(), path.join(process.env.JADE_CLAUDE_HOME, 'agents'));
});

test('every built-in is in Claude Code\'s format: jade- keys, no model name, the loop or handler Jade needs', () => {
  const dir = path.join(config.APP_ROOT, 'agents');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const head = fs.readFileSync(path.join(dir, f), 'utf8').split('---')[1];
    assert.match(head, /^name: jade-/m, f);
    assert.match(head, /^description:/m, f);
    assert.match(head, /^jade-id: /m, f);
    assert.doesNotMatch(head, /^model:/m, `${f} must not name a model`);
    assert.doesNotMatch(head, /^(id|handler|context|input|edits|loop|kind|icon|hidden|connectors):/m, `${f} still uses an old bare key`);
  }
  const s = agents.get('skeptic');
  assert.equal(s.loop, 'skeptic-check'); assert.equal(s.kind, 'verifier'); assert.equal(s.runnable, true);
  assert.equal(s.origin, 'built-in'); assert.equal(s.builtin, true); assert.ok(s.tools.includes('Read'));
  assert.equal(agents.get('jade').handler, 'chat'); assert.equal(agents.get('jade').checked, true);
  assert.equal(agents.get('worker').name, 'Worker');
});

test('an old file with bare keys still loads', () => {
  put(path.join(store.dirs.agents, 'helper.md'), '---\nid: helper\nname: Helper\nhandler: markdown\nkind: builder\nskills: [tdd]\n---\nBuild it.\n');
  const a = agents.get('helper');
  assert.equal(a.kind, 'builder'); assert.equal(a.runnable, true); assert.equal(a.origin, 'yours'); assert.deepEqual(a.skills, ['tdd']);
  fs.rmSync(path.join(store.dirs.agents, 'helper.md'));
});

test('agents are found in your folder, a project\'s folder and an installed plugin, each with its origin', () => {
  put(mine('reviewer.md'), '---\nname: reviewer\ndescription: Reviews code.\ntools: Read, Grep\nmodel: whatever\n---\nReview it.\n');
  const pf = path.join(tmp, 'proj');
  put(path.join(pf, '.claude', 'agents', 'planner.md'), '---\nname: planner\ndescription: Plans.\n---\nPlan.\n');
  const p = store.saveProject({ name: 'Proj', folders: [pf] });
  const plug = path.join(tmp, 'plug');
  put(path.join(plug, 'agents', 'explorer.md'), '---\nname: explorer\ndescription: Explores.\n---\nLook.\n');
  put(path.join(claudehome.home(), 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'tools@market': [{ scope: 'user', installPath: plug }] } }));
  const by = Object.fromEntries(agents.list().map(a => [a.id, a]));
  assert.equal(by.reviewer.origin, 'yours'); assert.deepEqual(by.reviewer.tools, ['Read', 'Grep']); assert.equal(by.reviewer.model, 'whatever');
  assert.equal(by.planner.origin, 'project:' + p.id);
  assert.equal(by.explorer.origin, 'plugin:tools');
  assert.equal(by.skeptic.origin, 'built-in');
  // a plain Claude Code agent is shown and readable but Jade cannot run it
  assert.equal(by.reviewer.runnable, false);
  assert.match(by.reviewer.body, /Review it/);
  return assert.rejects(agents.prepare(by.reviewer, {}), /does not know how to run/);
});

test('a plain agent that shares a built-in\'s id does not replace it', () => {
  put(mine('worker.md'), '---\nname: worker\ndescription: Mine.\n---\nx\n');
  const all = agents.list();
  assert.equal(all.find(a => a.id === 'worker').origin, 'built-in');
  assert.equal(all.find(a => a.id === 'worker@yours').description, 'Mine.');
  fs.rmSync(mine('worker.md'));
});

test('install: not installed, then installed; the installed copy runs; nothing of yours is overwritten', () => {
  assert.equal(agentfiles.installStatus().state, 'not-installed');
  assert.equal(agents.get('skeptic').file, path.join(config.APP_ROOT, 'agents', 'skeptic.md'), 'runs from the app until installed');
  const r = agentfiles.install();
  assert.ok(r.written.includes(mine('jade-skeptic.md')));
  assert.equal(r.status.state, 'installed');
  const s = agents.get('skeptic');
  assert.equal(s.file, mine('jade-skeptic.md')); assert.equal(s.installed, true); assert.equal(s.loop, 'skeptic-check'); assert.equal(s.builtin, true);
  assert.equal(agents.list().filter(a => a.id === 'skeptic').length, 1);
  // you edit it
  fs.appendFileSync(mine('jade-skeptic.md'), '\nMy own rule.\n');
  assert.equal(agentfiles.installStatus().state, 'changed');
  assert.deepEqual(agentfiles.installStatus().changed.map(c => c.id), ['skeptic']);
  const again = agentfiles.install();
  assert.equal(again.kept.length, 1); assert.deepEqual(again.beside, []);
  assert.match(fs.readFileSync(mine('jade-skeptic.md'), 'utf8'), /My own rule/);
  assert.ok(!fs.existsSync(mine('jade-skeptic.new.md')), 'no .new file unless asked');
  const asked = agentfiles.install({ writeNew: true });
  assert.deepEqual(asked.beside, [mine('jade-skeptic.new.md')]);
  assert.match(fs.readFileSync(mine('jade-skeptic.new.md'), 'utf8'), /^name: jade-skeptic/m);
  assert.match(fs.readFileSync(mine('jade-skeptic.md'), 'utf8'), /My own rule/, 'still yours');
  assert.equal(agents.list().filter(a => a.file.endsWith('.new.md')).length, 0, 'the .new copy is not an agent');
});

test('an installed file Jade wrote and you did not touch is updated when Jade\'s copy moves on', () => {
  const f = mine('jade-worker.md');
  const old = '---\nname: jade-worker\njade-id: worker\n---\nolder\n';
  fs.writeFileSync(f, old);
  const rec = path.join(config.STATE, 'agents-installed.json');
  const j = JSON.parse(fs.readFileSync(rec, 'utf8'));
  j.files[f] = crypto.createHash('sha256').update(old).digest('hex');
  fs.writeFileSync(rec, JSON.stringify(j));
  assert.equal(agentfiles.installStatus().state, 'updates');
  const r = agentfiles.install({ ids: ['worker'] });
  assert.deepEqual(r.updated, [f]);
  assert.match(fs.readFileSync(f, 'utf8'), /Worker|worker/);
});

test('a file that was there before Jade installed anything is kept, not replaced', () => {
  put(mine('jade-note-actions.md'), '---\nname: jade-note-actions\njade-id: note-actions\n---\nmine\n');
  const st = agentfiles.installStatus();
  assert.ok(st.changed.some(c => c.id === 'note-actions'));
  agentfiles.install();
  assert.match(fs.readFileSync(mine('jade-note-actions.md'), 'utf8'), /^mine/m);
});

test('owned skills: installed with the built-in under jade-<id>-<skill>, attached to that agent only', async () => {
  const id = 'zz-owned-' + process.pid;
  const src = path.join(config.APP_ROOT, 'agents');
  const agentFile = path.join(src, id + '.md');
  const skillDir = path.join(src, id, 'skills', 'facts');
  try {
    put(agentFile, `---\nname: jade-${id}\ndescription: Test.\nskills: [facts, tdd]\njade-id: ${id}\njade-handler: markdown\n---\nDo it.\n`);
    put(path.join(skillDir, 'SKILL.md'), '---\nname: facts\ndescription: Pull out facts.\n---\nList facts.\n');
    put(path.join(skillDir, 'schema.json'), '{"type":"object"}');
    // before install: run straight from the repo
    let own = agents.ownedSkills(agents.get(id));
    assert.deepEqual(own.map(s => s.name), ['facts']);
    assert.equal(own[0].dir, skillDir);
    agentfiles.install({ ids: [id] });
    const to = path.join(claudehome.skillsDir(), `jade-${id}-facts`);
    assert.ok(fs.existsSync(path.join(to, 'schema.json')));
    assert.match(fs.readFileSync(path.join(to, 'SKILL.md'), 'utf8'), new RegExp(`^name: jade-${id}-facts`, 'm'));
    assert.match(fs.readFileSync(mine(`jade-${id}.md`), 'utf8'), new RegExp(`^skills: \\[jade-${id}-facts, tdd\\]`, 'm'), 'shared names stay as they are');
    const def = agents.get(id);
    own = agents.ownedSkills(def);
    assert.deepEqual(own.map(s => s.name), [`jade-${id}-facts`]);
    // always in this agent's prompt, and in no other agent's, chat included
    const prep = await agents.prepare({ ...def, context: [] }, {});
    assert.match(prep.prompt, new RegExp(`jade-${id}-facts`));
    const other = await agents.prepare({ ...agents.get('note-actions'), context: [] }, {});
    assert.doesNotMatch(other.prompt, /jade-zz-owned/);
    const chat = await agents.prepare({ ...agents.get('jade'), context: [] }, { message: 'Pull out facts, please: list facts from this text.' });
    assert.doesNotMatch(chat.prompt, new RegExp(`jade-${id}-facts`), 'word overlap never reaches an owned skill');
  } finally { fs.rmSync(agentFile, { force: true }); removeDir(path.join(src, id)); }
});

test('editing: yours writes its own file keeping jade- keys; a built-in is installed first; a plugin agent is read-only', () => {
  const r = agents.save('reviewer', { description: 'Reviews carefully.', prompt: 'New prompt.', tools: 'Read, Glob' });
  assert.equal(r.description, 'Reviews carefully.');
  const text = fs.readFileSync(mine('reviewer.md'), 'utf8');
  assert.match(text, /New prompt\./); assert.match(text, /model: whatever/);
  agents.save('reviewer', { clearModel: true });
  assert.doesNotMatch(fs.readFileSync(mine('reviewer.md'), 'utf8'), /model:/);
  fs.rmSync(mine('jade-note-actions.md'));
  const n = agents.save('note-actions', { prompt: 'Changed.' });
  assert.equal(n.file, mine('jade-note-actions.md')); assert.match(n.body, /Changed\./);
  assert.match(fs.readFileSync(mine('jade-note-actions.md'), 'utf8'), /^jade-handler: actions/m);
  assert.throws(() => agents.save('explorer', { prompt: 'x' }), /plugin/);
});

test('the module registers the install routes', () => {
  return import('../server/modules/agents.js').then(({ default: m }) => {
    const stop = [];
    const out = m.init({ on: router.scope('mod:agents-test'), agents: { ...agents, watch: () => { stop.push(1); return () => {}; } } });
    assert.ok(stop.length);
    const get = router.match('GET', '/api/agents/install', false);
    assert.equal(get.fn({}).state, 'changed');   // reviewer-like leftovers above: jade-skeptic was edited
    assert.ok(router.match('POST', '/api/agents/install', false));
    assert.ok(router.match('GET', '/api/agents/skeptic/detail', false));
    assert.equal(router.match('GET', '/api/agents/skeptic/detail', false).fn({ p: { id: 'skeptic' } }).id, 'skeptic');
    assert.ok(out.install);
  });
});

test('a new agent file Claude Code writes raises an agents event', async () => {
  const stop = agents.watch();
  try {
    let seen = false;
    const h = e => { if (e.type === 'data' && e.payload.kind === 'agents') seen = true; };
    bus.on('event', h);
    // the watcher may not be listening yet: write the file again until the event arrives (spaced wider than the watcher's own 300 ms settle time, or each write would postpone the event)
    let n = 0;
    try { await waitFor(() => { put(mine('fresh.md'), `---\nname: fresh\ndescription: New ${n++}.\n---\nHi.\n`); return seen; }, { timeout: 8000, interval: 700, message: 'an agents event' }); }
    finally { bus.off('event', h); }
    assert.ok(agents.get('fresh'));
  } finally { stop(); }
});
