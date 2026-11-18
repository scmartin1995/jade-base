// The update check: Jade compares its own copy with the branch it follows on GitHub, says how far behind it is, and can
// bring itself up to date when the person asks (a fast-forward only, never a merge of its own). Every repository here is a
// throw-away one in a temp folder: a bare "GitHub" copy, Jade's copy, and a second copy that pushes new work to "GitHub".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { tmpHome } from './helpers/env.js';
import { startServer, waitFor } from './helpers/server.js';
import { installFakeClaude } from './helpers/fake-claude.js';

const t = tmpHome('jade-updates-', { apply: true });
installFakeClaude(t.bin, { putOnPath: false });   // the server below must never find a real `claude`
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

test('an update that would overwrite a file git ignores is refused like any other change of this copy', async () => {
  const r = repos();
  fs.appendFileSync(path.join(r.jade, '.git', 'info', 'exclude'), 'secret.txt\n');
  fs.writeFileSync(path.join(r.jade, 'secret.txt'), 'mine\n');
  r.push('secret.txt', 'theirs\n', 'Track a file this copy ignores');
  const before = r.head();
  const out = await updates.apply({ root: r.jade });
  assert.equal(out.ok, false);
  assert.match(out.reason, /changes of its own/);
  assert.equal(r.head(), before);
  assert.equal(fs.readFileSync(path.join(r.jade, 'secret.txt'), 'utf8'), 'mine\n');
});

test('an ignored file the update would reach by a rename is refused too', async () => {
  const r = repos();
  r.push('big.txt', 'big\n', 'Add a big file');
  await updates.apply({ root: r.jade });
  fs.appendFileSync(path.join(r.jade, '.git', 'info', 'exclude'), 'notes.log\n');
  fs.writeFileSync(path.join(r.jade, 'notes.log'), 'mine\n');
  git(r.other, 'mv', 'big.txt', 'notes.log'); git(r.other, 'commit', '-q', '-m', 'Rename'); git(r.other, 'push', '-q', 'origin', 'main');
  const before = r.head();
  const out = await updates.apply({ root: r.jade });
  assert.equal(out.ok, false);
  assert.match(out.reason, /changes of its own/);
  assert.equal(r.head(), before);
  assert.equal(fs.readFileSync(path.join(r.jade, 'notes.log'), 'utf8'), 'mine\n');
});

test('an ignored file where the update puts a folder is refused too', async () => {
  const r = repos();
  fs.appendFileSync(path.join(r.jade, '.git', 'info', 'exclude'), 'cache\n');
  fs.writeFileSync(path.join(r.jade, 'cache'), 'mine\n');
  fs.mkdirSync(path.join(r.other, 'cache'));
  r.push(path.join('cache', 'readme.txt'), 'theirs\n', 'Add a cache folder');
  const before = r.head();
  const out = await updates.apply({ root: r.jade });
  assert.equal(out.ok, false);
  assert.match(out.reason, /changes of its own/);
  assert.equal(r.head(), before);
  assert.equal(fs.readFileSync(path.join(r.jade, 'cache'), 'utf8'), 'mine\n');
});

test('a tracked file that becomes a folder on GitHub still updates', async () => {
  const r = repos();
  r.push('docs', 'a file\n', 'Add docs as a file');
  await updates.apply({ root: r.jade });
  git(r.other, 'rm', '-q', 'docs'); fs.mkdirSync(path.join(r.other, 'docs'));
  r.push(path.join('docs', 'readme.txt'), 'now a folder\n', 'Make docs a folder');
  const out = await updates.apply({ root: r.jade });
  assert.equal(out.ok, true, out.reason);
  assert.equal(r.head(), r.remoteHead());
});

test('a git message is put in plain words: paths hidden, branch names kept', () => {
  const said = updates.why("fatal: cannot open '/srv/someone/jade/.git/FETCH_HEAD' for origin/main: Permission denied");
  assert.doesNotMatch(said, /someone/);
  assert.match(said, /origin\/main/);
  assert.doesNotMatch(updates.why('error: C:\\Users\\someone\\jade is busy'), /someone/);
});

test('a branch that is gone from GitHub is told apart from being offline', async () => {
  const r = repos();
  git(r.jade, 'config', 'branch.main.merge', 'refs/heads/no-such-branch');
  assert.equal((await updates.check({ root: r.jade })).state, 'gone');
  assert.match((await updates.apply({ root: r.jade })).reason, /could not be found on GitHub/);
});

test('git busy in this copy gives a plain reason with no path in it', async () => {
  const r = repos();
  r.push('a.txt', 'a\n', 'Add a thing');
  fs.writeFileSync(path.join(r.jade, '.git', 'index.lock'), '');
  try {
    const out = await updates.apply({ root: r.jade });
    assert.equal(out.ok, false);
    assert.match(out.reason, /Another git program/);
    assert.doesNotMatch(out.reason, /[\\/]/);
  } finally { fs.rmSync(path.join(r.jade, '.git', 'index.lock'), { force: true }); }
});

test('git never asks for a password: no password-asking program is started', async () => {
  const r = repos();
  const log = path.join(t.root, 'askpass.log');
  const ask = path.join(t.root, process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh');
  fs.writeFileSync(ask, process.platform === 'win32' ? `@echo asked>>"${log}"\r\n` : `#!/bin/sh\necho asked >> '${log}'\necho x\n`, { mode: 0o755 });
  git(r.jade, 'config', 'core.askPass', ask);
  // a server that asks for a password, as a private GitHub copy would
  const srv = http.createServer((req, res) => { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' }); res.end(); });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  git(r.jade, 'remote', 'set-url', 'origin', `http://127.0.0.1:${srv.address().port}/private.git`);
  const old = process.env.GIT_ASKPASS; process.env.GIT_ASKPASS = ask;
  try { assert.equal((await updates.check({ root: r.jade })).state, 'unreachable'); }
  finally { if (old === undefined) delete process.env.GIT_ASKPASS; else process.env.GIT_ASKPASS = old; srv.close(); }
  assert.equal(fs.existsSync(log), false);
});

test('ssh the person set up for this copy is used as it is', { skip: process.platform === 'win32' && 'the stand-in ssh is a shell script' }, async () => {
  const r = repos();
  const log = path.join(t.root, 'ssh.log');
  const ssh = path.join(t.root, 'my-ssh.sh');
  // a stand-in ssh: notes that it was used, then runs the command git asked for (the last argument) on this machine
  fs.writeFileSync(ssh, `#!/bin/sh\necho used >> '${log}'\nfor a; do last=$a; done\nexec sh -c "$last"\n`, { mode: 0o755 });
  git(r.jade, 'config', 'core.sshCommand', ssh);
  git(r.jade, 'remote', 'set-url', 'origin', `ssh://stand-in${r.remote.replace(/\\/g, '/')}`);
  r.push('a.txt', 'a\n', 'Add a thing');
  assert.equal((await updates.check({ root: r.jade })).state, 'behind');
  assert.ok(fs.existsSync(log), 'the person\'s own ssh was used');
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
