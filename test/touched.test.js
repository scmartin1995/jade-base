// What Jade did to files in a reply: which files were created or edited (with the earlier version to put back), changes made by a
// command, and the clean-up of pictures pasted into a chat once their content has been written into a file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-touched-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const perm = await import('../server/core/permissions.js');
const recent = await import('../server/core/recent.js');
const tidy = await import('../server/core/tidy.js');
config.load(); store.init();
const HOME = config.JADE_HOME;
config.save({ memory: { folders: [HOME] }, permissions: { mode: 'irreversible' } });
fs.mkdirSync(path.join(HOME, 'deliverables'), { recursive: true });

test('a created file and an edited file are listed once each, and the edit can be put back', async () => {
  const f = path.join(HOME, 'deliverables', 'plan.md');
  await perm.decide({ job: 'c1', tool: 'Write', input: { file_path: f } });
  fs.writeFileSync(f, 'version one');
  await perm.decide({ job: 'c1', tool: 'Edit', input: { file_path: f } });
  fs.writeFileSync(f, 'version two');
  await perm.decide({ job: 'c1', tool: 'Edit', input: { file_path: f } });
  fs.writeFileSync(f, 'version three');
  const t = perm.touches(['c1']);
  assert.equal(t.length, 1, 'one file, listed once');
  assert.equal(t[0].path, f);
  assert.equal(t[0].isNew, true, 'it was created in this run');
  const g = path.join(HOME, 'deliverables', 'old.md');
  fs.writeFileSync(g, 'before');
  await perm.decide({ job: 'c2', tool: 'Edit', input: { file_path: g } });
  fs.writeFileSync(g, 'after');
  const u = perm.touches(['c2']);
  assert.equal(u[0].isNew, false);
  assert.ok(u[0].change, 'an edit of an existing file points at the kept version');
  perm.restore(u[0].change);
  assert.equal(fs.readFileSync(g, 'utf8'), 'before', 'Undo puts the earlier version back');
});

test('the same file edited twice in a run points at the version from before the first edit', async () => {
  const f = path.join(HOME, 'deliverables', 'twice.md');
  fs.writeFileSync(f, 'original');
  await perm.decide({ job: 'c3', tool: 'Edit', input: { file_path: f } });
  fs.writeFileSync(f, 'first edit');
  await perm.decide({ job: 'c3', tool: 'Edit', input: { file_path: f } });
  fs.writeFileSync(f, 'second edit');
  const [t] = perm.touches(['c3']);
  perm.restore(t.change);
  assert.equal(fs.readFileSync(f, 'utf8'), 'original');
});

test('a chat run is found by the conversation id, and only records from after it began count', async () => {
  const f = path.join(HOME, 'deliverables', 'thread.md');
  await perm.decide({ job: 'thread-9', tool: 'Write', input: { file_path: f } });
  assert.equal(perm.touches(['j-x', 'thread-9']).length, 1);
  assert.equal(perm.touches(['j-x', 'thread-9'], new Date(Date.now() + 60e3).toISOString()).length, 0, 'an earlier message in the same chat does not count');
  assert.equal(perm.touches(['j-x']).length, 0);
});

test('a redirect that overwrites a file is recorded with its earlier version', async () => {
  const f = path.join(HOME, 'deliverables', 'redirect.md');
  fs.writeFileSync(f, 'old text');
  await perm.decide({ job: 'c4', tool: 'Bash', input: { command: `echo new > ${f}` } });
  const [t] = perm.touches(['c4']);
  assert.equal(t.path, f);
  assert.ok(t.change);
});

test('files changed on disk while a run went on are found for runs that used a command; bookkeeping files and old changes are not', () => {
  const doc = path.join(HOME, 'deliverables', 'by-script.md');
  const bookkeeping = path.join(HOME, 'projects', 'x.json');
  fs.mkdirSync(path.dirname(bookkeeping), { recursive: true });
  const t0 = Date.now();
  fs.writeFileSync(doc, 'x'); fs.writeFileSync(bookkeeping, '{}');
  recent.note(doc); recent.note(bookkeeping); recent.note(path.join(HOME, 'deliverables', 'x.md.bak-1'));
  const found = recent.since(t0 - 100, Date.now()).map(f => f.path);
  assert.ok(found.includes(doc));
  assert.ok(!found.includes(bookkeeping), 'Jade\'s own project files are not "changed by the run"');
  assert.ok(!found.some(p => p.includes('.bak-')), 'backup copies are left out');
  assert.equal(recent.since(Date.now() + 60e3).length, 0, 'nothing from before the run');
});

