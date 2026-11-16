// A save that meets a file another program holds (Windows: EPERM, EBUSY or EACCES on the rename) is tried again and not lost.
// The failure is injected through util.io.rename, so this runs the same on every system.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { removeDir } from './helpers/rm.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-saveretry-'));
const util = await import('../server/core/util.js');
after(() => removeDir(tmp));
const real = util.io.rename;
const locked = code => Object.assign(new Error(code + ': resource busy or locked'), { code });
const leftovers = () => fs.readdirSync(tmp).filter(f => f.endsWith('.tmp'));

test('a rename that fails twice with EPERM and then works still writes the file, and no temporary file is left', () => {
  const file = path.join(tmp, 'a.json'); fs.writeFileSync(file, 'old');
  let calls = 0;
  util.io.rename = (a, b) => { if (++calls <= 2) throw locked('EPERM'); return real(a, b); };
  try { util.writeText(file, 'new'); } finally { util.io.rename = real; }
  assert.equal(calls, 3);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.deepEqual(leftovers(), []);
});

test('a rename that always fails throws after a bounded number of tries, keeps the old file and leaves no temporary file', () => {
  const file = path.join(tmp, 'b.json'); fs.writeFileSync(file, 'old');
  let calls = 0;
  util.io.rename = () => { calls++; throw locked('EBUSY'); };
  try { assert.throws(() => util.writeText(file, 'new'), { code: 'EBUSY' }); } finally { util.io.rename = real; }
  assert.equal(calls, 10);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.deepEqual(leftovers(), []);
});

test('an error that is not a lock is not retried', () => {
  const file = path.join(tmp, 'c.json');
  let calls = 0;
  util.io.rename = () => { calls++; throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); };
  try { assert.throws(() => util.writeText(file, 'x'), { code: 'ENOSPC' }); } finally { util.io.rename = real; }
  assert.equal(calls, 1);
});

test('a save of the recent runs whose first write fails is saved by the retry', async () => {
  process.env.JADE_HOME = path.join(tmp, 'home'); process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
  const config = await import('../server/core/config.js');
  const jobs = await import('../server/core/jobs.js');
  config.load(); jobs.init();
  const lines = []; const err = console.error; console.error = (...a) => lines.push(a.join(' '));
  let fails = 0;
  util.io.rename = (a, b) => { if (String(b).endsWith('jobs.json') && fails < 10) { fails++; throw locked('EPERM'); } return real(a, b); };
  try {
    const j = jobs.enqueue({ agent: 'note-actions', input: { text: 'Dana will send the budget on Friday.' }, title: 'Retry' });
    const file = path.join(config.STATE, 'jobs.json');
    const has = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).some(x => x.id === j.id); } catch { return false; } };
    for (let i = 0; i < 100 && !has(); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(has(), 'the run is in jobs.json');
    assert.ok(fails >= 10, 'the first write really failed');
    assert.ok(lines.some(l => /could not save the recent runs/.test(l)), 'one plain line was logged');
  } finally { util.io.rename = real; console.error = err; }
});
