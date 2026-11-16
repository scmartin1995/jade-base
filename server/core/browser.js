// Finding a Chromium-family browser (Chrome, Chromium, Edge, Brave) and opening Jade in it as an app window.
// One finder serves the launcher (jade.js) and the page gate (scripts/gates/lib.mjs). Nothing here reads the real machine unless it is
// called without its injected parts: tests pass `env`, `exists`, `platform` and `spawn` so they run the same on every system.
//
// The key never reaches a command line here: the launcher passes the address of the small owner-only file opener.js wrote (a file
// address with no key in it), never the start link. See docs/adr/0019-app-window.md and docs/adr/0005-server-key-and-start-link.md.
import fs from 'node:fs';
import path from 'node:path';

/** The window size Jade opens at. */
export const WINDOW_SIZE = '1280,860';
/** The window class (Linux) that desktops use to group Jade's window and show its icon. */
export const WINDOW_CLASS = 'jade-base';

const LINUX_NAMES = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge-stable', 'microsoft-edge', 'brave-browser', 'brave'];
const MAC_APPS = [['Google Chrome', 'Google Chrome'], ['Chromium', 'Chromium'], ['Microsoft Edge', 'Microsoft Edge'], ['Brave Browser', 'Brave Browser']];
const WIN_PATHS = ['Google\\Chrome\\Application\\chrome.exe', 'Chromium\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'];

/**
 * The path of a Chromium-family browser, or '' when none is found. The first of $JADE_BROWSER, $CHROMIUM and $CHROME_BIN that is set
 * decides: a path that is given but missing gives '' (it is not silently replaced). Otherwise the usual places for the system, then
 * anything with a browser's name on PATH (Linux and macOS).
 */
export function findBrowser(env = process.env, exists = fs.existsSync, platform = process.platform) {
  const given = env.JADE_BROWSER || env.CHROMIUM || env.CHROME_BIN;
  if (given) return exists(given) ? given : '';
  const p = platform === 'win32' ? path.win32 : path.posix;
  const files = [];
  if (platform === 'darwin') {
    const roots = ['/Applications', env.HOME ? p.join(env.HOME, 'Applications') : ''].filter(Boolean);
    for (const [app, bin] of MAC_APPS) for (const r of roots) files.push(p.join(r, `${app}.app`, 'Contents', 'MacOS', bin));
  } else if (platform === 'win32') {
    const roots = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].map(v => env[v]).filter(Boolean);
    if (!roots.length) roots.push('C:\\Program Files (x86)', 'C:\\Program Files');   // Edge is always there, even if the environment is bare
    for (const rel of WIN_PATHS) for (const r of roots) files.push(p.join(r, rel));
  } else {
    for (const d of ['/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/google/chrome', '/opt/microsoft/msedge']) for (const n of LINUX_NAMES) files.push(p.join(d, n));
  }
  for (const f of files) if (exists(f)) return f;
  if (platform !== 'win32') {   // anything with a browser name on PATH
    for (const d of (env.PATH || '').split(path.delimiter).filter(Boolean)) for (const n of LINUX_NAMES) { const f = p.join(d, n); if (exists(f)) return f; }
  }
  return '';
}

/** 'app' or 'tab': `--tab` beats $JADE_WINDOW, which beats the `window` setting; anything unrecognised means 'app'. */
export function windowMode({ argv = [], env = process.env, config = {} } = {}) {
  if (argv.includes('--tab')) return 'tab';
  const pick = v => { const s = String(v ?? '').trim().toLowerCase(); return s === 'app' || s === 'tab' ? s : ''; };
  return pick(env.JADE_WINDOW) || pick(config.window) || 'app';
}

/**
 * What to run to open `url` (an address with no key in it). Returns { kind, command, args, said }.
 * 'app': the browser itself with --app (a window with no address bar, tabs or bookmarks) in the person's normal profile.
 * 'tab': the system's way of opening an address in the normal browser.
 * An app window with no browser found becomes a tab.
 */
export function openPlan({ url, mode = 'app', env = process.env, exists = fs.existsSync, platform = process.platform } = {}) {
  if (mode === 'app') {
    const browser = findBrowser(env, exists, platform);
    if (browser) {
      const args = [`--app=${url}`, '--new-window', `--window-size=${WINDOW_SIZE}`];
      if (platform !== 'win32' && platform !== 'darwin') args.push(`--class=${WINDOW_CLASS}`);
      return { kind: 'app', command: browser, args, said: 'Jade opened in its own window.' };
    }
  }
  const said = mode === 'app' ? 'No Chrome, Edge, Chromium or Brave was found, so Jade opened in a browser tab.' : 'Jade opened in a browser tab.';
  const tab = platform === 'darwin' ? { command: 'open', args: [url] }
    : platform === 'win32' ? { command: 'cmd', args: ['/c', 'start', '', url] }
    : { command: 'xdg-open', args: [url] };
  return { kind: 'tab', ...tab, said };
}

/**
 * Start the plan without waiting for it: detached, no output kept, no console window on Windows. If an app window cannot be started
 * (the browser file is not runnable) a tab is tried instead. Calls `done(plan)` once with what was used, or `done(null)` when nothing
 * could be started. `spawn` is injected by tests.
 */
export function openWindow(plan, { spawn, done = () => {}, retry = null } = {}) {
  let child;
  try { child = spawn(plan.command, plan.args, { detached: true, stdio: 'ignore', windowsHide: true }); } catch { child = null; }
  const failed = () => { if (plan.kind === 'app' && retry) return openWindow(retry(), { spawn, done }); done(null); };
  if (!child) return failed();
  let settled = false;   // 'spawn' says it started, 'error' says it could not: the first one counts
  child.once('error', () => { if (!settled) { settled = true; failed(); } });
  child.once('spawn', () => { if (!settled) { settled = true; done(plan); } });
  child.unref?.();
}
