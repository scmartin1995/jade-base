// A key split across two streamed pieces, or across the 20,000-character cut of a saved run, is still hidden.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-redstream-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const provider = await import('../server/core/provider.js');
const { redact, redactor } = await import('../server/core/redact.js');
config.load();
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const KEY = 'gw-secret-value-1234567890';
fs.mkdirSync(path.dirname(provider.FILE), { recursive: true });
fs.writeFileSync(provider.FILE, `ANTHROPIC_BASE_URL=https://gw.example.com\nANTHROPIC_AUTH_TOKEN=${KEY}\n`);

const run = pieces => { const r = redactor(); let out = ''; for (const p of pieces) out += r.push(p); return out + r.end(); };

test('a known key split at every position across two pieces never reaches the output', () => {
  const text = `before ${KEY} after`;
  for (let i = 1; i < text.length; i++) {
    const out = run([text.slice(0, i), text.slice(i)]);
    assert.ok(!out.includes(KEY), `split at ${i}`);
    for (let n = 6; n < KEY.length; n++) assert.ok(!out.includes(KEY.slice(0, n)), `split at ${i}: a part of the key (${n}) leaked`);
    assert.equal(out, 'before [hidden] after', `split at ${i}`);
  }
});

test('a key shape split at every position is hidden, and a key spread over many tiny pieces too', () => {
  for (const key of ['sk-ant-api03-abcdefghijklmnop', 'Bearer abcdefgh12345678', 'AKIAIOSFODNN7EXAMPLE', 'api_key = hunter2hunter2']) {
    const text = `x ${key} y`;
    for (let i = 1; i < text.length; i++) {
      const out = run([text.slice(0, i), text.slice(i)]);
      assert.equal(out, redact(text), `${key} split at ${i}`);
    }
    assert.equal(run([...text]), redact(text), `${key} one character at a time`);
  }
});

test('ordinary text is released as it comes (not held until the end), and nothing is lost or doubled', () => {
  const r = redactor();
  let out = r.push('word '.repeat(1000));
  assert.ok(out.length > 4000, 'most of a long piece comes out at once');
  out += r.push(' and more text here, still plain.\nnext line') + r.end();
  assert.equal(out, 'word '.repeat(1000) + ' and more text here, still plain.\nnext line');
});

test('the same pieces always give the same text as redacting the whole at once', () => {
  const text = `one ${KEY} two sk-abcdefghijkl three ${KEY}${KEY} four`;
  for (const size of [1, 2, 3, 7, 13, 50]) {
    const pieces = []; for (let i = 0; i < text.length; i += size) pieces.push(text.slice(i, i + size));
    assert.equal(run(pieces), redact(text), `pieces of ${size}`);
  }
});

test('the saved run is hidden before it is cut to 20,000 characters, so a key at the cut is not half kept', async () => {
  const jobs = await import('../server/core/jobs.js');
  for (const back of [0, 5, 13, 25]) {
    const tail = 'z'.repeat(back);
    const kept = jobs.savedText({ id: 'j1', status: 'done', endedAt: 'x', output: 'p'.repeat(20000 - back - 10) + KEY + tail, tools: [] });
    assert.ok(!kept.includes(KEY.slice(0, 8)), `no part of the key (end ${back})`);
  }
  const edge = 'p'.repeat(19995) + KEY;   // the cut would land inside the key
  const kept2 = jobs.savedText({ id: 'j2', status: 'done', endedAt: 'x', output: 'abcdefghijklmnopqrst' + edge, tools: [] });
  assert.ok(!kept2.includes(KEY.slice(0, 8)), 'a key that the 20,000 cut would split');
});
