// The memory index (server/core/memory.js) and the secret check (files.isSecret): the fast paths must answer exactly what the slow ones did.
// In-process, on throw-away folders. A stand-in `pdftotext` counts how often a PDF is read.
import { idleLag, best } from './helpers/timing.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpHome, put } from './helpers/env.js';
import { waitFor } from './helpers/server.js';

const t = tmpHome('jade-memidx-', { apply: true });
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const memory = await import('../server/core/memory.js');
const files = await import('../server/core/files.js');
const { resolveHome, within } = await import('../server/core/locations.js');
config.load(); store.init();
const dir = path.join(t.root, 'docs');
fs.mkdirSync(dir, { recursive: true });
config.save({ memory: { folders: [dir] } });
const names = r => r.map(x => path.relative(dir, x.file)).sort();
const note = (n, text) => put(path.join(dir, n), text);
const sameTime = (f, ms) => fs.utimesSync(f, ms / 1000, ms / 1000);

test('a second request for a build joins the one in progress', async () => {
  for (let i = 0; i < 300; i++) note(`a${i}.md`, `# Alpha ${i}\n\nzanzibar ${i}\n`);
  memory.reset();
  const first = memory.rebuild(), second = memory.rebuild();
  assert.equal(first, second, 'the same pass');
  assert.equal(memory.indexing(), true);
  await first;
  assert.equal(memory.indexing(), false);
  assert.equal(memory.stats().files, 300);
});

test('a build never holds the server for long and answers search while it runs', async () => {
  for (let i = 0; i < 1500; i++) note(`b/${i % 30}/n${i}.md`, `# Beta ${i}\n\n${'quokka procurement budget words here. '.repeat(40)}\n`);
  memory.reset();
  const lag = await idleLag();
  let worst = 0, last = Date.now(), stop = false, searchedMidway = false;
  const timer = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last); last = n; if (memory.indexing() && memory.stats().files > 0) searchedMidway ||= memory.search('quokka').length > 0; if (stop) clearInterval(timer); }, 5);
  await memory.rebuild(); stop = true;
  assert.ok(worst < 100 + 3 * lag, `the loop was held for ${worst} ms (this machine's idle lag: ${lag} ms)`);
  assert.ok(searchedMidway, 'search answered from the part already read');
  assert.ok(memory.stats().files >= 1800);
});

test('remembered files are not read again; a changed one is; add, change, rename, delete give what a fresh index gives', async () => {
  memory.reset();
  fs.rmSync(path.join(dir, 'b'), { recursive: true });
  for (let i = 0; i < 300; i++) fs.rmSync(path.join(dir, `a${i}.md`));
  const a = note('keep.md', '# Keep\n\nolive grove text\n'), b = note('edit.md', '# Edit\n\nfirst version walrus\n'), c = note('gone.md', '# Gone\n\nvanishing ibex\n'), d = note('old-name.md', '# Moved\n\nrenamed heron\n');
  await memory.rebuild();
  assert.equal(memory.search('walrus').length, 1);
  // same size and modified time: nothing re-read, the old words are still what the index holds
  const ms = fs.statSync(a).mtimeMs; fs.writeFileSync(a, '# Keep\n\nolive grove TEXT\n'.replace('TEXT', 'text'.toUpperCase()).slice(0, '# Keep\n\nolive grove text\n'.length)); sameTime(a, ms);
  await memory.rebuild();
  assert.equal(memory.search('olive grove').length, 1, 'unchanged by size and time: not read again');
  assert.match(memory.search('olive grove')[0].snippet, /grove text/, 'still the old words');
  fs.writeFileSync(a, '# Keep\n\nolive grove text\n'); sameTime(a, ms);   // put it back, so a fresh index below reads the same words
  // now change, add, rename, delete
  fs.writeFileSync(b, '# Edit\n\nsecond version narwhal, longer than before\n');
  note('added.md', '# Added\n\nfresh kestrel\n');
  fs.renameSync(d, path.join(dir, 'new-name.md'));
  fs.rmSync(c);
  await memory.rebuild();
  const probe = ['walrus', 'narwhal', 'kestrel', 'ibex', 'heron', 'olive grove', 'version'];
  const incremental = probe.map(q => memory.search(q, 8));
  const rows = memory.listFiles();
  const incrementalStats = memory.stats();
  memory.reset(); await memory.rebuild();
  assert.deepEqual(probe.map(q => memory.search(q, 8)), incremental, 'search answers are the same as a fresh index');
  assert.deepEqual(memory.listFiles(), rows, 'the file list is the same');
  const fresh = memory.stats(); assert.equal(fresh.files, incrementalStats.files); assert.equal(fresh.chunks, incrementalStats.chunks);
  assert.equal(memory.search('walrus').length, 0); assert.equal(memory.search('ibex').length, 0); assert.equal(memory.search('heron').length, 1);
});

