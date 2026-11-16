// The gates are checks too, so they get checked: the imports gate fails when a view file is missing, the browser finder works on
// each platform's paths, the pages gate skips with a clear message without a browser, and no gate can reach a real `claude`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, safePath, gateSandbox, startServer, waitFor } from '../scripts/gates/lib.mjs';
import { put } from './helpers/env.js';
import { removeDir } from './helpers/rm.js';

const gate = (name, env = {}) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/gates', name)], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });

/** A copy of the parts of the tree the imports gate reads. */
function copyTree() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-gate-tree-'));
  for (const d of ['server', 'public/js', 'bridge', 'agents']) fs.cpSync(path.join(ROOT, d), path.join(dest, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dest, 'package.json'));
  return dest;
}

test('imports gate: passes on the real tree and says how many views it checked', () => {
  const r = gate('imports.mjs');
  assert.equal(r.status, 0, r.stdout);
  const d = JSON.parse(r.stdout).details;
  assert.ok(d.viewsChecked >= 15, 'the views come from the module manifests, not from a list that went stale');
  assert.deepEqual(d.missingViews, []);
});

test('imports gate: fails when a view a route needs is missing, and names it', () => {
  const tree = copyTree();
  try {
    fs.rmSync(path.join(tree, 'public/js/views/meeting.js'));   // the Meetings module routes #/meeting to it
    fs.rmSync(path.join(tree, 'public/js/views/home.js'));      // and Home's nav route is home
    const r = gate('imports.mjs', { JADE_GATE_ROOT: tree });
    assert.equal(r.status, 1, r.stdout);
    const d = JSON.parse(r.stdout).details;
    assert.ok(d.missingViews.some(v => /^meeting\.js \(meetings/.test(v)), JSON.stringify(d.missingViews));
    assert.ok(d.missingViews.some(v => /^home\.js \(home/.test(v)), JSON.stringify(d.missingViews));
  } finally { removeDir(tree); }
});

test('imports gate: fails when a project panel names a file that is not there, and when an import is broken', () => {
  const tree = copyTree();
  try {
    fs.rmSync(path.join(tree, 'public/js/views/meetings-panel.js'));
    put(path.join(tree, 'public/js/views/home.js'), ['imp' + 'ort x fr' + 'om', "'./not-here.js';\nexport default {};\n"].join(' '));   // (written in pieces: the gate also reads this file's text)
    const r = gate('imports.mjs', { JADE_GATE_ROOT: tree });
    assert.equal(r.status, 1);
    const d = JSON.parse(r.stdout).details;
    assert.ok(d.missingViews.some(v => /meetings-panel\.js \(meetings: project panel/.test(v)), JSON.stringify(d.missingViews));
    assert.ok(d.missingImports.some(v => /home\.js -> \.\/not-here\.js/.test(v)), JSON.stringify(d.missingImports));
  } finally { removeDir(tree); }
});

test('pages gate: with no browser it says so plainly and is skipped, not failed', () => {
  const r = gate('pages.mjs', { CHROMIUM: path.join(os.tmpdir(), 'no-such-browser'), CHROME_BIN: '' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.skipped, true);
  assert.match(j.details.reason, /SKIPPED: no Chromium, Chrome or Edge was found/);
});

test('no gate can start a real `claude`: PATH loses every folder that holds one, and the stand-in comes first', async () => {
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-realclaude-'));
  const sb = gateSandbox('jade-gate-path');
  try {
    put(path.join(realDir, process.platform === 'win32' ? 'claude.cmd' : 'claude'), 'REAL');
    const cut = safePath(sb.bin, [realDir, '/usr/bin'].join(path.delimiter)).split(path.delimiter);
    assert.equal(cut[0], sb.bin);
    assert.ok(!cut.includes(realDir), 'the folder with a (pretend) real claude is gone');
    // and a server started through the gate helper runs the stand-in: a chat answers with its text
    const srv = await startServer({ home: sb.home, claudeHome: sb.claudeHome, bin: sb.bin, env: { PATH: safePath(sb.bin, realDir) } });
    try {
      const sent = (await fetch(srv.base + '/api/chat', { method: 'POST', headers: { 'x-jade': srv.token, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'ping', thread: 'new' }) }).then(r => r.json()));
      const j = await waitFor(async () => { const x = await (await fetch(srv.base + '/api/jobs/' + sent.id, { headers: { 'x-jade': srv.token } })).json(); return x.status === 'done' ? x : null; }, { timeout: 15000, message: 'the reply' });
      assert.match(JSON.stringify(j), /echo: ping/);
    } finally { await srv.stop(); }
  } finally { removeDir(realDir); sb.cleanup(); }
});
