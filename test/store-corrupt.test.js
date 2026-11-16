// A project's actions.json that does not parse is never read as empty and never written over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { NO_READ_ONLY } from './helpers/env.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-corrupt-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
config.load(); store.init();

const folder = n => fs.mkdirSync(path.join(tmp, n), { recursive: true }) && path.join(tmp, n);
const isRoot = process.getuid?.() === 0;

test('an unparseable project actions.json is kept, copied aside, and new changes go to the data folder', () => {
  const dir = folder('broken');
  const p = store.saveProject({ name: 'Broken', folders: [dir] });
  const first = store.addAction({ text: 'before', project: p.id });
  const file = path.join(dir, 'Jade', 'actions.json');
  const garbled = fs.readFileSync(file, 'utf8').slice(0, -9);   // cut short, the way a sync tool or a hand edit can leave it
  fs.writeFileSync(file, garbled);

  assert.equal(store.listActions().some(a => a.id === first.id), false, 'unreadable, so not listed');
  const added = store.addAction({ text: 'after', project: p.id });
  assert.equal(fs.readFileSync(file, 'utf8'), garbled, 'the broken file is never rewritten');
  const copies = fs.readdirSync(path.join(dir, 'Jade')).filter(f => f.startsWith('actions.json.corrupt-'));
  assert.equal(copies.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'Jade', copies[0]), 'utf8'), garbled, 'the copy is the original');
  assert.ok(JSON.parse(fs.readFileSync(path.join(store.dirs.projects, '..', 'actions.json'), 'utf8')).some(a => a.id === added.id), 'new change is in the data folder');
  assert.ok(store.listActions().some(a => a.id === added.id));
  store.updateAction(added.id, { status: 'done' });
  store.deleteAction(added.id);
  assert.equal(fs.readFileSync(file, 'utf8'), garbled, 'still untouched after more changes');
  assert.equal(fs.readdirSync(path.join(dir, 'Jade')).filter(f => f.startsWith('actions.json.corrupt-')).length, 1, 'one copy, not one per change');
  const notice = store.getProject(p.id).storageNotice;
  assert.match(notice, /could not be read/);
  assert.match(notice, /actions\.json\.corrupt-/);
});

test('a list that is JSON but not a list is treated the same way', () => {
  const dir = folder('object');
  const p = store.saveProject({ name: 'Object', folders: [dir] });
  fs.mkdirSync(path.join(dir, 'Jade'));
  const file = path.join(dir, 'Jade', 'actions.json');
  fs.writeFileSync(file, '{"oops": true}');
  store.addAction({ text: 'x', project: p.id });
  assert.equal(fs.readFileSync(file, 'utf8'), '{"oops": true}');
  assert.ok(store.storageNotice(p.id));
});

test('once the file is fixed by hand it is used again and the notice goes', () => {
  const dir = folder('fixed');
  const p = store.saveProject({ name: 'Fixed', folders: [dir] });
  fs.mkdirSync(path.join(dir, 'Jade'));
  const file = path.join(dir, 'Jade', 'actions.json');
  fs.writeFileSync(file, '[{"id":"a1","text":"kept","status":"open"');
  const a = store.addAction({ text: 'new one', project: p.id });
  fs.writeFileSync(file, JSON.stringify([{ id: 'a1', text: 'kept', status: 'open' }]));
  assert.equal(store.storageNotice(p.id), null);
  const ids = store.listActions().map(x => x.id);
  assert.ok(ids.includes('a1') && ids.includes(a.id));
  store.updateAction(a.id, { status: 'done' });
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).some(x => x.id === a.id), 'moves into the fixed file');
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).some(x => x.id === 'a1'));
});

test('an unreadable data-folder list is copied aside before it is replaced', () => {
  const file = path.join(store.dirs.projects, '..', 'actions.json');
  fs.writeFileSync(file, '[{"id":"zz"');
  store.addAction({ text: 'fresh' });
  const copy = fs.readdirSync(path.dirname(file)).find(f => f.startsWith('actions.json.corrupt-'));
  assert.ok(copy);
  assert.equal(fs.readFileSync(path.join(path.dirname(file), copy), 'utf8'), '[{"id":"zz"');
});

test('moving a record out of a project file writes the data folder first', { skip: NO_READ_ONLY || isRoot }, () => {
  const dir = folder('offline');
  const p = store.saveProject({ name: 'Offline', folders: [dir] });
  const a = store.addAction({ text: 'travels', project: p.id });
  const file = path.join(dir, 'Jade', 'actions.json');
  // the folder goes read-only: the record must land in the data folder, and the project file must still hold it
  fs.chmodSync(path.join(dir, 'Jade'), 0o500); fs.chmodSync(dir, 0o500);
  try {
    store.updateAction(a.id, { status: 'done' });
    const home = JSON.parse(fs.readFileSync(path.join(store.dirs.projects, '..', 'actions.json'), 'utf8'));
    assert.equal(home.find(x => x.id === a.id)?.status, 'done');
    assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).some(x => x.id === a.id), 'the project file was not emptied');
  } finally { fs.chmodSync(dir, 0o700); fs.chmodSync(path.join(dir, 'Jade'), 0o700); }
});

test('a note whose file cannot be read is not saved over', () => {
  const dir = folder('notes');
  const p = store.saveProject({ name: 'Notes', folders: [dir] });
  const n = store.saveNote({ title: 'Plan', body: 'keep me', project: p.id });
  const file = path.join(dir, 'Jade', 'Notes', n.id + '.md');
  fs.rmSync(file); fs.mkdirSync(file);   // present but unreadable as a file
  assert.throws(() => store.saveNote({ id: n.id, title: 'Plan', body: 'replacement', project: p.id }), /could not be read/);
  assert.ok(fs.statSync(file).isDirectory());
  assert.equal(fs.existsSync(path.join(store.dirs.notes, n.id + '.md')), false, 'no stray copy either');
});

test('a note falls back to the data folder before its project copy is removed', { skip: NO_READ_ONLY || isRoot }, () => {
  const dir = folder('notefall');
  const p = store.saveProject({ name: 'NoteFall', folders: [dir] });
  const n = store.saveNote({ title: 'Stay', body: 'v1', project: p.id });
  const file = path.join(dir, 'Jade', 'Notes', n.id + '.md');
  fs.chmodSync(path.join(dir, 'Jade', 'Notes'), 0o500);
  try {
    store.saveNote({ id: n.id, title: 'Stay', body: 'v2', project: p.id });
    assert.equal(store.getNote(n.id).body, 'v2');
    assert.ok(fs.existsSync(path.join(store.dirs.notes, n.id + '.md')));
  } finally { fs.chmodSync(path.join(dir, 'Jade', 'Notes'), 0o700); }
});
