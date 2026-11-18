// The update check. Jade compares its own copy (a git checkout) with the branch it follows on GitHub, every few hours while
// `updates.check` is on, and says how many changes are waiting. Update now brings it level with a fast-forward only: it never
// merges, rebases or throws away anything made in this copy. Only git talks to GitHub; nothing about the person is sent.
// Every git call is asynchronous with a time limit, so nothing here holds up the server, and any failure is a state, never a throw.
// JADE_UPDATE_ROOT points the check at another copy (tests use it, so they never fetch into the real one).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as config from './config.js';
import * as engines from './engines.js';
import { emit } from './bus.js';
import { redact } from './redact.js';

export const root = () => process.env.JADE_UPDATE_ROOT || config.APP_ROOT;
const FIRST_CHECK_MS = 60e3;            // after start, so the first minute belongs to the person
const EVERY_MS = 6 * 60 * 60e3;         // then every six hours
const LATEST = 5;                       // how many change titles the page shows
const NET_MS = 60e3;                    // the longest a fetch may take

/**
 * git's environment. A git that would need a password or a passphrase must fail at once, not wait for an answer nobody will give:
 * no terminal prompt, no password-asking program (GIT_ASKPASS empty beats core.askPass and SSH_ASKPASS), and ssh in batch mode,
 * unless the person has set up ssh of their own (GIT_SSH, GIT_SSH_COMMAND or core.sshCommand), which is then left as it is.
 * Messages in English (LC_ALL=C), so `why` can put them in plain words.
 */
function gitEnv(ownSsh) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GCM_INTERACTIVE: 'never', LC_ALL: 'C', LANGUAGE: 'C' };
  if (!ownSsh && !process.env.GIT_SSH && !process.env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=20';
  return env;
}
// A slow or silent server ends a transfer instead of holding it open (git's own low-speed limit), and paths come back unquoted.
const NET_OPTS = ['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=30', '-c', 'core.quotePath=false'];

/** Run git; on its time limit stop git and everything it started (ssh, the https helper), not git alone. */
function git(dir, args, { timeout = 15000, ownSsh = false, maxOut = 1e6 } = {}) {
  return new Promise(resolve => {
    let out = '', err = '', done = false, child;
    const finish = r => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    try {
      child = spawn('git', ['-C', dir, ...NET_OPTS, ...args], { windowsHide: true, env: gitEnv(ownSsh), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch (e) { return resolve({ ok: false, out: '', err: String(e.message || e), missing: e.code === 'ENOENT' }); }
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
        else process.kill(-child.pid, 'SIGKILL');   // the whole group: git and what it started
      } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
      finish({ ok: false, out: '', err: 'timed out', timedOut: true });
    }, timeout);
    let cut = false;
    child.stdout.on('data', d => { if (out.length < maxOut) out += d; else cut = true; });
    child.stderr.on('data', d => { if (err.length < 1e5) err += d; });
    child.on('error', e => finish({ ok: false, out: '', err: String(e.message || e), missing: e.code === 'ENOENT' }));
    child.on('close', code => finish({ ok: code === 0, out: out.trim(), err: err.trim(), cut }));
  });
}

let last = { state: 'unknown', behind: 0, ahead: 0, latest: [], checkedAt: null };
// One git job at a time: a check and an update never run side by side.
let lock = Promise.resolve();
const serial = fn => { const p = lock.then(fn, fn); lock = p.catch(() => {}); return p; };
/** The last result, for the page. Never runs git. */
export function status() { return { ...last, check: config.get().updates?.check !== false }; }
const EMPTY = { behind: 0, ahead: 0, latest: [] };
function remember(s) { last = { ...EMPTY, ...s, checkedAt: Date.now() }; emit('update', status()); return status(); }

/** Where this copy is and what it follows: { branch, remote, merge, ownSsh } or { state } saying why it cannot be checked. */
async function where(dir) {
  // the top of a work tree of its own: a folder that only sits inside some other repository (or a .git folder) is not a copy of Jade
  const top = await git(dir, ['rev-parse', '--is-inside-work-tree', '--show-prefix']);
  if (top.missing) return { state: 'no-git' };
  if (/dubious ownership/i.test(top.err)) return { state: 'not-trusted' };
  const [inside, prefix = ''] = top.out.split('\n');
  if (!top.ok || inside !== 'true' || prefix) return { state: 'not-git' };
  const branch = await git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch.ok) return { state: 'no-branch' };
  const remote = await git(dir, ['config', `branch.${branch.out}.remote`]);
  const merge = await git(dir, ['config', `branch.${branch.out}.merge`]);
  // a name from the copy's own settings that starts with "-" would be read by git as an option: not followed
  if (!remote.ok || !merge.ok || !remote.out || remote.out === '.' || /^-/.test(remote.out) || /^-/.test(merge.out)) return { state: 'no-upstream', branch: branch.out };
  const ownSsh = !!(await git(dir, ['config', 'core.sshCommand'])).out;
  return { branch: branch.out, remote: remote.out, merge: merge.out, ownSsh };
}

