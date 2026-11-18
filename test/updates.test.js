// The update check: Jade compares its own copy with the branch it follows on GitHub, says how far behind it is, and can
// bring itself up to date when the person asks (a fast-forward only, never a merge of its own). Every repository here is a
// throw-away one in a temp folder: a bare "GitHub" copy, Jade's copy, and a second copy that pushes new work to "GitHub".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpHome } from './helpers/env.js';
import { startServer, waitFor } from './helpers/server.js';

const t = tmpHome('jade-updates-', { apply: true });
const updates = await import('../server/core/updates.js');
const config = await import('../server/core/config.js');
config.load();

const ID = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...ID } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
let n = 0;
function commit(dir, file, text, message) { fs.writeFileSync(path.join(dir, file), text); git(dir, 'add', file); git(dir, 'commit', '-q', '-m', message); }
/** A fresh "GitHub" (bare), Jade's copy of it, and another copy to push new work from. */
function repos() {
  const base = path.join(t.root, `r${++n}`);
  const seed = path.join(base, 'seed'), remote = path.join(base, 'remote.git'), jade = path.join(base, 'jade'), other = path.join(base, 'other');
  fs.mkdirSync(seed, { recursive: true });
  git(seed, 'init', '-q');
  git(seed, 'checkout', '-q', '-B', 'main');
  commit(seed, 'readme.txt', 'one\n', 'First version');
  git(base, 'clone', '-q', '--bare', seed, remote);
  git(base, 'clone', '-q', remote, jade);
  git(base, 'clone', '-q', remote, other);
  const push = (file, text, message) => { commit(other, file, text, message); git(other, 'push', '-q', 'origin', 'main'); };
  return { remote, jade, other, push, head: () => git(jade, 'rev-parse', 'HEAD'), remoteHead: () => git(remote, 'rev-parse', 'main') };
}

after(() => t.cleanup());

test('a copy that matches GitHub is up to date', async () => {
  const r = repos();
  const s = await updates.check({ root: r.jade });
  assert.equal(s.state, 'current');
  assert.equal(s.behind, 0);
});

test('new work on GitHub shows how many changes are waiting and what they are', async () => {
  const r = repos();
  r.push('a.txt', 'a\n', 'Add the first thing');
  r.push('b.txt', 'b\n', 'Add the second thing');
  const s = await updates.check({ root: r.jade });
  assert.equal(s.state, 'behind');
  assert.equal(s.behind, 2);
  assert.deepEqual(s.latest, ['Add the second thing', 'Add the first thing']);
  assert.equal(updates.status().state, 'behind', 'the last result is remembered for the page');
});

test('Update now brings the copy level with GitHub', async () => {
  const r = repos();
  r.push('a.txt', 'a\n', 'Add a thing');
  await updates.check({ root: r.jade });
  const out = await updates.apply({ root: r.jade });
  assert.equal(out.ok, true, out.reason);
  assert.equal(r.head(), r.remoteHead());
  assert.ok(fs.existsSync(path.join(r.jade, 'a.txt')));
  assert.equal(updates.status().state, 'current');
});

test('an update that would overwrite a change made in this copy is refused, with the reason, and changes nothing', async () => {
  const r = repos();
  r.push('readme.txt', 'two\n', 'Change the readme');
  fs.writeFileSync(path.join(r.jade, 'readme.txt'), 'my own edit\n');
  const before = r.head();
  const out = await updates.apply({ root: r.jade });
  assert.equal(out.ok, false);
  assert.match(out.reason, /changes of its own/);
  assert.equal(r.head(), before);
  assert.equal(fs.readFileSync(path.join(r.jade, 'readme.txt'), 'utf8'), 'my own edit\n', 'the person\'s edit is still there');
});

test('a copy with commits GitHub does not have is not updated by itself', async () => {
  const r = repos();
  r.push('a.txt', 'a\n', 'Theirs');
  commit(r.jade, 'mine.txt', 'mine\n', 'Mine');
  const s = await updates.check({ root: r.jade });
  assert.equal(s.state, 'diverged');
  const before = r.head();
  const out = await updates.apply({ root: r.jade });
  assert.equal(out.ok, false);
  assert.match(out.reason, /cannot be updated by itself/);
  assert.equal(r.head(), before);
});

test('a folder that is not a git copy, or GitHub out of reach, is reported quietly and never throws', async () => {
  const plain = path.join(t.root, 'plain'); fs.mkdirSync(plain, { recursive: true });
  assert.equal((await updates.check({ root: plain })).state, 'not-git');
  const r = repos();
  git(r.jade, 'remote', 'set-url', 'origin', path.join(t.root, 'no-such-remote.git'));
  assert.equal((await updates.check({ root: r.jade })).state, 'unreachable');
  const out = await updates.apply({ root: plain });
  assert.equal(out.ok, false);
});

test('with the setting off, the automatic check does not look', async () => {
  const r = repos();
  r.push('a.txt', 'a\n', 'Something new');
  config.save({ updates: { check: false } });
  try {
    const s = await updates.auto({ root: r.jade });
    assert.equal(s.state, 'off');
    assert.equal(git(r.jade, 'rev-list', '--count', 'HEAD..origin/main'), '0', 'nothing was fetched');
  } finally { config.save({ updates: { check: true } }); }
  assert.equal((await updates.auto({ root: r.jade })).state, 'behind');
});

test('through the server: check now, the page boot data, and Update now', async () => {
  const r = repos();
  r.push('a.txt', 'a\n', 'Add a thing');
  const home = path.join(t.root, 'srv-home'), claudeHome = path.join(t.root, 'srv-claude');
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(claudeHome, { recursive: true });
  const srv = await startServer({ home, claudeHome, bin: t.bin, env: { JADE_UPDATE_ROOT: r.jade } });
  try {
    const c = await srv.post('/api/updates/check');
    assert.equal(c.status, 200);
    assert.equal(c.body.state, 'behind');
    assert.equal(c.body.behind, 1);
    assert.equal((await srv.get('/api/boot')).body.update.state, 'behind');
    const a = await srv.post('/api/updates/apply');
    assert.equal(a.status, 200);
    assert.equal(a.body.ok, true, a.body.reason);
    await waitFor(() => r.head() === r.remoteHead(), { message: 'the copy to match GitHub' });
    assert.equal((await srv.get('/api/updates')).body.state, 'current');
  } finally { await srv.stop(); }
});