// ---- pictures
const paste = (cid, name) => { const d = path.join(store.dirs.attachments, cid); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, name); fs.writeFileSync(f, 'png'); return f; };
const chatWith = (cid, images, text = 'here is a screenshot') => { store.appendTurn(cid, { role: 'user', text, images }); return store.getThread(cid).turns.at(-1); };

test('a pasted picture is deleted once a file has been written, and the chat says so', () => {
  const img = paste('t1', 'shot1.png');
  chatWith('t1', [img]);
  const out = path.join(HOME, 'deliverables', 'from-shot.md'); fs.writeFileSync(out, 'The numbers from the picture: 42 and 17.');
  const gone = tidy.releaseImages({ thread: 't1', touched: [{ path: out }], message: 'document this' });
  assert.deepEqual(gone, [img]);
  assert.equal(fs.existsSync(img), false);
  const turn = store.getThread('t1').turns.find(x => x.role === 'user');
  assert.deepEqual(turn.images, []);
  assert.equal(turn.gone, 1);
});

test('the picture stays when nothing was written, when asked to keep it, when a picture was itself saved, or when a file links to it', () => {
  const a = paste('t2', 'a.png'); chatWith('t2', [a]);
  assert.deepEqual(tidy.releaseImages({ thread: 't2', touched: [], message: 'what is this' }), [], 'nothing written');
  const b = paste('t3', 'b.png'); chatWith('t3', [b]);
  const out = path.join(HOME, 'deliverables', 'note3.md'); fs.writeFileSync(out, 'text');
  assert.deepEqual(tidy.releaseImages({ thread: 't3', touched: [{ path: out }], message: 'write this up and keep the screenshot' }), [], 'asked to keep');
  assert.deepEqual(tidy.releaseImages({ thread: 't3', touched: [{ path: out }], message: 'please do not delete it' }), []);
  const c = paste('t4', 'c.png'); chatWith('t4', [c]);
  assert.deepEqual(tidy.releaseImages({ thread: 't4', touched: [{ path: path.join(HOME, 'deliverables', 'copy.png') }], message: 'save it' }), [], 'a picture was the thing written');
  const d = paste('t5', 'linked.png'); chatWith('t5', [d]);
  const linked = path.join(HOME, 'deliverables', 'linked.md'); fs.writeFileSync(linked, 'See ![shot](../attachments/t5/linked.png)');
  assert.deepEqual(tidy.releaseImages({ thread: 't5', touched: [{ path: linked }], message: 'write it up' }), [], 'a written file names the picture');
  for (const f of [a, b, c, d]) assert.ok(fs.existsSync(f));
});

test('the picture sent with the previous message goes too, since the writing often comes one message later', () => {
  const first = paste('t6', 'first.png'); chatWith('t6', [first], 'what do you see');
  store.appendTurn('t6', { role: 'jade', text: 'a chart' });
  const second = paste('t6', 'second.png'); chatWith('t6', [second], 'and this one');
  const out = path.join(HOME, 'deliverables', 'both.md'); fs.writeFileSync(out, 'both');
  const gone = tidy.releaseImages({ thread: 't6', touched: [{ path: out }], message: 'document both' });
  assert.equal(gone.length, 2);
});

test('a picture outside Jade\'s attachments folder is never deleted', () => {
  const stray = path.join(os.tmpdir(), 'jade-stray-' + Date.now() + '.png'); fs.writeFileSync(stray, 'png');
  chatWith('t7', [stray]);
  const out = path.join(HOME, 'deliverables', 'x7.md'); fs.writeFileSync(out, 'x');
  assert.deepEqual(tidy.releaseImages({ thread: 't7', touched: [{ path: out }], message: 'go' }), []);
  assert.ok(fs.existsSync(stray)); fs.rmSync(stray);
});

test('the setting turns it off', () => {
  config.save({ chat: { releaseImages: false } });
  const img = paste('t8', 'off.png'); chatWith('t8', [img]);
  const out = path.join(HOME, 'deliverables', 'x8.md'); fs.writeFileSync(out, 'x');
  assert.deepEqual(tidy.releaseImages({ thread: 't8', touched: [{ path: out }], message: 'go' }), []);
  config.save({ chat: { releaseImages: true } });
});

test('attachments older than 30 days are removed, newer ones and empty folders handled', () => {
  const old = paste('t9', 'old.png'); const fresh = paste('t9', 'fresh.png');
  const past = new Date(Date.now() - 40 * 864e5); fs.utimesSync(old, past, past);
  assert.equal(tidy.pruneAttachments(30) >= 1, true);
  assert.equal(fs.existsSync(old), false); assert.equal(fs.existsSync(fresh), true);
});
