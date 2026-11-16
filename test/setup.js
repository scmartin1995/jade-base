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
