// The update check. Jade compares its own copy (a git checkout) with the branch it follows on GitHub, every few hours while
// `updates.check` is on, and says how many changes are waiting. Update now brings it level with a fast-forward only: it never
// merges, rebases or throws away anything made in this copy. Only git talks to GitHub; nothing about the person is sent.
// Every git call is asynchronous with a time limit, so nothing here holds up the server, and any failure is a state, never a throw.
// JADE_UPDATE_ROOT points the check at another copy (tests use it, so they never fetch into the real one).
import { execFile } from 'node:child_process';
import * as config from './config.js';
import * as engines from './engines.js';
import { emit } from './bus.js';
import { redact } from './redact.js';

export const root = () => process.env.JADE_UPDATE_ROOT || config.APP_ROOT;
const FIRST_CHECK_MS = 60e3;            // after start, so the first minute belongs to the person
const EVERY_MS = 6 * 60 * 60e3;         // then every six hours
const LATEST = 5;                       // how many change titles the page shows

// A git that may need a password or a passphrase must fail, not wait for an answer nobody will give.
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...(process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }) });
function git(dir, args, timeout = 15000) {
  return new Promise(resolve => {
    execFile('git', ['-C', dir, ...args], { encoding: 'utf8', timeout, windowsHide: true, env: gitEnv(), maxBuffer: 1e6 },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() }));
  });
}

let last = { state: 'unknown', behind: 0, ahead: 0, latest: [], checkedAt: null };
// One git job at a time: a check and an update never run side by side.
let lock = Promise.resolve();
const serial = fn => { const p = lock.then(fn, fn); lock = p.catch(() => {}); return p; };
/** The last result, for the page. Never runs git. */
export function status() { return { ...last, check: config.get().updates?.check !== false }; }
function remember(s) { last = { ...s, checkedAt: Date.now() }; emit('update', status()); return status(); }

/** Where this copy is and what it follows: { dir, upstream } or a state saying why it cannot be checked. */
async function where(dir) {
  // the top of a repository of its own: a folder that only sits inside some other repository is not a copy of Jade
  const prefix = await git(dir, ['rev-parse', '--show-prefix']);
  if (!prefix.ok || prefix.out) return { state: 'not-git' };
  const branch = await git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch.ok) return { state: 'no-branch' };
  const remote = await git(dir, ['config', `branch.${branch.out}.remote`]);
  const merge = await git(dir, ['config', `branch.${branch.out}.merge`]);
  if (!remote.ok || !merge.ok || !remote.out || remote.out === '.') return { state: 'no-upstream', branch: branch.out };
  return { branch: branch.out, remote: remote.out, merge: merge.out };
}

async function counts(dir, w) {
  const lr = await git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  if (!lr.ok) return { state: 'unreachable' };
  const [ahead, behind] = lr.out.split(/\s+/).map(Number);
  const titles = behind ? await git(dir, ['log', '--format=%s', '-n', String(LATEST), 'HEAD..@{u}']) : { out: '' };
  const state = behind && ahead ? 'diverged' : behind ? 'behind' : 'current';
  return { state, ahead, behind, branch: w.branch, latest: titles.out ? titles.out.split('\n').map(s => redact(s).slice(0, 200)) : [] };
}

async function doCheck(dir) {
  const w = await where(dir);
  if (w.state) return remember({ behind: 0, ahead: 0, latest: [], ...w });
  const f = await git(dir, ['fetch', '--quiet', '--no-tags', w.remote, w.merge], 60000);
  if (!f.ok) return remember({ state: 'unreachable', behind: 0, ahead: 0, latest: [], branch: w.branch });
  return remember(await counts(dir, w));
}

/** Ask GitHub now. Runs whether or not the automatic check is on: the person asked. */
export function check({ root: dir = root() } = {}) { return serial(() => doCheck(dir)); }

/** The automatic check: does nothing while `updates.check` is off. */
export async function auto(opts = {}) {
  if (config.get().updates?.check === false) return { ...status(), state: 'off' };
  return check(opts);
}

/** What git said, in plain words. */
function why(err) {
  if (/would be overwritten|commit your changes|stash them|untracked working tree files/i.test(err)) return 'This copy of Jade has changes of its own in files the update also changes, so nothing was changed. Undo or save those changes, then update again.';
  if (/not possible to fast-forward|diverg|not fast-forward/i.test(err)) return 'This copy of Jade has changes of its own that GitHub does not have, so it cannot be updated by itself. Nothing was changed.';
  return `The update did not finish: ${redact(err.split('\n')[0] || 'git gave no reason').slice(0, 300)}`;
}

async function doApply(dir) {
  const w = await where(dir);
  if (w.state) return { ok: false, reason: w.state === 'not-git' ? 'This copy of Jade was not installed with git, so it cannot update itself. Download the new version from GitHub instead.' : 'This copy of Jade does not follow a branch on GitHub, so there is nothing to update from.' };
  const f = await git(dir, ['fetch', '--quiet', '--no-tags', w.remote, w.merge], 60000);
  if (!f.ok) { remember({ state: 'unreachable', behind: 0, ahead: 0, latest: [], branch: w.branch }); return { ok: false, reason: 'GitHub could not be reached. Check the internet connection and try again.' }; }
  const c = await counts(dir, w);
  if (c.state === 'current') { remember(c); return { ok: true, changed: 0, note: 'Jade is already up to date.' }; }
  if (c.state === 'diverged') { remember(c); return { ok: false, reason: why('not possible to fast-forward') }; }
  const from = (await git(dir, ['rev-parse', 'HEAD'])).out;
  const m = await git(dir, ['merge', '--ff-only', '--quiet', '@{u}'], 60000);
  if (!m.ok) { remember(c); return { ok: false, reason: why(m.err) }; }
  const files = (await git(dir, ['diff', '--name-only', from, 'HEAD'])).out.split('\n').filter(Boolean);
  remember(await counts(dir, w));
  // The launcher restarts the server when server code changes, and open pages reload their own files; the launcher itself
  // (jade.js) and a server started without it only take a new version when Jade is started again.
  const manual = !process.send || files.some(f => f === 'jade.js' || f === 'package.json');
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
