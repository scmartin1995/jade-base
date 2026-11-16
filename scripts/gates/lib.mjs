// Shared by the gates and by the test helpers: a free port, waiting for a condition, a stand-in `claude`, a PATH that
// cannot reach a real one, starting and stopping the server, and finding a browser on Linux, macOS and Windows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GATE_TOKEN = 'gate-secret';   // the server's key for a gate run (JADE_TOKEN)
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const WIN = process.platform === 'win32';

export const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });

/** Poll `fn` until it returns something truthy; give that value back. Throws `message` after `timeout` ms. */
export async function waitFor(fn, { timeout = 10000, interval = 25, message = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out after ${timeout} ms waiting for: ${message}`);
    await sleep(interval);
  }
}

/** PATH without any folder that holds a `claude`, so nothing a gate or test starts can reach a real one. A stand-in folder goes first. */
export function safePath(standInDir = '', basePath = process.env.PATH || '') {
  const names = WIN ? ['claude.exe', 'claude.cmd', 'claude.bat', 'claude'] : ['claude'];
  const kept = basePath.split(path.delimiter).filter(d => d && !names.some(n => { try { return fs.existsSync(path.join(d, n)); } catch { return false; } }));
  return [standInDir, path.dirname(process.execPath), ...kept].filter(Boolean).join(path.delimiter);
}

// The stand-in `claude`. One script serves every caller:
//  - `claude auth ...` and anything else that is not a run: answers {} and exits;
//  - a one-shot run (-p): reads the prompt, answers with the text in <bin>/reply.txt (default "done") as a result line;
//  - a conversation (--input-format stream-json): for each line it answers "echo: <what was said>" in two streamed pieces,
//    unless what was said this turn contains HANG, which it never answers (so a test can stop it).
// Every run appends { args, stdin } to <bin>/calls.jsonl, so a test can see what was asked.
const STAND_IN = `const fs = require('fs'), path = require('path');
const dir = __dirname, a = process.argv.slice(2);
const log = o => { try { fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify(o) + '\\n'); } catch {} };
const reply = () => { try { return fs.readFileSync(path.join(dir, 'reply.txt'), 'utf8'); } catch { return 'done'; } };
if (a[0] !== '-p') { if (a[0] === 'auth') process.stdout.write('{}'); process.exit(0); }
const say = o => process.stdout.write(JSON.stringify(o) + '\\n');
if (a.includes('--input-format')) {
  let buf = '';
  process.stdin.on('data', c => {
    buf += c; let nl;
    while ((nl = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let said = ''; try { const c = JSON.parse(line).message.content; said = typeof c === 'string' ? c : JSON.stringify(c); } catch { said = line; }
      log({ args: a, stdin: said });
      say({ type: 'system', subtype: 'init', model: 'stand-in' });
      const m = /# This turn\\nThe user says \\(by [a-z ]+\\): "([\\s\\S]*?)"\\n/.exec(said), turn = m ? m[1] : said;   // Jade wraps what was said; earlier turns in the history do not count
      if (turn.includes('HANG')) continue;
      const text = 'echo: ' + turn.split('\\n').pop().slice(0, 80), cut = Math.ceil(text.length / 2);
      const delta = t => say({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } });
      delta(text.slice(0, cut));
      setTimeout(() => { delta(text.slice(cut)); say({ type: 'result', result: text, is_error: false }); }, 30);
    }
  });
} else {
  let inp = '';
  process.stdin.on('data', c => { inp += c; });
  process.stdin.on('end', () => { log({ args: a, stdin: inp }); say({ type: 'result', result: reply(), is_error: false }); });
}
`;

/** Write the stand-in `claude` into `binDir` (made if needed) and return that folder, ready to put first on PATH. */
export function writeStandIn(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const script = path.join(binDir, 'claude-stand-in.js');
  fs.writeFileSync(script, STAND_IN);
  if (WIN) fs.writeFileSync(path.join(binDir, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0claude-stand-in.js" %*\r\n`);
  else fs.writeFileSync(path.join(binDir, 'claude'), `#!${process.execPath}\nrequire('./claude-stand-in.js');\n`, { mode: 0o755 });
  return binDir;
}

/** A temp home and Claude folder (never the real ones) with a stand-in `claude`; `cleanup()` removes it all. */
export function gateSandbox(prefix = 'jade-gate') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
  const home = path.join(root, 'home'), claudeHome = path.join(root, 'claude'), bin = writeStandIn(path.join(root, 'bin'));
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(claudeHome, { recursive: true });
  return { root, home, claudeHome, bin, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Stop a child and the processes it started (a browser has helpers): the whole group on Linux and macOS, the tree on Windows. */
export async function stopTree(p) {
  if (!p || p.exitCode !== null || p.signalCode) return;
  const signal = sig => {
    if (WIN) { try { spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } return; }
    try { process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch { /* gone */ } }
  };
  signal('SIGTERM');
  for (let i = 0; i < 30 && p.exitCode === null && !p.signalCode; i++) await sleep(100);
  signal('SIGKILL');   // stragglers in the group go too
}

/**
 * Start the real server on a free port with the given folders and a PATH that holds only the stand-in `claude`.
 * Returns { base, port, token, child, stderr(), exited(), stop() }; waits until /api/boot answers.
 */
export async function startServer({ home, claudeHome, bin = '', token = GATE_TOKEN, env = {}, timeout = 20000, detached = false } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    env: { ...process.env, PATH: safePath(bin), JADE_HOME: home, JADE_CLAUDE_HOME: claudeHome, JADE_PORT: String(port), JADE_TOKEN: token, ...env },
    stdio: ['ignore', 'ignore', 'pipe'], detached: detached && !WIN,
  });
  let err = '', gone = false;
  child.stderr.on('data', d => { err += d; });
  child.on('exit', () => { gone = true; });
  const base = `http://127.0.0.1:${port}`;
  const server = { base, port, token, child, stderr: () => err, exited: () => gone, stop: async () => { if (detached) await stopTree(child); else if (!gone) { child.kill('SIGTERM'); await waitFor(() => gone, { timeout: 3000, message: 'server to stop' }).catch(() => child.kill('SIGKILL')); } } };
  try {
    await waitFor(async () => { if (gone) throw new Error('exited'); return (await fetch(base + '/api/boot', { headers: { 'x-jade': token } })).status === 200; }, { timeout, interval: 100, message: 'the server to answer /api/boot' });
  } catch (e) { await server.stop(); throw new Error(`${e.message}${gone ? ' (the server exited)' : ''}\n${err.trim().slice(0, 800)}`); }
  return server;
}

/** The path of a Chromium-family browser, or '' when none is found. $CHROMIUM or $CHROME_BIN wins. */
export function findBrowser(env = process.env, exists = fs.existsSync) {
  const given = env.CHROMIUM || env.CHROME_BIN;
  if (given) return exists(given) ? given : '';
  const files = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    win32: ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].flatMap(v => env[v] ? ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'Chromium\\Application\\chrome.exe'].map(r => path.join(env[v], r)) : []),
    linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium', '/usr/bin/microsoft-edge', '/usr/bin/brave-browser'],
  }[process.platform] || [];
  for (const f of files) if (exists(f)) return f;
  if (process.platform !== 'win32') {   // anything with a browser name on PATH
    for (const d of (env.PATH || '').split(path.delimiter).filter(Boolean)) for (const n of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']) { const f = path.join(d, n); if (exists(f)) return f; }
  }
  return '';
}