async function fetch(dir, w) {
  const f = await git(dir, ['fetch', '--quiet', '--no-tags', w.remote, w.merge], { timeout: NET_MS, ownSsh: w.ownSsh });
  if (f.ok) return null;
  // the branch is gone from GitHub (or this copy's fetch settings do not bring it): not the same as being offline
  if (/couldn't find remote ref|no such ref|unknown revision/i.test(f.err)) return { state: 'gone', branch: w.branch };
  return { state: 'unreachable', branch: w.branch };
}

async function counts(dir, w) {
  const lr = await git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  if (!lr.ok) return { state: 'gone', branch: w.branch };   // the branch it follows is not known here (fetched, yet no remote ref)
  const [ahead, behind] = lr.out.split(/\s+/).map(Number);
  const titles = behind ? await git(dir, ['log', '--format=%s', '-n', String(LATEST), 'HEAD..@{u}']) : { out: '' };
  const state = behind && ahead ? 'diverged' : behind ? 'behind' : 'current';
  return { state, ahead, behind, branch: w.branch, latest: titles.out ? titles.out.split('\n').map(s => redact(s).slice(0, 200)) : [] };
}

async function doCheck(dir) {
  const w = await where(dir);
  if (w.state) return remember(w);
  const f = await fetch(dir, w);
  return remember(f || await counts(dir, w));
}

/** Ask GitHub now. Runs whether or not the automatic check is on: the person asked. */
export function check({ root: dir = root() } = {}) { return serial(() => doCheck(dir)); }

/** The automatic check: does nothing while `updates.check` is off. */
export async function auto(opts = {}) {
  if (config.get().updates?.check === false) return { ...status(), state: 'off' };
  return check(opts);
}

// What each state means for Update now, in plain words.
const CANNOT = {
  'no-git': 'git is not installed on this computer, so Jade cannot update itself. Download the new version from GitHub instead.',
  'not-trusted': 'git will not work in this copy of Jade because the folder belongs to another user account on this computer. Ask whoever installed Jade.',
  'not-git': 'This copy of Jade was not installed with git, so it cannot update itself. Download the new version from GitHub instead.',
  'no-branch': 'This copy of Jade is not on a branch, so there is nothing to update from.',
  'no-upstream': 'This copy of Jade does not follow a branch on GitHub, so there is nothing to update from.',
  gone: 'The branch this copy of Jade follows could not be found on GitHub (it may have been deleted), so there is nothing to update from.',
  unreachable: 'GitHub could not be reached. Check the internet connection and try again.',
};
const OWN_CHANGES = 'This copy of Jade has changes of its own in files the update also changes, so nothing was changed. Undo or save those changes, then update again.';
/** What git said, in plain words; never a path or git's own wording beyond its first line, with any secret hidden. */
export function why(err) {
  if (/would be overwritten|commit your changes|stash them|untracked working tree files/i.test(err)) return OWN_CHANGES;
  if (/not possible to fast-forward|diverg|not fast-forward/i.test(err)) return 'This copy of Jade has changes of its own that GitHub does not have, so it cannot be updated by itself. Nothing was changed.';
  if (/index\.lock|another git process/i.test(err)) return 'Another git program is working in this copy of Jade right now. Nothing was changed; try again in a minute.';
  const line = (err.split('\n')[0] || 'git gave no reason')
    .replace(/(['"])(?:[a-z]+:)?(?:[A-Za-z]:)?[\\/][^'"]*\1/gi, '$1…$1')   // a quoted path, spaces and all
    .replace(/(^|[\s(=:])(?:[A-Za-z]:)?[\\/][^\s'")]+/g, '$1…');      // a bare path, after a space, a bracket, = or :
  return `The update did not finish (${redact(line).slice(0, 200)}). Nothing was changed.`;
}

/**
 * Files git ignores that the update would overwrite without a word, so they stop it: a file the update adds (renames count as
 * adds) that is already here, or a file here where the update puts a folder. A tracked file the update removes is git's to handle.
 */
async function ignoredInTheWay(dir) {
  const d = await git(dir, ['diff', '--name-status', '--no-renames', '-z', 'HEAD', '@{u}'], { maxOut: 64e6 });
  if (!d.ok || d.cut) return ['(the list of changes could not be read in full)'];
  const parts = d.out.split('\0'), added = [], removed = new Set();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (parts[i] === 'A') added.push(parts[i + 1]);
    else if (parts[i] === 'D') removed.add(parts[i + 1]);
  }
  const here = f => { try { return fs.lstatSync(path.join(dir, f)); } catch { return null; } };
  // a folder here that the update turns into a file is fine once the update's own removals have emptied it
  const emptiedByUpdate = f => {
    try {
      return fs.readdirSync(path.join(dir, f), { withFileTypes: true }).every(e => {
        const p = `${f}/${e.name}`;
        return e.isDirectory() && !e.isSymbolicLink() ? emptiedByUpdate(p) : removed.has(p);
      });
    } catch { return false; }
  };
  const inTheWay = new Set();
  for (const f of added) {
    const st = here(f);
    if (st && !(st.isDirectory() && emptiedByUpdate(f))) { inTheWay.add(f); continue; }
    if (st) continue;
    const steps = f.split('/');
    for (let k = 1; k < steps.length; k++) {
      const parent = steps.slice(0, k).join('/'), st = here(parent);
      if (!st) break;
      if (!st.isDirectory() && !removed.has(parent)) { inTheWay.add(parent); break; }
    }
  }
  return [...inTheWay];
}

async function doApply(dir) {
  const w = await where(dir);
  if (w.state) return { ok: false, reason: CANNOT[w.state] };
  const f = await fetch(dir, w);
  if (f) { remember(f); return { ok: false, reason: CANNOT[f.state] }; }
  const c = await counts(dir, w);
  if (c.state === 'gone') { remember(c); return { ok: false, reason: CANNOT.gone }; }
  if (c.state === 'current') { remember(c); return { ok: true, changed: 0, note: 'Jade is already up to date.' }; }
  if (c.state === 'diverged') { remember(c); return { ok: false, reason: why('not possible to fast-forward') }; }
  if ((await ignoredInTheWay(dir)).length) { remember(c); return { ok: false, reason: OWN_CHANGES }; }
  const from = (await git(dir, ['rev-parse', 'HEAD'])).out;
  const m = await git(dir, ['merge', '--ff-only', '--quiet', '@{u}'], { timeout: 60000 });
  if (!m.ok) { remember(c); return { ok: false, reason: why(m.err) }; }
  const files = (await git(dir, ['diff', '--name-only', from, 'HEAD'])).out.split('\n').filter(Boolean);
  remember(await counts(dir, w));
  // The launcher restarts the server when server code changes, and open pages reload their own files; the launcher itself
  // (jade.js) and a server started without it only take a new version when Jade is started again.
  const manual = !process.send || files.some(x => x === 'jade.js' || x === 'package.json');
  const note = manual ? 'Updated. Close Jade and start it again to finish.' : 'Updated. Jade restarts by itself in a moment, once nothing is running.';
  emit('toast', { kind: 'success', text: note });
  return { ok: true, changed: files.length, restart: manual ? 'manual' : 'auto', note };
}

/** Update now: bring this copy level with GitHub, fast-forward only. Returns { ok, reason?, note?, changed }. */
export function apply({ root: dir = root() } = {}) { return serial(() => doApply(dir)); }

let ver = { at: 0, text: '' };
/** The installed Claude Code's version ('' when it is not there or does not say), remembered for ten minutes. */
export async function claudeVersion() {
  if (Date.now() - ver.at < 10 * 60e3) return ver.text;
  const bin = engines.detect().claude?.bin;
  let text = '';
  if (bin) text = await new Promise(resolve => {
    let out = '';
    try {
      const p = engines.spawnCli(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const stop = setTimeout(() => { try { p.kill(); } catch {} resolve(''); }, 10000);
      p.stdout.on('data', d => { out += d; });
      p.on('error', () => { clearTimeout(stop); resolve(''); });
      p.on('close', () => { clearTimeout(stop); resolve((/\d+\.\d+\.\d+\S*/.exec(out) || [''])[0]); });
    } catch { resolve(''); }
  });
  ver = { at: Date.now(), text };
  return text;
}

let timers = [];
/** Start the automatic check: once a minute after start, then every six hours. */
export function start() {
  stop();
  const first = setTimeout(() => auto().catch(() => {}), FIRST_CHECK_MS);
  const every = setInterval(() => auto().catch(() => {}), EVERY_MS);
  first.unref?.(); every.unref?.();
  timers = [first, every];
}
export function stop() { for (const x of timers) { clearTimeout(x); clearInterval(x); } timers = []; }
