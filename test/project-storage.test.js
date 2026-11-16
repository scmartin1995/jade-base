// Project notes and actions are saved in the project's own folder; a folder that cannot be used falls back to the data folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { waitFor } from './helpers/server.js';
import { NO_READ_ONLY } from './helpers/env.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-storage-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const { bus } = await import('../server/core/bus.js');
config.load(); store.init();

const folder = n => fs.mkdirSync(path.join(tmp, n), { recursive: true }) && path.join(tmp, n);
const events = [];
bus.on('event', e => { if (e.type === 'data') events.push(e.payload.kind); });
const isRoot = process.getuid?.() === 0;

test('folderName defaults to Jade', () => assert.equal(config.get().storage.folderName, 'Jade'));

test('a project note and action round-trip inside the project folder', () => {
  const dir = folder('alpha');
  const p = store.saveProject({ name: 'Alpha', folders: [dir] });
  const n = store.saveNote({ title: 'Kickoff', body: 'hello', project: p.id });
  assert.ok(fs.existsSync(path.join(dir, 'Jade', 'Notes', n.id + '.md')));
  assert.equal(fs.existsSync(path.join(store.dirs.notes, n.id + '.md')), false);
  assert.equal(store.getNote(n.id).body, 'hello');
  assert.equal(store.getNote(n.id).project, p.id);
  assert.ok(store.listNotes().some(x => x.id === n.id));
  const a = store.addAction({ text: 'Do it', project: p.id });
  const file = path.join(dir, 'Jade', 'actions.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].id, a.id);
  assert.equal(store.updateAction(a.id, { status: 'done' }).status, 'done');
  assert.equal(store.listActions().find(x => x.id === a.id).status, 'done');
  assert.ok(events.includes('notes') && events.includes('actions'));
  store.deleteAction(a.id);
  assert.equal(store.listActions().some(x => x.id === a.id), false);
  store.deleteNote(n.id);
  assert.equal(store.getNote(n.id), null);
});

test('items with no project stay in the data folder, and lists merge every location', () => {
  const p = store.saveProject({ name: 'Merge', folders: [folder('merge')] });
  const loose = store.saveNote({ title: 'Loose', body: 'x' });
  const mine = store.saveNote({ title: 'Mine', body: 'y', project: p.id });
  assert.ok(fs.existsSync(path.join(store.dirs.notes, loose.id + '.md')));
  const ids = store.listNotes().map(x => x.id);
  assert.ok(ids.includes(loose.id) && ids.includes(mine.id));
  const a1 = store.addAction({ text: 'loose one' }), a2 = store.addAction({ text: 'project one', project: p.id });
  assert.ok(JSON.parse(fs.readFileSync(path.join(store.dirs.projects, '..', 'actions.json'), 'utf8')).some(x => x.id === a1.id));
  const all = store.listActions().map(x => x.id);
  assert.ok(all.includes(a1.id) && all.includes(a2.id));
  assert.equal(new Set(all).size, all.length);
});

test('moving a note or action to another project moves its file or record', () => {
  const d1 = folder('mv1'), d2 = folder('mv2');
  const p1 = store.saveProject({ name: 'Mv1', folders: [d1] }), p2 = store.saveProject({ name: 'Mv2', folders: [d2] });
  const n = store.saveNote({ title: 'Mover', body: 'b', project: p1.id });
  store.saveNote({ id: n.id, project: p2.id });
  assert.equal(fs.existsSync(path.join(d1, 'Jade', 'Notes', n.id + '.md')), false);
  assert.ok(fs.existsSync(path.join(d2, 'Jade', 'Notes', n.id + '.md')));
  assert.equal(store.getNote(n.id).body, 'b');
  store.saveNote({ id: n.id, project: '' });
  assert.ok(fs.existsSync(path.join(store.dirs.notes, n.id + '.md')));
  assert.equal(fs.existsSync(path.join(d2, 'Jade', 'Notes', n.id + '.md')), false);
  const a = store.addAction({ text: 'Move me', project: p1.id });
  store.updateAction(a.id, { project: p2.id });
  assert.equal(JSON.parse(fs.readFileSync(path.join(d1, 'Jade', 'actions.json'), 'utf8')).some(x => x.id === a.id), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d2, 'Jade', 'actions.json'), 'utf8')).some(x => x.id === a.id), true);
});

