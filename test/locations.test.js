// Where a project's files live: the one module that answers it, tested through its own functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { NO_READ_ONLY } from './helpers/env.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-locations-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const L = await import('../server/core/locations.js');
const { safeName } = await import('../server/core/util.js');
config.load();
const folder = n => fs.mkdirSync(path.join(tmp, n), { recursive: true }) && path.join(tmp, n);

test('foldersOf: absolute paths, "~" read as the home folder, blanks and non-text left out', () => {
  assert.deepEqual(L.foldersOf({ folders: ['~/Work/a', '  ', 5, null, '/x/y'] }), [path.join(os.homedir(), 'Work/a'), path.resolve('/x/y')]);
  assert.deepEqual(L.foldersOf({}), []);
  assert.deepEqual(L.foldersOf(null), []);
  assert.deepEqual(L.foldersOf({ folders: 'not a list' }), []);
  assert.equal(L.resolveHome('~'), os.homedir());
  assert.equal(L.resolveHome('~\\x'), path.join(os.homedir(), 'x'));
});

test('firstFolder and jadeDir: the chosen folder and the Jade sub-folder in it', () => {
  const dir = folder('p1');
  assert.equal(L.firstFolder({ folders: [dir, folder('p1b')] }), dir);
  assert.equal(L.firstFolder({ folders: [] }), '');
  assert.equal(L.jadeDir({ folders: [dir] }), path.join(dir, 'Jade'));
  assert.equal(L.jadeDir({ folders: [] }), '');
  config.save({ storage: { folderName: 'Records' } });
  assert.equal(L.jadeDir({ folders: [dir] }), path.join(dir, 'Records'));
  config.save({ storage: { folderName: '../..' } });   // a name that is not usable falls back
  assert.equal(L.jadeFolderName(), 'Jade');
  config.save({ storage: { folderName: 'Jade' } });
});

test('pathFor never creates; dirFor creates, and falls back to the data folder for a missing folder', () => {
  const dir = folder('p2'), p = { folders: [dir] };
  assert.equal(L.pathFor(p, 'Notes/sub'), path.join(dir, 'Jade', 'Notes', 'sub'));
  assert.equal(fs.existsSync(path.join(dir, 'Jade')), false, 'looking leaves the folder alone');
  assert.equal(L.dirFor(p, 'Meetings'), path.join(dir, 'Jade', 'Meetings'));
  assert.ok(fs.statSync(path.join(dir, 'Jade', 'Meetings')).isDirectory());
  const gone = { folders: [path.join(tmp, 'not-there')] };
  assert.equal(L.pathFor(gone, 'Notes'), path.join(config.JADE_HOME, 'notes'));
  assert.equal(L.pathFor(null, 'Meetings/x'), path.join(config.JADE_HOME, 'meetings', 'x'));
  assert.equal(L.pathFor(p, '../../etc'), path.join(dir, 'Jade', 'etc'), 'no way out through ..');
  assert.equal(fs.existsSync(path.join(tmp, 'not-there')), false);
});

test('a folder that cannot be written to is reported', { skip: NO_READ_ONLY || process.getuid?.() === 0 }, () => {
  const dir = folder('p3'); fs.chmodSync(dir, 0o500);
  try {
    assert.equal(L.folderProblem(dir), 'cannot be written to');
    assert.equal(L.usableJadeDir({ folders: [dir] }), null);
    assert.equal(L.folderProblem(path.join(tmp, 'nope')), 'is missing');
    const f = path.join(tmp, 'file.txt'); fs.writeFileSync(f, 'x');
    assert.equal(L.folderProblem(f), 'is not a folder');
  } finally { fs.chmodSync(dir, 0o700); }
});

test('dirFor tells onFail why when the project folder refuses, and uses the data folder', { skip: NO_READ_ONLY || process.getuid?.() === 0 }, () => {
  const dir = folder('p4'), jade = path.join(dir, 'Jade'); fs.mkdirSync(jade); fs.chmodSync(jade, 0o500);
  let heard = null;
  try {
    assert.equal(L.dirFor({ folders: [dir] }, 'Notes', e => { heard = e.code; }), path.join(config.JADE_HOME, 'notes'));
    assert.ok(heard);
  } finally { fs.chmodSync(jade, 0o700); }
});

test('within and below: the folder itself and what is under it, never a sibling that shares a prefix', () => {
  const a = path.join(tmp, 'a');
  assert.equal(L.within(a, a), true);
  assert.equal(L.within(a, path.join(a, 'b', 'c')), true);
  assert.equal(L.within(a, a + '2'), false);
  assert.equal(L.within(a, path.join(a, '..', 'x')), false);
  assert.equal(L.below(a, a), false);
  assert.equal(L.below(a, path.join(a, 'b')), true);
});

test('isJadeRecord: Jade\'s own records inside a project folder, with the configured folder name', () => {
  const j = n => path.join('/p', 'Jade', n);
  assert.equal(L.isJadeRecord(j('Meetings/2026 x.md')), true);
  assert.equal(L.isJadeRecord(j('Dashboards/a.json')), true);
  assert.equal(L.isJadeRecord(j('actions.json')), true);
  assert.equal(L.isJadeRecord('/p/other/Dashboards/a.html'), true);
  assert.equal(L.isJadeRecord(j('Notes/n.md')), false);
  assert.equal(L.isJadeRecord('/p/report.md'), false);
  config.save({ storage: { folderName: 'Records' } });
  assert.equal(L.isJadeRecord('/p/Records/Meetings/x.md'), true);
  assert.equal(L.isJadeRecord(j('Meetings/x.md')), false);
  config.save({ storage: { folderName: 'Jade' } });
});

test('safeName: a title as a file name, with the caller\'s fallback', () => {
  assert.equal(safeName('Q3 / review: "final"?', 'Dashboard'), 'Q3 review final');
  assert.equal(safeName('..hidden'), 'hidden');
  assert.equal(safeName('  ', 'Meeting'), 'Meeting');
  assert.equal(safeName(null), 'Item');
  assert.equal(safeName('x'.repeat(200)).length, 80);
});
