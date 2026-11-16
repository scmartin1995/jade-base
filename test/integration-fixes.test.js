// Views stay free of the browser shell, the catch-all message rule, the dropped file's date, the Meetings agent
// follows its module's switch, every trusted agent gets its model from one place, reading never makes a folder, and the data folder is private.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-integ-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
fs.mkdirSync(process.env.JADE_HOME, { recursive: true, mode: 0o755 });
fs.chmodSync(process.env.JADE_HOME, 0o755);
// an older data folder, made before the key folder was private
fs.mkdirSync(path.join(process.env.JADE_HOME, '.state'), { mode: 0o755 });
fs.chmodSync(path.join(process.env.JADE_HOME, '.state'), 0o755);

const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const modules = await import('../server/core/modules.js');
const jobs = await import('../server/core/jobs.js');
const dashboards = await import('../server/core/dashboards.js');
const provider = await import('../server/core/provider.js');
const meetingsMod = (await import('../server/modules/meetings.js')).default;
const { api, netMessage } = await import('../public/js/api.js');
config.addDefaults(meetingsMod.defaults);

// ---------------------------------------------------------------- 1 views
test('a page file that imports the browser shell (app.js) fails the imports gate, and the real tree has none', () => {
  const gate = env => spawnSync(process.execPath, [path.join(ROOT, 'scripts/gates/imports.mjs')], { env: { ...process.env, ...env }, encoding: 'utf8' });
  const real = gate({});
  assert.equal(real.status, 0, real.stdout);
  assert.deepEqual(JSON.parse(real.stdout).details.viewsImportingShell, []);
  const tree = path.join(tmp, 'tree');
  for (const d of ['server', 'public/js', 'bridge', 'agents']) fs.cpSync(path.join(ROOT, d), path.join(tree, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tree, 'package.json'));
  for (const f of ['public/js/views/notes.js', 'public/js/dashboard/render.js', 'public/js/dropbin.js']) {
    if (!fs.existsSync(path.join(tree, f))) continue;
    const up = path.relative(path.dirname(path.join(tree, f)), path.join(tree, 'public/js/app.js')).split(path.sep).join('/');
    const was = fs.readFileSync(path.join(tree, f), 'utf8');
    fs.writeFileSync(path.join(tree, f), `import { api } from '${up.startsWith('.') ? up : './' + up}';\n` + was);
    const r = gate({ JADE_GATE_ROOT: tree });
    assert.equal(r.status, 1, f + ' ' + r.stdout);
    assert.ok(JSON.parse(r.stdout).details.viewsImportingShell.some(x => x.startsWith(f)), r.stdout);
    fs.writeFileSync(path.join(tree, f), was);
  }
});

test('the plain api helper loads without a browser and sends the key; a view is given it without the shell', async () => {
  const seen = [];
  globalThis.fetch = async (url, o) => { seen.push([url, o.method, o.headers]); return { ok: true, json: async () => ({ ok: 1 }) }; };
  assert.deepEqual(await api('GET', '/api/x'), { ok: 1 });
  assert.equal(seen[0][1], 'GET'); assert.ok('x-jade' in seen[0][2]);
  const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  assert.match(app, /api, apiUpload, state, go, ui/, 'the context a view is given carries both');
});

// ---------------------------------------------------------------- 2 catch-all
test('the catch-all says nothing for a cancelled request and never repeats a message in a row', () => {
  const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  assert.equal(netMessage(abort), '');
  assert.equal(netMessage(new Error('Jade stopped answering')), 'Jade stopped answering');
  assert.equal(netMessage(new Error('Jade stopped answering'), 'Jade stopped answering'), '', 'same as the last one shown');
  assert.equal(netMessage(new Error('Something else'), 'Jade stopped answering'), 'Something else');
  assert.equal(netMessage(new Error('Jade stopped answering'), 'Jade stopped answering', 500), '', 'a burst of the same failure is one message');
  assert.equal(netMessage(new Error('Jade stopped answering'), 'Jade stopped answering', 60000), 'Jade stopped answering', 'the same failure a minute later is shown again');
  assert.equal(netMessage(undefined), ''); assert.equal(netMessage({ message: 5 }), ''); assert.equal(netMessage('text'), '');
});