test('deleting a project keeps everything in its folder', () => {
  const d = folder('keep');
  const p = store.saveProject({ name: 'Keep', folders: [d] });
  const n = store.saveNote({ title: 'Stays', project: p.id }); store.addAction({ text: 'stays too', project: p.id });
  store.deleteProject(p.id);
  assert.ok(fs.existsSync(path.join(d, 'Jade', 'Notes', n.id + '.md')));
  assert.ok(fs.existsSync(path.join(d, 'Jade', 'actions.json')));
});

test('unknown and legacy fields survive an update', () => {
  const d = folder('legacy');
  const p = store.saveProject({ name: 'Legacy', folders: [d] });
  fs.mkdirSync(path.join(d, 'Jade', 'Notes'), { recursive: true });
  fs.writeFileSync(path.join(d, 'Jade', 'Notes', 'by-hand.md'), '---\ntitle: By hand\nreviewer: Sam\ntags:\n  - a\n---\nbody text');
  const seen = store.getNote('by-hand');
  assert.equal(seen.project, p.id);   // belongs to the project whose folder it is in
  store.saveNote({ id: 'by-hand', body: 'changed' });
  const text = fs.readFileSync(path.join(d, 'Jade', 'Notes', 'by-hand.md'), 'utf8');
  assert.match(text, /reviewer: Sam/); assert.match(text, /changed/);
  fs.writeFileSync(path.join(d, 'Jade', 'actions.json'), JSON.stringify([{ id: 'old1', text: 'Old', status: 'open', extra: { x: 1 }, legacyField: 'keep' }]));
  assert.equal(store.listActions().find(x => x.id === 'old1').project, p.id);
  store.updateAction('old1', { owner: 'me' });
  const rec = JSON.parse(fs.readFileSync(path.join(d, 'Jade', 'actions.json'), 'utf8')).find(x => x.id === 'old1');
  assert.equal(rec.legacyField, 'keep'); assert.deepEqual(rec.extra, { x: 1 }); assert.equal(rec.owner, 'me');
});

test('a missing folder falls back to the data folder with a notice', () => {
  const p = store.saveProject({ name: 'Gone', folders: [path.join(tmp, 'does-not-exist')] });
  const n = store.saveNote({ title: 'Safe', project: p.id });
  const a = store.addAction({ text: 'safe action', project: p.id });
  assert.ok(fs.existsSync(path.join(store.dirs.notes, n.id + '.md')));
  assert.equal(store.getNote(n.id).project, p.id);
  assert.ok(store.listActions().some(x => x.id === a.id));
  assert.match(store.storageNotice(p.id), /missing/);
  assert.match(store.getProject(p.id).storageNotice, /data folder/);
  assert.equal(fs.existsSync(path.join(tmp, 'does-not-exist')), false);
  assert.equal(store.storageNotice('nope'), null);
  assert.equal(store.storageNotice(store.saveProject({ name: 'NoFolder' }).id), null);
  assert.equal('storageNotice' in store.saveProject(store.getProject(p.id)), false);   // never saved into the project file
  assert.equal('storageNotice' in JSON.parse(fs.readFileSync(path.join(store.dirs.projects, p.id + '.json'), 'utf8')), false);
});

test('a read-only folder falls back, and the project returns to its folder once it can be written', { skip: NO_READ_ONLY || isRoot }, () => {
  const d = folder('ro');
  const p = store.saveProject({ name: 'Readonly', folders: [d] });
  fs.chmodSync(d, 0o555);
  try {
    const n = store.saveNote({ title: 'Ro note', project: p.id });
    const a = store.addAction({ text: 'ro action', project: p.id });
    assert.ok(fs.existsSync(path.join(store.dirs.notes, n.id + '.md')));
    assert.ok(store.listActions().some(x => x.id === a.id));
    assert.match(store.storageNotice(p.id), /cannot be written/);
    fs.chmodSync(d, 0o755);
    assert.equal(store.storageNotice(p.id), null);
    store.saveNote({ id: n.id, body: 'again' });
    assert.ok(fs.existsSync(path.join(d, 'Jade', 'Notes', n.id + '.md')));
    assert.equal(fs.existsSync(path.join(store.dirs.notes, n.id + '.md')), false);
  } finally { fs.chmodSync(d, 0o755); }
});

