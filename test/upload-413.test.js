// An upload over the size cap must come back as a plain 413 the page can show, not as a dropped connection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpHome, put } from './helpers/env.js';
import { startServer } from './helpers/server.js';

test('a transcript over the cap is answered with the 413 message, for a declared size and a streamed one', async () => {
  const t = tmpHome('jade-413-');
  put(path.join(t.home, 'config.json'), JSON.stringify({ meetings: { maxBytes: 1000 } }));
  const srv = await startServer({ home: t.home, claudeHome: t.claudeHome, bin: t.bin, token: process.env.JADE_TOKEN });
  try {
    const base = srv.base;
    const h = { 'x-jade': process.env.JADE_TOKEN, 'content-type': 'text/plain' };
    const url = base + '/api/meetings/upload?project=p1&name=big.txt';
    const big = Buffer.alloc(3 * 1024 * 1024, 'x');
    const r = await fetch(url, { method: 'POST', headers: h, body: big });
    assert.equal(r.status, 413);
    assert.match((await r.json()).error, /bigger than the .* limit/);
    // no length declared up front (chunked): the same answer
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < 30; i++) c.enqueue(new Uint8Array(100 * 1024)); c.close(); } });
    const r2 = await fetch(url, { method: 'POST', headers: h, body: stream, duplex: 'half' });
    assert.equal(r2.status, 413);
    // and the server is still fine
    assert.equal((await fetch(base + '/api/projects', { headers: { 'x-jade': process.env.JADE_TOKEN } })).status, 200);
  } finally { await srv.stop(); t.cleanup(); }
});