// ---------------------------------------------------------------- 3 dropbin date
test('dropbin sends the file\'s last-modified time with the upload', async () => {
  const sent = [];
  globalThis.XMLHttpRequest = class { open(m, u) { sent.push(u); } setRequestHeader() {} get upload() { return {}; } send() { this.status = 200; this.responseText = '{"id":"m1"}'; this.onload(); } };
  const { uploadTranscript } = await import('../public/js/dropbin.js');
  await uploadTranscript({ name: 'Standup.vtt', lastModified: 1700000000000 }, 'p1');
  assert.match(sent[0], /&modified=1700000000000$/);
  await uploadTranscript({ name: 'No date.vtt' }, 'p1');
  assert.doesNotMatch(sent[1], /modified=/);
});

// ---------------------------------------------------------------- 4 + 6 agents
const LIST = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7'];
function discovered(models = LIST) {
  fs.mkdirSync(config.STATE, { recursive: true });
  fs.writeFileSync(path.join(config.STATE, 'models.json'), JSON.stringify({ at: 'now', current: '', aliases: [], models, suggested: {}, notes: [] }));
  fs.writeFileSync(provider.describe().file, 'ANTHROPIC_BASE_URL=https://gw.example.com\nANTHROPIC_AUTH_TOKEN=tok\n');
}
const setAgents = a => config.save({ agents: { model: '', checkerModel: '', effort: '', checkerEffort: '', ...a } });

test('the Transcript agent belongs to Meetings: with the module off the agent refuses to start, with it on it does not', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'agents/transcript.md'), 'utf8'), /^jade-module: meetings$/m);
  assert.equal(meetingsMod.defaults.setup, undefined, 'the module no longer carries a set-up flag of its own');
  config.save({ modules: { meetings: false } });
  assert.equal(modules.enabled('meetings'), false);
  assert.throws(() => jobs.enqueue({ agent: 'transcript', input: {} }), /Meetings module, which is switched off/);
  config.save({ modules: { meetings: true } });
  let started; try { started = jobs.enqueue({ agent: 'transcript', input: {} }); } catch (e) { assert.doesNotMatch(e.message, /switched off/); }
  if (started) jobs.cancel?.(started.id);
});
// (the routes of a switched-off Meetings module answer 403: test/server-edges.test.js, "every route of a switched-off module answers the same way")

test('every trusted automated agent gets its model through checker.worker: Settings, or its own file when discovery found that model', () => {
  discovered(); setAgents({ model: 'claude-haiku-4-5' });
  const q = () => jobs.enqueue({ agent: 'note-actions', input: { text: 'x' } });
  assert.equal(q().model, 'claude-haiku-4-5', 'the Settings choice');
  const dir = path.join(process.env.JADE_CLAUDE_HOME, 'agents'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'jade-note-actions.md');
  fs.writeFileSync(file, '---\nname: jade-note-actions\njade-id: note-actions\ndescription: x\nmodel: claude-opus-4-7\n---\nbody\n');
  assert.equal(q().model, 'claude-opus-4-7', 'the agent file is honoured the same way as for Transcript');
  fs.writeFileSync(file, '---\nname: jade-note-actions\njade-id: note-actions\ndescription: x\nmodel: claude-opus-9-9\n---\nbody\n');
  assert.equal(q().model, 'claude-haiku-4-5', 'a model discovery did not find is ignored');
  fs.rmSync(file);
  setAgents({});
  assert.equal(q().model, '', 'nothing chosen: Claude Code decides');
  assert.equal(jobs.enqueue({ agent: 'note-actions', input: { text: 'x' }, model: 'claude-sonnet-4-6' }).model, 'claude-sonnet-4-6', 'a run that names one still wins');
});

