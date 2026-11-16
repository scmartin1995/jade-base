// Loaded before every test file (node --test --import ./test/setup.js). A test that does not choose its own folders gets
// throw-away ones, so no test can read or write the real data folder or the real ~/.claude.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeDir } from './helpers/rm.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-test-'));
if (!process.env.JADE_HOME) process.env.JADE_HOME = path.join(root, 'home');
if (!process.env.JADE_CLAUDE_HOME) process.env.JADE_CLAUDE_HOME = path.join(root, 'claude');
// A server a test starts (and the bridge it drives) shares this secret; a test of the secret itself starts its own server with another.
if (!process.env.JADE_TOKEN) process.env.JADE_TOKEN = '1';
process.on('exit', () => { try { removeDir(root); } catch {} });

// A real `claude` must never run from a test (it would read and write the real ~/.claude): take every folder that holds one out of PATH.
// A test that needs a stand-in puts its own folder first on PATH, which is unaffected.
const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude.bat', 'claude'] : ['claude'];
process.env.PATH = (process.env.PATH || '').split(path.delimiter)
  .filter(d => d && !names.some(n => { try { return fs.existsSync(path.join(d, n)); } catch { return false; } })).join(path.delimiter);

// JADE_TEST_HANDLES=1: when a test file's process is still alive a minute after it started, say what keeps it alive. The timer is
// unref'd, so it only ever fires when something else holds the process up, which is exactly the case to report.
if (process.env.JADE_TEST_HANDLES) {
  const report = () => {
    const out = [`[handles] ${process.argv.slice(1).join(' ')} (pid ${process.pid}) still running after 60 s`];
    try { out.push('  resources: ' + JSON.stringify(process.getActiveResourcesInfo?.() ?? [])); } catch { /* not available */ }
    try {
      for (const h of process._getActiveHandles?.() ?? []) {
        const kind = h?.constructor?.name || typeof h;
        if (h === process.stdout || h === process.stderr || h === process.stdin) { out.push(`  handle: ${kind} (standard stream)`); continue; }
        const bits = [];
        for (const k of ['pid', 'spawnfile', 'spawnargs', 'path', 'filename', '_idleTimeout', 'localPort', 'remotePort', 'connecting', 'destroyed', 'readable', 'writable']) if (h?.[k] !== undefined && typeof h[k] !== 'function') bits.push(`${k}=${JSON.stringify(h[k])}`);
        out.push(`  handle: ${kind} ${bits.join(' ')}`.slice(0, 400));
      }
    } catch { /* not available */ }
    console.error(out.join('\n'));
  };
  setTimeout(report, 60000).unref();
}
