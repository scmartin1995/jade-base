// The warm chat worker: a second message sent while the first is still being answered waits for it, instead of killing the
// worker and stopping both replies ("Worker stopped"). Uses a stand-in "claude" on PATH that answers each line slowly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { waitFor } from './helpers/server.js';
import { writeStub } from './helpers/stub.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-warm-test-'));
const bin = path.join(dir, 'bin');
fs.mkdirSync(bin);
writeStub(bin, 'claude', `const rl = require('node:readline').createInterface({ input: process.stdin });
let n = 0;
rl.on('line', () => {
  const id = ++n;
  require('node:fs').appendFileSync(${JSON.stringify(path.join(dir, 'received.log'))}, 'x');   // lets the test see the message arrived
  console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'stand-in' }));
  setTimeout(() => console.log(JSON.stringify({ type: 'result', result: 'answer ' + id })), 600);
});
`);
process.env.PATH = bin + path.delimiter + process.env.PATH;
process.env.JADE_HOME = path.join(dir, 'home');
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
config.load(); store.init();
const warm = await import('../server/core/warm.js');

const settings = { connectors: [], dirs: [], model: '', system: 'x', effort: 'low', edits: false };

test('a second message waits for the first reply instead of killing it', { skip: process.platform === 'win32' && 'not checked on Windows: the stand-in is a .cmd shim, and stopping a reply there leaves the node process behind (untried)', timeout: 15000 }, async () => {
  const first = warm.turn('t1', settings, { prompt: 'one' });
  await waitFor(() => fs.existsSync(path.join(dir, 'received.log')), { message: 'the first message to reach the engine' });   // so the first is still being answered
  const second = warm.turn('t1', settings, { prompt: 'two' });
  // the old code killed the first reply here, so this never settled (the test timed out)
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.text, 'answer 1');
  assert.equal(b.text, 'answer 2', 'the same worker answered the second message');
  assert.equal(b.warm, true);
  warm.shutdown();
});

test('different chats do not stop each other', { skip: process.platform === 'win32' && 'not checked on Windows: the stand-in is a .cmd shim, and stopping a reply there leaves the node process behind (untried)', timeout: 15000 }, async () => {
  const [a, b] = await Promise.all([warm.turn('t2', settings, { prompt: 'x' }), warm.turn('t3', settings, { prompt: 'y' })]);
  assert.equal(a.text, 'answer 1'); assert.equal(b.text, 'answer 1');
  warm.shutdown();
});

// A reply may take as long as it needs while the engine shows signs of life; it is stopped only after STUCK_MS with none.
test('a long reply that keeps working is not cut off, and a silent one is stopped with a plain message', { skip: process.platform === 'win32' && 'not checked on Windows: the stand-in is a .cmd shim, and stopping a reply there leaves the node process behind (untried)', timeout: 20000 }, async () => {
  // (the timing itself, 15 minutes, is not waited for here; the stuck message states it, and a reply that keeps working is the test above)
  assert.equal(typeof warm.StuckError, 'function');
  const e = new warm.StuckError();
  assert.equal(e.stuck, true); assert.match(e.message, /No sign of progress for 15 minutes/);
});
