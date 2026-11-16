// A temp folder for one test file, with throw-away Jade and Claude folders inside it (never the real ones).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * tmpHome('jade-foo-') makes <tmp>/home (JADE_HOME), <tmp>/claude (JADE_CLAUDE_HOME) and <tmp>/bin, and returns
 * { root, home, claudeHome, bin, env, cleanup }. With { apply: true } it also sets JADE_HOME and JADE_CLAUDE_HOME in this
 * process, for a test that imports server code in-process (do that before the first import of server/core/config.js).
 */
export function tmpHome(prefix = 'jade-test-', { apply = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(root, 'home'), claudeHome = path.join(root, 'claude'), bin = path.join(root, 'bin');
  for (const d of [home, claudeHome, bin]) fs.mkdirSync(d, { recursive: true });
  if (apply) { process.env.JADE_HOME = home; process.env.JADE_CLAUDE_HOME = claudeHome; }
  return { root, home, claudeHome, bin, env: { JADE_HOME: home, JADE_CLAUDE_HOME: claudeHome }, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** Write a file, making its folders first. Returns the path. */
export const put = (f, text = 'x') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };

/** A skip reason for a test that makes a file or folder read-only with chmod: Windows ignores that, so nothing would be refused there. */
export const NO_READ_ONLY = process.platform === 'win32' && 'not checked on Windows: chmod cannot make a file or folder read-only there';
