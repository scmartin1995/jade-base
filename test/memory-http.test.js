// /api/memory/files is paged, and a server with many files to read answers its first request without waiting for the index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpHome, put } from './helpers/env.js';
import { startServer, waitFor } from './helpers/server.js';

test('start-up does not wait for the index; the file list is paged with a total and "more"', async () => {
  const t = tmpHome('jade-memhttp-');
  const dir = path.join(t.root, 'docs');
  for (let i = 0; i < 1200; i++) put(path.join(dir, `d${i % 20}`, `n${i}.md`), `# Note ${i}\n\n${'budget review quokka. '.repeat(30)}\n`);
  fs.writeFileSync(path.join(t.home, 'config.json'), JSON.stringify({ memory: { folders: [dir] } }));
  const s = await startServer({ home: t.home, claudeHome: t.claudeHome, bin: t.bin, token: process.env.JADE_TOKEN });
  try {
    const t0 = Date.now();
    assert.equal((await s.get('/api/engines')).status, 200);
    const first = Date.now() - t0;
    await waitFor(async () => { const r = await s.get('/api/memory/stats'); return r.body.building === false && r.body.files >= 1200; }, { timeout: 30000, message: 'the index to finish' });
    const built = Date.now() - t0;
    assert.ok(first < built / 2, `the first answer (${first} ms) did not wait for the index to be built (${built} ms)`);   // a ratio on this machine, not a fixed number
    const p1 = (await s.get('/api/memory/files?limit=500')).body;
    assert.equal(p1.files.length, 500); assert.equal(p1.total, 1200); assert.equal(p1.more, true); assert.equal(p1.indexing, false);
    const p3 = (await s.get('/api/memory/files?limit=500&offset=1000')).body;
    assert.equal(p3.files.length, 200); assert.equal(p3.more, false);
    const seen = new Set([...p1.files, ...(await s.get('/api/memory/files?limit=500&offset=500')).body.files, ...p3.files].map(f => f.file));
    assert.equal(seen.size, 1200, 'pages do not overlap or skip');
    const plain = (await s.get('/api/memory/files')).body;
    assert.ok(Array.isArray(plain) && plain.length === 1200, 'no limit: the plain list, as before (capped at 2000)');
  } finally { await s.stop(); t.cleanup(); }
});