test('saving a note updates that note only (the watcher), and an unchanged file is not re-read', async () => {
  memory.reset(); await memory.rebuild(); memory.watch();
  try {
    const quiet = path.join(dir, 'keep.md'), ms = fs.statSync(quiet).mtimeMs;
    fs.writeFileSync(quiet, '# Keep\n\nolive grove REPLACED text\n'.slice(0, fs.statSync(quiet).size).padEnd(fs.statSync(quiet).size, ' ')); sameTime(quiet, ms);   // a silent change the index must not notice
    const v = memory.indexVersion();
    note('saved-later.md', '# Saved later\n\nplatypus saved note\n');
    await waitFor(() => memory.search('platypus').length === 1, { message: 'the saved note to be searchable' });
    assert.equal(memory.search('olive grove').length, 1, 'the other note was not read again');
    assert.ok(memory.indexVersion() - v <= 2, 'only that note changed the index');
    assert.equal(memory.indexing(), false, 'no pass over everything');
    fs.rmSync(path.join(dir, 'saved-later.md'));
    await waitFor(() => memory.search('platypus').length === 0, { message: 'the deleted note to leave the index' });
  } finally { memory.unwatch(); }
});

test('a text-less PDF is read once, not on every pass', { skip: process.platform === 'win32' }, async () => {
  const bin = path.join(t.root, 'pdfbin'), log = path.join(t.root, 'pdftotext.log');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'pdftotext'), `#!/bin/sh\necho x >> "${log}"\nexit 0\n`, { mode: 0o755 });   // answers with no text, as for a scan
  const before = process.env.PATH; process.env.PATH = bin + path.delimiter + before;
  config.save({ memory: { extensions: ['.md', '.pdf'] } });
  try {
    const scan = put(path.join(dir, 'scan.pdf'), '%PDF-1.4 not really');
    memory.reset();
    await memory.rebuild(); await memory.rebuild(); await memory.rebuild();
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1, 'one read for three passes');
    fs.writeFileSync(scan, '%PDF-1.4 changed and longer');
    await memory.rebuild();
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 2, 'read again once it changed');
  } finally { process.env.PATH = before; }
});

// ---- isSecret: the quick check against the original one, on a large generated list
function oldIsSecret(p) {   // the implementation before this change, kept here as the reference
  const same = (a, b) => a.ino && a.ino === b.ino && a.dev === b.dev;
  const r = resolveHome(p);
  let rp = r; try { rp = fs.realpathSync(r); } catch { /* not there */ }
  let st = null; try { st = fs.statSync(r); } catch { /* not there */ }
  const secrets = [path.join(config.JADE_HOME, '.state'), path.join(config.JADE_HOME, 'engine.env')];
  for (const s of secrets) {
    let rs = s; try { rs = fs.realpathSync(s); } catch { /* not there */ }
    if (within(s, r) || within(rs, rp) || within(rs, r) || within(s, rp)) return true;
  }
  if (st?.isFile()) for (const s of [path.join(secrets[0], 'token'), secrets[1]]) { try { if (same(fs.statSync(s), st)) return true; } catch { /* none */ } }
  return false;
}