// ---------------------------------------------------------------- 7 reading creates nothing
test('listing meetings and dashboards for a project leaves its folder untouched', () => {
  const folder = path.join(tmp, 'proj'); fs.mkdirSync(folder);
  const p = store.saveProject({ name: 'Quiet', folders: [folder] });
  const snap = () => JSON.stringify(fs.readdirSync(folder, { recursive: true }).sort());
  const before = snap();
  assert.deepEqual(dashboards.readMeetings(p.id), []);
  assert.deepEqual(dashboards.listFor(store.getProject(p.id)), []);
  assert.deepEqual(store.getProject(p.id) && (await_(() => dashboards.readSpec(p.id, 'nope'))), 'refused');
  assert.equal(store.projectPath(p.id, 'Meetings'), path.join(folder, 'Jade', 'Meetings'));
  assert.equal(snap(), before, 'no Jade, Meetings or Dashboards folder appeared');
  assert.equal(fs.existsSync(path.join(folder, 'Jade')), false);
  // the data-folder case (no project folder) too
  const q = store.saveProject({ name: 'NoFolder' });
  const dataBefore = JSON.stringify(fs.readdirSync(process.env.JADE_HOME).sort());
  dashboards.readMeetings(q.id); store.projectPath(q.id, 'Dashboards');
  assert.equal(JSON.stringify(fs.readdirSync(process.env.JADE_HOME).sort()), dataBefore);
  // a writer still makes it
  assert.equal(store.projectDir(p.id, 'Meetings'), path.join(folder, 'Jade', 'Meetings'));
  assert.ok(fs.existsSync(path.join(folder, 'Jade', 'Meetings')));
});
function await_(fn) { try { fn(); return 'ok'; } catch { return 'refused'; } }

// ---------------------------------------------------------------- 8 .state
test('the data folder\'s .state is owner-only from the first load, and an older one is tightened', { skip: process.platform === 'win32' && 'not checked on Windows: file modes (owner-only) do not exist there' }, () => {
  config.load();
  assert.equal(fs.statSync(config.STATE).mode & 0o777, 0o700);
  const fresh = path.join(tmp, 'fresh-home');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const c = await import(${JSON.stringify(path.join(ROOT, 'server/core/config.js'))}); c.load(); console.log((await import('node:fs')).statSync(c.STATE).mode & 0o777);`],
    { env: { ...process.env, JADE_HOME: fresh }, encoding: 'utf8' });
  assert.equal(Number(r.stdout.trim()), 0o700, r.stderr);
});

// ---------------------------------------------------------------- 5 port
test('the run-time tool settings take the port from config.port(), the one default', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/core/engines.js'), 'utf8');
  assert.match(src, /JADE_PORT: String\(config\.port\(\)\)/);
  assert.doesNotMatch(src, /\|\| 4778/);
});

// ---------------------------------------------------------------- 9 hygiene gate
test('hygiene gate: fails on a home path, an address, a key or a temp path in a tracked file, allows generic example paths', () => {
  const repo = path.join(tmp, 'hyg'); fs.mkdirSync(repo);
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'scripts/gates/hygiene.mjs')], { env: { ...process.env, JADE_GATE_ROOT: repo }, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'ok.md'), 'see /home/u/project and C:\\Users\\me and /Users/me/x and ~/notes\n');
  git('add', '.');
  assert.equal(run().status, 0, run().stdout);
  for (const bad of ['/home/' + 'alice/work', '/Users/' + 'bob/Desktop', 'mail jo' + 'e@acme' + '-corp.com', 'key AKIA' + 'ABCDEFGHIJKLMNOP', '/tmp/' + 'claude-1000/x']) {
    fs.writeFileSync(path.join(repo, 'bad.md'), bad + '\n'); git('add', '.');
    const r = run(); assert.equal(r.status, 1, bad); assert.match(r.stdout, /bad\.md:1/);
  }
  fs.writeFileSync(path.join(repo, 'bad.md'), 'by Zed Quux\n'); git('add', '.');
  assert.equal(run().status, 0, 'no term file, no term rule');
  fs.writeFileSync(path.join(repo, '.hygiene-terms'), '# comment\nzed\\s+quux\n');
  const r = run(); assert.equal(r.status, 1); assert.match(r.stdout, /bad\.md:1/);
  assert.equal(spawnSync(process.execPath, [path.join(ROOT, 'scripts/gates/hygiene.mjs')], { encoding: 'utf8' }).status, 0, 'the real tree is clean');
});
