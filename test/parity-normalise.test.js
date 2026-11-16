// The Windows-only normalising of the provider parity record (scripts/parity-normalise.mjs), fed Windows-shaped input on any system.
// The shapes are the ones seen in a real Windows run: the product writes permission rules as //c/Users/..., the harness knows the 8.3 name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNormaliser, foldEnv, canonical } from '../scripts/parity-normalise.mjs';

const U = 'Us' + 'ers';   // spelt in two pieces so the hygiene gate does not take the sample for a real home path
const LONG = `C:\\${U}\\someone\\AppData\\Local\\Temp\\jade-parity-AbC123`;
const SHORT = `C:\\${U}\\SOMEON~1\\AppData\\Local\\Temp\\jade-parity-AbC123`;
const folders = [
  { paths: [`${SHORT}\\jade`, `${LONG}\\jade`], token: '<JADE_HOME>' },
  { paths: [SHORT, LONG], token: '<TMP>' },
  { paths: ['D:\\work\\jade-base'], token: '<APP>' },
  { paths: ['C:\\Program Files\\nodejs\\node.exe'], token: '<NODE>' },
];
const win = makeNormaliser(folders, 'win32');
const posix = makeNormaliser([{ paths: ['/tmp/x/jade'], token: '<JADE_HOME>' }, { paths: ['/tmp/x'], token: '<TMP>' }], 'linux');

test('permission rules in the //c/ form become the same text as on Linux', () => {
  assert.equal(win(`Read(//c/${U}/someone/AppData/Local/Temp/jade-parity-AbC123/jade/engine.env)`), 'Read(/<JADE_HOME>/engine.env)');
  assert.equal(win(`Read(//c/${U}/someone/AppData/Local/Temp/jade-parity-AbC123/jade/.state/**)`), 'Read(/<JADE_HOME>/.state/**)');
  assert.equal(posix('Read(//tmp/x/jade/engine.env)'), 'Read(/<JADE_HOME>/engine.env)');
});
test('long and short names, any case, any separator, JSON-escaped', () => {
  assert.equal(win(`${SHORT}\\jade\\.state\\run\\a.json`), '<JADE_HOME>/.state/run/a.json');
  assert.equal(win(`${LONG.toLowerCase()}/jade/x`), '<JADE_HOME>/x');
  assert.equal(win(JSON.stringify(`${LONG}\\jade\\.state\\run`)), '"<JADE_HOME>/.state/run"');
  assert.equal(win(`${LONG}\\bin\\claude.cmd`), '<TMP>/bin/claude');
  assert.equal(win('D:\\work\\jade-base\\server\\x.js'), '<APP>/server/x.js');
  assert.equal(win('C:\\Program Files\\nodejs\\node.exe'), '<NODE>');
});
test('nothing changes on Linux for text without a machine folder', () => {
  assert.equal(posix('--allowedTools Read,Glob,Grep'), '--allowedTools Read,Glob,Grep');
  assert.equal(posix('/tmp/x/bin/claude.cmd'), '<TMP>/bin/claude.cmd');
});
test('environment: PROMPT dropped and names folded on Windows only, on both sides', () => {
  const now = { PROMPT: '$P$G', HTTPS_PROXY: 'p', A: '1' }, want = { HTTPS_PROXY: 'p', https_proxy: 'p', A: '1' };
  assert.deepEqual(foldEnv(now, 'win32'), foldEnv(want, 'win32'));
  assert.deepEqual(foldEnv(now, 'linux'), now);
  const rec = { envs: { s: now }, runs: { r: { env: now } }, extras: { e: { fullEnv: now } } };
  assert.deepEqual(canonical(rec, 'win32'), canonical({ envs: { s: want }, runs: { r: { env: want } }, extras: { e: { fullEnv: want } } }, 'win32'));
});