test('isSecret answers exactly as before on a large generated list (names, symlinks, hard links, odd case, relative paths)', () => {
  const H = config.JADE_HOME, S = path.join(H, '.state'), other = path.join(t.root, 'elsewhere');
  fs.mkdirSync(path.join(S, 'private'), { recursive: true }); fs.mkdirSync(other, { recursive: true });
  put(path.join(S, 'token'), 'k'); put(path.join(S, 'private', 'x.json'), '{}'); put(path.join(H, 'engine.env'), 'KEY=1'); put(path.join(H, 'notes', 'n.md'), 'n');
  fs.symlinkSync(S, path.join(other, 'to-state')); fs.symlinkSync(path.join(S, 'token'), path.join(other, 'to-token'));
  fs.symlinkSync(path.join(H, 'engine.env'), path.join(other, 'to-env')); fs.symlinkSync(path.join(other, 'to-state'), path.join(other, 'chain'));
  fs.symlinkSync(path.join(H, 'notes'), path.join(other, 'to-notes'));
  fs.linkSync(path.join(S, 'token'), path.join(other, 'hard-token')); fs.linkSync(path.join(H, 'engine.env'), path.join(other, 'hard-env'));
  put(path.join(other, 'plain.md')); put(path.join(other, 'second-link-target.md'));
  fs.linkSync(path.join(other, 'plain.md'), path.join(other, 'plain-hard.md'));   // a hard link that is not a secret
  const bases = [H, S, path.join(S, 'private'), other, path.join(H, 'notes'), path.join(other, 'to-state'), path.join(other, 'chain'), path.join(other, 'to-notes'), t.root, '~', '~/nothing', '.', '..'];
  const leaves = ['', 'token', 'x.json', 'private', 'private/x.json', 'engine.env', 'engine.env.bak', '.state2', 'to-token', 'to-env', 'hard-token', 'hard-env', 'plain.md', 'plain-hard.md', 'n.md',
    'missing.md', 'private/../token', '../.state/token', '.STATE', '.State/token', 'ENGINE.ENV', 'Token', 'to-state/token', 'chain/private/x.json', 'to-notes/n.md', 'a/b/c.md', 'engine.env/', '.state/', '.state/../notes'];
  const list = new Set();
  for (const b of bases) for (const l of leaves) { list.add(l ? path.join(b, l) : b); list.add((l ? path.join(b, l) : b) + path.sep); list.add(path.join(b, l).toUpperCase()); list.add(path.join(b, l).toLowerCase()); }
  const all = [...list];
  assert.ok(all.length > 1000, `only ${all.length} paths`);
  const ctx = files.secretContext();
  let yes = 0;
  for (const p of all) {
    const was = oldIsSecret(p);
    assert.equal(files.isSecret(p), was, 'one by one: ' + p);
    assert.equal(files.isSecret(p, ctx), was, 'with a shared context: ' + p);
    if (was) yes++;
  }
  assert.ok(yes > 100 && yes < all.length - 100, `the list has both answers (${yes} secret of ${all.length})`);
  // never less strict: every path that reaches a secret by any of these ways is caught
  for (const p of [path.join(other, 'to-state', 'token'), path.join(other, 'hard-token'), path.join(other, 'to-env'), path.join(other, 'chain', 'private', 'x.json')]) assert.equal(files.isSecret(p), true, p);
  assert.equal(files.isSecret(path.join(other, 'plain-hard.md')), false);
});

test('isSecret is much faster than before on a long list', () => {
  const H = config.JADE_HOME, many = path.join(H, 'notes', 'deep', 'er', 'still');
  for (let i = 0; i < 1500; i++) put(path.join(many, `f${i}.md`), 'x');
  const ps = fs.readdirSync(many).map(f => path.join(many, f));
  const ctx = files.secretContext();
  // best of several runs of each, measured here and now: a busy machine slows both, so only the ratio counts
  const slow = best(5, () => { for (const p of ps) oldIsSecret(p); });
  const fast = best(5, () => { for (const p of ps) files.isSecret(p, ctx); });
  assert.ok(fast < slow / 2, `fast ${fast.toFixed(1)} ms, before ${slow.toFixed(1)} ms`);
});
