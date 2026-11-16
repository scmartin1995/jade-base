#!/usr/bin/env node
process.title = 'Jade launcher';
// Jade launcher. Runs the server as a child process and restarts it when core server files change or it crashes,
// so editing Jade never needs a manual restart. Open windows reconnect on their own.
//   node jade.js            start and open the browser
//   node jade.js --no-open  start without opening a window
//   node jade.js --open     only open the window, for a Jade that is already running
//   node jade.js --tab      open a browser tab instead of an app window (also JADE_WINDOW=tab, or `window` in config.json)
//   JADE_HOME=~/Somewhere   keep data somewhere else (default ~/JadeBase)
//   JADE_PORT=<number>      change the port (default: DEFAULT_PORT in server/core/config.js)
import { fork, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as config from './server/core/config.js';
import { openJade } from './server/core/opener.js';

const { JADE_HOME, port } = config;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(ROOT, 'server', 'index.js');
const PORT = port();
// `node jade.js --open`: only open the window (what scripts/jade and scripts/jade.cmd call once the server is up). Starts no server.
if (process.argv.includes('--open')) { await openJade({ port: PORT, spawn }); process.exit(0); }
const BASE = `http://127.0.0.1:${PORT}`;
const [major] = process.versions.node.split('.').map(Number);
if (major < 20) { console.error(`Jade needs Node 20 or newer (you have ${process.version}). Get it from https://nodejs.org`); process.exit(1); }

// The launcher's pid, in its own data folder, so `jade --stop` stops this Jade and no other. Only one launcher per data folder: a second
// one must not take the file over (its exit would delete it and leave the first Jade running with nothing to stop it by).
const PID_FILE = path.join(JADE_HOME, '.state', 'jade.pid');
function runningLauncher() {
  let pid = 0; try { pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim()); } catch { return 0; }
  if (!(pid > 0) || pid === process.pid) return 0;
  try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') return 0; }
  // a pid can be reused by an unrelated program after a crash or a power cut (the file is not removed then): the process has to look like Jade's launcher
  return looksLikeJade(pid) ? pid : 0;
}
function looksLikeJade(pid) {
  try { return /jade/i.test(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')); } catch { /* no /proc here */ }
  try {
    const cmd = process.platform === 'win32' ? ['tasklist', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh']] : ['ps', ['-o', 'command=', '-p', String(pid)]];
    const out = spawnSync(cmd[0], cmd[1], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    if (out.status === 0 && out.stdout.trim()) return process.platform === 'win32' ? /node|jade/i.test(out.stdout) : /jade/i.test(out.stdout);
    return false;   // the system says there is no such program (or says nothing): not a running launcher
  } catch { return false; }
}
const other = runningLauncher();
if (other) { console.error(`Jade is already running (launcher ${other}, data folder ${JADE_HOME}). To stop it: jade --stop`); process.exit(1); }

let child = null, opened = process.argv.includes('--no-open'), restarting = false, crashes = 0;

function openBrowser() {
  if (opened) return;
  opened = true;
  // the window opens a small file in the owner-only data folder that moves on to the start link, so the key is never in a program's arguments
  openJade({ port: PORT, spawn });
}

// Only one server at a time: a pending crash-restart and a file-change restart must never both start one.
let pendingStart = null, portRetries = 0;
function scheduleStart(ms) { clearTimeout(pendingStart); pendingStart = setTimeout(() => { pendingStart = null; start(); }, ms); }

function start() {
  if (child) return;
  clearTimeout(pendingStart); pendingStart = null;
  const me = child = fork(ENTRY, [], { stdio: 'inherit' });
  me.on('message', m => {
    if (m?.ready) { crashes = 0; portRetries = 0; openBrowser(); process.env.JADE_LINK_SHOWN = '1'; }   // the start link is shown once, not at every restart
    if (typeof m?.running === 'number' && child === me) busyRuns = m.running;
  });
  me.on('exit', code => {
    if (child === me) { child = null; busyRuns = 0; }
    if (restarting) { restarting = false; return scheduleStart(150); }
    if (code === 3) {                            // port in use: often the old server still letting go; retry a few times
      if (++portRetries > 4) { console.error(`Port ${PORT} stays busy; another program is using it. Stopping.`); process.exit(3); }
      return scheduleStart(1000 * portRetries);
    }
    if (++crashes > 5) { console.error('Jade keeps crashing; stopping. Fix the error above, then run npm start again.'); process.exit(1); }
    console.error(`Jade server exited (${code}); restarting…`);
    scheduleStart(800 * crashes);
  });
}

// A code change restarts the server, but not in the middle of a reply: the server reports how many runs are going
// (server/core/jobs.js), and the restart waits until that is zero, or 10 minutes at most.
let t = null, busyRuns = 0, heldSince = 0;
const HOLD_MAX_MS = 10 * 60e3;
function restart(why) {
  clearTimeout(t);
  t = setTimeout(() => {
    if (busyRuns > 0 && child) {
      if (!heldSince) { heldSince = Date.now(); console.log(`↻ ${why} changed; restarting once the ${busyRuns} running repl${busyRuns === 1 ? 'y' : 'ies'} finish`); }
      if (Date.now() - heldSince < HOLD_MAX_MS) return restart(why);
      console.log('↻ still busy after 10 minutes, restarting anyway');
    }
    heldSince = 0;
    console.log(`↻ ${why} changed, restarting the server`);
    crashes = 0;                                 // a fresh edit deserves fresh attempts
    if (!child) return scheduleStart(0);
    restarting = true;
    child.kill();
  }, heldSince ? 1000 : 250);
}

// Only a real change to a file's contents restarts the server. On Windows, reading a file can update its last-access time, which
// fs.watch reports as a change: a chat reading Jade's code, or anything else opening it, restarted the server and cut off whatever
// was running ("Interrupted by restart"). It looked random because Windows only updates that time about once an hour.
const seen = new Map();
const text = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
// Module manifests (built in, and the user's in the data folder) are read once at boot, so a change to one restarts the server.
const USER_MODULES = path.join(JADE_HOME, 'modules');
try { fs.mkdirSync(USER_MODULES, { recursive: true }); } catch {}
for (const dir of [path.join(ROOT, 'server', 'core'), path.join(ROOT, 'server'), path.join(ROOT, 'server', 'modules'), USER_MODULES]) {
  try {
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) seen.set(path.join(dir, f), text(path.join(dir, f)));
    fs.watch(dir, (ev, f) => {
      if (!f || !String(f).endsWith('.js')) return;
      const full = path.join(dir, String(f));
      if (dir.endsWith('server') && (f === 'api.js' || !fs.existsSync(full) || fs.statSync(full).isDirectory())) return;
      const now = text(full);
      if (now !== null && now === seen.get(full)) return; // read, not changed
      seen.set(full, now);
      restart(f);
    });
  } catch {}
}

try { fs.mkdirSync(path.dirname(PID_FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(PID_FILE, String(process.pid)); } catch {}
process.on('exit', () => { try { if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.unlinkSync(PID_FILE); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restarting = false; child?.kill(); process.exit(0); });
start();
