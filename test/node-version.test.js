// The Node version Jade asks for: one minimum (package.json "engines"), the same one CI tests as its lowest, and a plain warning
// at start when the running Node is older. An older Node still starts Jade (no hard stop above the floor it cannot run on).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { minNode, nodeWarning } from '../server/core/nodeversion.js';
import { tmpHome } from './helpers/env.js';
import { startServer } from './helpers/server.js';
import { installFakeClaude } from './helpers/fake-claude.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the minimum comes from package.json and is a supported release line', () => {
  const engines = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.node;
  assert.equal(engines, `>=${minNode()}`);
  assert.ok(minNode() >= 22, 'Node 20 reached end of life on 30 April 2026');
});

test('CI tests the minimum and nothing older', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');
  const list = /node:\s*\[([^\]]+)\]/.exec(yml)[1].split(',').map(s => Number(s.trim()));
  assert.equal(Math.min(...list), minNode());
});

test('an older Node gets a plain warning that names both versions; a supported one gets none', () => {
  const w = nodeWarning('v20.18.0');
  assert.match(w, /v20\.18\.0/);
  assert.match(w, new RegExp(`Node ${minNode()}`));
  assert.match(w, /security/);
  assert.equal(nodeWarning(`v${minNode()}.0.0`), '');
  assert.equal(nodeWarning('v99.1.0'), '');
});

test('the launcher prints the warning and still starts on an older Node', () => {
  // the launcher reads the version it runs on; with --version-check (which only checks and exits) JADE_NODE_VERSION stands in for an older one
  const r = spawnSync(process.execPath, [path.join(ROOT, 'jade.js'), '--version-check'], { encoding: 'utf8', env: { ...process.env, JADE_NODE_VERSION: 'v20.18.0' }, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /v20\.18\.0/);
  const ok = spawnSync(process.execPath, [path.join(ROOT, 'jade.js'), '--version-check'], { encoding: 'utf8', env: { ...process.env, JADE_NODE_VERSION: `v${minNode()}.1.0` }, timeout: 20000 });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stderr.trim(), '');
});

test('a value that is not a version is not taken for an old Node, and the stand-in is ignored without --version-check', () => {
  assert.equal(nodeWarning('garbage'), '');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'jade.js'), '--version-check'], { encoding: 'utf8', env: { ...process.env, JADE_NODE_VERSION: '' }, timeout: 20000 });
  assert.equal(r.stderr.trim(), nodeWarning(process.version));
});

test('the page is told the Node version and any warning (Settings and the top bar show it)', async () => {
  const t = tmpHome('jade-nodever-');
  installFakeClaude(t.bin, { putOnPath: false });   // never a real `claude`
  const srv = await startServer({ home: t.home, claudeHome: t.claudeHome, bin: t.bin });
  try {
    const node = (await srv.get('/api/boot')).body.node;
    assert.equal(node.version, process.version);
    assert.equal(node.warning, nodeWarning(process.version));
    assert.equal(node.min, minNode());
  } finally { await srv.stop(); t.cleanup(); }
});