test('a write that throws inside a writable folder falls back and reports it', () => {
  const d = folder('blocked');
  fs.writeFileSync(path.join(d, 'Jade'), 'a file where the folder should be');
  const p = store.saveProject({ name: 'Blocked', folders: [d] });
  const n = store.saveNote({ title: 'Blocked note', project: p.id });
  const a = store.addAction({ text: 'blocked action', project: p.id });
  assert.ok(fs.existsSync(path.join(store.dirs.notes, n.id + '.md')));
  assert.ok(store.listActions().some(x => x.id === a.id));
  assert.ok(store.storageNotice(p.id));
  assert.equal(store.projectDir(p.id, 'Meetings'), path.join(store.paths().home, 'meetings'));
});

test('projectDir creates the sub-folder on demand, or uses the data folder', () => {
  const d = folder('pd');
  const p = store.saveProject({ name: 'Pdir', folders: [d] });
  assert.equal(store.projectDir(p.id, 'Meetings'), path.join(d, 'Jade', 'Meetings'));
  assert.ok(fs.statSync(path.join(d, 'Jade', 'Meetings')).isDirectory());
  assert.equal(store.projectDir(p.id, '../../escape'), path.join(d, 'Jade', 'escape'));
  assert.equal(store.projectDir('', 'Notes'), store.dirs.notes);
  config.save({ storage: { folderName: 'Material' } });
  assert.equal(store.projectDir(p.id, 'Dashboards'), path.join(d, 'Material', 'Dashboards'));
  config.save({ storage: { folderName: 'Jade' } });
});

test('concurrent writes leave whole files', async () => {
  const d = folder('conc');
  const p = store.saveProject({ name: 'Conc', folders: [d] });
  const n = store.saveNote({ title: 'Race', project: p.id });
  await Promise.all(Array.from({ length: 40 }, (_, i) => Promise.resolve().then(() => {
    store.saveNote({ id: n.id, body: 'v' + i });
    store.addAction({ text: 'task ' + i, project: p.id });
  })));
  assert.match(store.getNote(n.id).body, /^v\d+$/);
  assert.equal(store.listActions().filter(x => x.project === p.id).length, 40);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'Jade', 'actions.json'), 'utf8')).length, 40);
  assert.deepEqual(fs.readdirSync(path.join(d, 'Jade')).filter(f => f.endsWith('.tmp')), []);
});

test('hand edits in a project folder emit the same data events', async () => {
  const d = folder('watch');
  const p = store.saveProject({ name: 'Watched', folders: [d] });
  store.saveNote({ title: 'First', project: p.id });   // creates Jade/Notes, which sync picks up
  store.syncWatches();
  // the watcher is ready once a hand edit is seen: keep touching a probe file until it is
  let n = 0;
  await waitFor(() => { fs.writeFileSync(path.join(d, 'Jade', 'Notes', 'probe.md'), `---\ntitle: Probe\n---\n${n++}`); return events.includes('notes'); }, { interval: 100, message: 'the folder watcher to see a first edit' });
  events.length = 0;
  fs.writeFileSync(path.join(d, 'Jade', 'Notes', 'typed.md'), '---\ntitle: Typed\n---\nx');
  fs.writeFileSync(path.join(d, 'Jade', 'actions.json'), '[]');
  await waitFor(() => events.includes('notes') && events.includes('actions'), { message: 'both data events after a hand edit' });
  assert.ok(events.includes('notes'), 'notes event');
  assert.ok(events.includes('actions'), 'actions event');
});
