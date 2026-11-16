// The app window: finding a browser on each system, choosing app or tab, and the exact command the launcher runs.
// Everything is injected (files that exist, environment, platform, spawn), so this runs the same on Linux, macOS and Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpHome } from './helpers/env.js';
import { findBrowser, windowMode, openPlan, openWindow, WINDOW_SIZE, WINDOW_CLASS } from '../server/core/browser.js';
import { findBrowser as gateFinder } from '../scripts/gates/lib.mjs';

const has = (...files) => f => files.includes(f);
const KEY = 'k3y-should-never-appear-9f2c';
const FILE_URL = 'file:///home/someone/JadeBase/.state/open.html';   // what opener.js gives the launcher: no key in the address

test('the gates and the launcher share one browser finder', () => {
  assert.equal(gateFinder, findBrowser);
});

test('finder: JADE_BROWSER, then CHROMIUM, then CHROME_BIN; a path that is given but missing gives nothing', () => {
  assert.equal(findBrowser({ JADE_BROWSER: '/x/b', CHROMIUM: '/x/c' }, has('/x/b', '/x/c'), 'linux'), '/x/b');
  assert.equal(findBrowser({ CHROMIUM: '/x/c', CHROME_BIN: '/x/d' }, has('/x/c', '/x/d'), 'linux'), '/x/c');
  assert.equal(findBrowser({ CHROME_BIN: '/x/d' }, has('/x/d'), 'linux'), '/x/d');
  assert.equal(findBrowser({ JADE_BROWSER: '/nope', CHROMIUM: '/x/c' }, has('/x/c'), 'linux'), '', 'not silently replaced');
});

test('finder, Linux: the usual places, then PATH; Chrome, Chromium, Edge and Brave', () => {
  assert.equal(findBrowser({}, has('/usr/bin/chromium'), 'linux'), '/usr/bin/chromium');
  assert.equal(findBrowser({}, has('/snap/bin/chromium'), 'linux'), '/snap/bin/chromium');
  assert.equal(findBrowser({}, has('/usr/bin/microsoft-edge'), 'linux'), '/usr/bin/microsoft-edge');
  assert.equal(findBrowser({}, has('/usr/bin/brave-browser'), 'linux'), '/usr/bin/brave-browser');
  assert.equal(findBrowser({}, has('/usr/bin/google-chrome-stable', '/usr/bin/chromium'), 'linux'), '/usr/bin/google-chrome-stable', 'Chrome first');
  const onPath = path.posix.join('/opt/b', 'brave');
  assert.equal(findBrowser({ PATH: ['/elsewhere', '/opt/b'].join(path.delimiter) }, has(onPath), 'linux'), onPath);
  assert.equal(findBrowser({ PATH: '/opt/b' }, has(), 'linux'), '');
});

test('finder, macOS: /Applications and ~/Applications bundles', () => {
  const sys = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.equal(findBrowser({ HOME: '/Users/p' }, has(sys), 'darwin'), sys);
  const mine = '/Users/p/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.equal(findBrowser({ HOME: '/Users/p' }, has(mine), 'darwin'), mine);
  const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  assert.equal(findBrowser({ HOME: '/Users/p' }, has(brave), 'darwin'), brave);
  assert.equal(findBrowser({ HOME: '/Users/p' }, has(), 'darwin'), '');
});

