// The private engine folder shows the user's agents and skills, without ever deleting a real file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-enginehome-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const provider = await import('../server/core/provider.js');
const enginehome = await import('../server/core/enginehome.js');
config.load();
fs.mkdirSync(process.env.JADE_HOME, { recursive: true });
const envFile = () => path.join(process.env.JADE_HOME, 'engine.env');
const gateway = () => fs.writeFileSync(envFile(), 'ANTHROPIC_BASE_URL=https://gw.example.com\nANTHROPIC_AUTH_TOKEN=abc\n');
const put = (f, t = 'x') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const claude = (...a) => path.join(process.env.JADE_CLAUDE_HOME, ...a);

test('on the plan sign-in nothing is done and no private folder is made', () => {
  fs.rmSync(envFile(), { force: true });
  put(claude('agents', 'a.md'));
  assert.equal(enginehome.inUse(), false);
  assert.equal(enginehome.sync(), null);
  assert.equal(fs.existsSync(path.join(config.STATE, 'engine-home')), false);
});

test('with a gateway, agents and skills are linked in and show new files at once', () => {
  gateway();
  put(claude('agents', 'a.md', ), 'agent');
  put(claude('skills', 's', 'SKILL.md'), 'skill');
  const r = enginehome.sync();
  assert.deepEqual(r, { agents: 'linked', skills: 'linked' });
  const priv = provider.engineHome();
  assert.ok(fs.lstatSync(path.join(priv, 'agents')).isSymbolicLink());
  assert.equal(fs.readFileSync(path.join(priv, 'agents', 'a.md'), 'utf8'), 'agent');
  put(claude('agents', 'b.md'), 'later');
  assert.equal(fs.readFileSync(path.join(priv, 'agents', 'b.md'), 'utf8'), 'later');
  assert.deepEqual(enginehome.sync(), { agents: 'ok', skills: 'ok' }, 'a second run changes nothing');
});

test('a stale link is replaced, and a link to a folder that is gone is removed', () => {
  const priv = provider.engineHome();
  const other = path.join(tmp, 'other'); fs.mkdirSync(other);
  fs.rmSync(path.join(priv, 'skills'));
  fs.symlinkSync(other, path.join(priv, 'skills'), 'junction');
  assert.equal(enginehome.sync().skills, 'linked');
  assert.equal(fs.realpathSync(path.join(priv, 'skills')), fs.realpathSync(claude('skills')));
  assert.ok(fs.existsSync(other), 'the folder it used to point at is untouched');
  fs.rmSync(claude('skills'), { recursive: true });
  assert.equal(enginehome.sync().skills, 'removed');
  assert.equal(fs.existsSync(path.join(priv, 'skills')) || !!fs.lstatSync(path.join(priv, 'skills'), { throwIfNoEntry: false }), false);
  assert.ok(fs.existsSync(claude('agents', 'a.md')));
});

test('a real folder with files in it is never deleted or replaced', () => {
  const priv = provider.engineHome();
  put(claude('skills', 's', 'SKILL.md'));
  put(path.join(priv, 'skills', 'mine', 'SKILL.md'), 'precious');
  assert.equal(enginehome.sync().skills, 'kept');
  assert.equal(fs.readFileSync(path.join(priv, 'skills', 'mine', 'SKILL.md'), 'utf8'), 'precious');
  assert.ok(!fs.lstatSync(path.join(priv, 'skills')).isSymbolicLink());
  fs.rmSync(path.join(priv, 'skills'), { recursive: true });
});

test('an empty real folder is replaced by a link', () => {
  const priv = provider.engineHome();
  fs.mkdirSync(path.join(priv, 'skills'));
  assert.equal(enginehome.sync().skills, 'linked');
});

test('when linking is not possible it copies, and refreshes only what it copied', () => {
  const t = path.join(tmp, 'src'), d = path.join(tmp, 'dst');
  put(path.join(t, 'one.md'), '1'); put(path.join(t, 'dir', 'two.md'), '2');
  const real = fs.symlinkSync;
  fs.symlinkSync = () => { throw Object.assign(new Error('no'), { code: 'EPERM' }); };
  try { assert.equal(enginehome.mirror(t, d), 'copied'); } finally { fs.symlinkSync = real; }
  assert.equal(fs.readFileSync(path.join(d, 'dir', 'two.md'), 'utf8'), '2');
  put(path.join(d, 'mine.md'), 'not ours');
  fs.rmSync(path.join(t, 'one.md')); put(path.join(t, 'three.md'), '3');
  assert.equal(enginehome.mirror(t, d), 'copied');
  assert.equal(fs.existsSync(path.join(d, 'one.md')), false, 'what it copied and the source dropped is gone');
  assert.equal(fs.readFileSync(path.join(d, 'three.md'), 'utf8'), '3');
  assert.equal(fs.readFileSync(path.join(d, 'mine.md'), 'utf8'), 'not ours', 'a file of the user\'s stays');
});

test('a plain file where the link should go is left alone', () => {
  const t = path.join(tmp, 'src2'), d = path.join(tmp, 'file-dst');
  put(path.join(t, 'a.md')); put(d, 'a file');
  assert.equal(enginehome.mirror(t, d), 'kept');
  assert.equal(fs.readFileSync(d, 'utf8'), 'a file');
});

test('a planted mark file cannot make a copy delete anything outside the folder', () => {
  const target = path.join(tmp, 'plant-src'), dest = path.join(tmp, 'plant-dest');
  const victim = path.join(tmp, 'victim-docs');
  put(path.join(target, 'one.md'), 'one'); put(path.join(victim, 'precious.txt'), 'keep me');
  put(path.join(dest, '.jade-mirror.json'), JSON.stringify({ from: target, entries: ['../victim-docs', '../../' + path.basename(tmp) + '/victim-docs', '.', '..', '/etc', 'sub/../../victim-docs'] }));
  assert.equal(enginehome.mirror(target, dest), 'copied');
  assert.equal(fs.readFileSync(path.join(victim, 'precious.txt'), 'utf8'), 'keep me', 'a folder outside the mirror survives');
  assert.equal(fs.readFileSync(path.join(dest, 'one.md'), 'utf8'), 'one');
});
