// A plain read or a same-contents rewrite of engine.env (a Windows read can touch the file) must not stop a chat that is being
// answered; a real change to it must. Behaviour through the running server and a stand-in `claude`, not a read of the source.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpHome, put } from './helpers/env.js';
import { installFakeClaude } from './helpers/fake-claude.js';
import { startServer, waitFor } from './helpers/server.js';

const t = tmpHome('jade-envwatch-');
const fake = installFakeClaude(t.bin, { putOnPath: false });
const ENV = path.join(t.home, 'engine.env');
let srv;
before(async () => { put(ENV, 'ANTHROPIC_AUTH_TOKEN=one\n'); srv = await startServer({ home: t.home, claudeHome: t.claudeHome, bin: t.bin }); });
after(async () => { await srv?.stop(); t.cleanup(); });
const status = id => srv.get('/api/jobs/' + id).then(r => r.body.status);

test('rewriting engine.env with the same contents leaves a running reply alone; changing it stops the reply', async () => {
  const sent = (await srv.post('/api/chat', { message: 'please HANG here', thread: 'new' })).body;
  await waitFor(() => fake.calls().some(c => /HANG here/.test(c.stdin)), { message: 'the engine to receive the message' });
  fs.writeFileSync(ENV, 'ANTHROPIC_AUTH_TOKEN=one\n');   // same contents: what a read looks like to a file watcher
  // give the watcher's settle time (400 ms) plus a margin to act, if it were going to
  await new Promise(r => setTimeout(r, 1200));
  assert.equal(await status(sent.id), 'running', 'a same-contents write did not stop the reply');
  fs.writeFileSync(ENV, 'ANTHROPIC_AUTH_TOKEN=two\n');   // a real change
  await waitFor(async () => (await status(sent.id)) !== 'running', { message: 'the reply to stop after a real change', timeout: 8000 });
});