test('finder, Windows: Program Files, Program Files (x86), LocalAppData; Edge even with a bare environment', () => {
  const w = path.win32.join;
  const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\p\\AppData\\Local' };
  const chrome = w(env.ProgramFiles, 'Google\\Chrome\\Application\\chrome.exe');
  assert.equal(findBrowser(env, has(chrome), 'win32'), chrome);
  const local = w(env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe');
  assert.equal(findBrowser(env, has(local), 'win32'), local);
  const edge = w(env['ProgramFiles(x86)'], 'Microsoft\\Edge\\Application\\msedge.exe');
  assert.equal(findBrowser(env, has(edge), 'win32'), edge);
  const brave = w(env.ProgramFiles, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe');
  assert.equal(findBrowser(env, has(brave), 'win32'), brave);
  assert.equal(findBrowser({}, has('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'), 'win32'), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  assert.equal(findBrowser(env, has(), 'win32'), '');
});

test('window mode: --tab beats JADE_WINDOW beats the setting; the default is app; nonsense means app', () => {
  assert.equal(windowMode({}), 'app');
  assert.equal(windowMode({ env: {}, config: { window: 'tab' } }), 'tab');
  assert.equal(windowMode({ env: { JADE_WINDOW: 'app' }, config: { window: 'tab' } }), 'app');
  assert.equal(windowMode({ env: { JADE_WINDOW: 'TAB' }, config: { window: 'app' } }), 'tab');
  assert.equal(windowMode({ argv: ['node', 'jade.js', '--tab'], env: { JADE_WINDOW: 'app' }, config: { window: 'app' } }), 'tab');
  assert.equal(windowMode({ env: { JADE_WINDOW: 'floating' }, config: { window: 'wide' } }), 'app');
});

test('app window command, Linux: the browser itself, --app with the file address, a new window, the size and the class', () => {
  const p = openPlan({ url: FILE_URL, mode: 'app', env: {}, exists: has('/usr/bin/chromium'), platform: 'linux' });
  assert.equal(p.kind, 'app');
  assert.equal(p.command, '/usr/bin/chromium');
  assert.deepEqual(p.args, [`--app=${FILE_URL}`, '--new-window', `--window-size=${WINDOW_SIZE}`, `--class=${WINDOW_CLASS}`]);
  assert.equal(WINDOW_CLASS, 'jade-base');
  assert.ok(!p.args.some(a => a.includes('--user-data-dir')), 'the person\'s own profile is used');
});

test('app window command, macOS and Windows: the browser file itself, no class flag, no shell', () => {
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const m = openPlan({ url: FILE_URL, env: { HOME: '/Users/p' }, exists: has(mac), platform: 'darwin' });
  assert.equal(m.command, mac);
  assert.deepEqual(m.args, [`--app=${FILE_URL}`, '--new-window', `--window-size=${WINDOW_SIZE}`]);
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const w = openPlan({ url: FILE_URL, env: {}, exists: has(edge), platform: 'win32' });
  assert.equal(w.command, edge);
  assert.deepEqual(w.args, [`--app=${FILE_URL}`, '--new-window', `--window-size=${WINDOW_SIZE}`]);
});

test('tab mode, and app mode with no browser: the system opener gets the address, and the line says which', () => {
  for (const [platform, command, args] of [['linux', 'xdg-open', [FILE_URL]], ['darwin', 'open', [FILE_URL]], ['win32', 'cmd', ['/c', 'start', '', FILE_URL]]]) {
    const tab = openPlan({ url: FILE_URL, mode: 'tab', env: {}, exists: has('/usr/bin/chromium'), platform });
    assert.deepEqual([tab.kind, tab.command, tab.args], ['tab', command, args]);
    assert.equal(tab.said, 'Jade opened in a browser tab.');
    const none = openPlan({ url: FILE_URL, mode: 'app', env: {}, exists: has(), platform: platform === 'win32' ? 'linux' : platform });
    assert.equal(none.kind, 'tab');
    assert.match(none.said, /No Chrome, Edge, Chromium or Brave was found, so Jade opened in a browser tab/);
  }
  assert.equal(openPlan({ url: FILE_URL, env: {}, exists: has('/usr/bin/chromium'), platform: 'linux' }).said, 'Jade opened in its own window.');
});

test('the key is never in an argument list, for any mode on any system', () => {
  for (const platform of ['linux', 'darwin', 'win32']) for (const mode of ['app', 'tab']) {
    const p = openPlan({ url: FILE_URL, mode, env: { HOME: '/h', JADE_BROWSER: '/b/chrome' }, exists: () => true, platform });
    assert.ok(!p.args.join(' ').includes(KEY) && !p.args.join(' ').includes('key='), `${platform} ${mode}: ${p.args}`);
    assert.ok(p.args.some(a => a.includes('open.html')), 'the local file address is what is passed');
  }
});

// a stand-in child process
const fakeSpawn = (events, calls) => (command, args, options) => { calls.push({ command, args, options }); const c = new EventEmitter(); c.unref = () => {}; setImmediate(() => c.emit(...events(command))); return c; };

test('openWindow: detached, output ignored, windowsHide, one call; reports what was used', async () => {
  const calls = [], plan = openPlan({ url: FILE_URL, env: {}, exists: has('/usr/bin/chromium'), platform: 'linux' });
  const used = await new Promise(res => openWindow(plan, { spawn: fakeSpawn(() => ['spawn'], calls), done: res }));
  assert.equal(used.kind, 'app');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, { detached: true, stdio: 'ignore', windowsHide: true });
  assert.ok(!JSON.stringify(calls).includes(KEY));
});

test('openWindow: a browser that will not run falls back to a tab; nothing runnable says so', async () => {
  const plan = openPlan({ url: FILE_URL, env: {}, exists: has('/usr/bin/chromium'), platform: 'linux' });
  const retry = () => openPlan({ url: FILE_URL, mode: 'tab', platform: 'linux' });
  const calls = [];
  const used = await new Promise(res => openWindow(plan, { spawn: fakeSpawn(cmd => (cmd === 'xdg-open' ? ['spawn'] : ['error', new Error('ENOENT')]), calls), retry, done: res }));
  assert.deepEqual(calls.map(c => c.command), ['/usr/bin/chromium', 'xdg-open']);
  assert.equal(used.kind, 'tab');
  const none = await new Promise(res => openWindow(plan, { spawn: fakeSpawn(() => ['error', new Error('ENOENT')], []), retry, done: res }));
  assert.equal(none, null);
  const thrown = await new Promise(res => openWindow(plan, { spawn: () => { throw new Error('no'); }, done: res }));
  assert.equal(thrown, null);
});

test('with the real start-link file: the address given to the browser has no key, the file it names does', async () => {
  const t = tmpHome('jade-appwin-', { apply: true });
  process.env.JADE_TOKEN = KEY;
  try {
    const { openerUrl } = await import('../server/core/opener.js');
    const url = openerUrl(4999);
    assert.ok(!url.includes(KEY));
    assert.ok(fs.readFileSync(fileURLToPath(url), 'utf8').includes(KEY), 'the key is in the owner-only file only');
    for (const platform of ['linux', 'darwin', 'win32']) {
      const p = openPlan({ url, env: { JADE_BROWSER: '/b/chrome' }, exists: () => true, platform });
      assert.ok(!JSON.stringify(p).includes(KEY), platform);
    }
  } finally { delete process.env.JADE_TOKEN; t.cleanup(); }
});
