// Notes and actions are read once and kept, and the kept copy always equals what a fresh read of the files gives: after a note or
// action is added, changed, renamed or deleted, by Jade or by hand in the data folder or a project's Jade folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../server/core/util.js';
import { NO_READ_ONLY } from './helpers/env.js';
import { removeDir } from './helpers/rm.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-notes-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
config.load(); store.init();
const isRoot = process.getuid?.() === 0;
const folder = n => { const d = path.join(tmp, n); fs.mkdirSync(d, { recursive: true }); return d; };
const proj = store.saveProject({ name: 'Alpha', folders: [folder('alpha')] });
const jade = path.join(tmp, 'alpha', 'Jade');
const dataNotes = store.dirs.notes, dataActions = path.join(path.dirname(store.dirs.notes), 'actions.json');

const projectsWithFolders = () => store.listProjects().filter(p => p.folders?.[0]);
// ---- the slow way: read every file from scratch, the way the store did before it remembered anything
function slowNotes() {
  const out = [], seen = new Set();
  for (const [dir, owner] of [[dataNotes, ''], ...projectsWithFolders().map(p => [path.join(p.folders[0], 'Jade', 'Notes'), p.id])]) {
    let names = []; try { names = fs.readdirSync(dir); } catch {}
    for (const f of names.filter(f => f.endsWith('.md'))) {
      const file = path.join(dir, f), id = f.slice(0, -3);
      if (seen.has(id)) continue; seen.add(id);
      let st, text; try { st = fs.statSync(file); text = fs.readFileSync(file, 'utf8'); } catch { continue; }   // one that cannot be read is left out
      const { data, body } = parseFrontmatter(text);
      out.push({ id, title: data.title || id, project: data.project || owner, tags: data.tags || [], created: data.created || st.birthtime.toISOString(), updated: st.mtime.toISOString(), body });
    }
  }
  return out.sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id));
}
function slowActions() {
  const seen = new Set(), out = [];
  for (const [file, owner] of [[dataActions, ''], ...projectsWithFolders().map(p => [path.join(p.folders[0], 'Jade', 'actions.json'), p.id])]) {
    let list = []; try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    for (const a of list) { const x = owner && !a.project ? { ...a, project: owner } : a; if (!seen.has(x.id)) { seen.add(x.id); out.push(x); } }
  }
  return out;
}
const plain = x => JSON.parse(JSON.stringify(x));
const same = (what) => {
  assert.deepEqual(plain(store.listNotes()), plain(slowNotes()), `${what}: notes`);
  const byId = l => [...l].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(plain(store.listActions())), byId(plain(slowActions())), `${what}: actions`);
};
const note = (title, body = 'text', extra = '') => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;
const at = (file, iso) => { const d = new Date(iso); fs.utimesSync(file, d, d); };

test('notes: the remembered list equals a fresh read after add, change, rename and delete, by Jade and by hand', () => {
  same('empty');
  const a = store.saveNote({ title: 'First note', body: 'alpha body' });
  const b = store.saveNote({ title: 'In the project', body: 'beta body', project: proj.id });
  same('two saved');
  assert.ok(fs.existsSync(path.join(jade, 'Notes', `${b.id}.md`)));
  // changed by hand: same size, later time
  const fileA = path.join(dataNotes, `${a.id}.md`), text = fs.readFileSync(fileA, 'utf8');
  fs.writeFileSync(fileA, text.replace('alpha', 'omega')); at(fileA, '2031-01-01T00:00:00Z');
  same('changed by hand'); assert.match(store.listNotes().find(n => n.id === a.id).body, /omega/);
  // changed by hand to a different size, mtime put back where it was (a tool that keeps times): still seen, the size differs
  const before = fs.statSync(fileA); fs.writeFileSync(fileA, text + 'more words\n'); fs.utimesSync(fileA, before.atime, before.mtime);
  same('changed, time kept'); assert.match(store.listNotes().find(n => n.id === a.id).body, /more words/);
  // added by hand in both places
  const h1 = path.join(dataNotes, 'hand-made.md'); fs.writeFileSync(h1, note('Hand made', 'typed by a person', 'tags: [x, y]\nproject: other\n'));
  const h2 = path.join(jade, 'Notes', 'from-claude.md'); fs.writeFileSync(h2, note('From Claude Code', 'in the project folder'));
  same('added by hand'); assert.equal(store.listNotes().find(n => n.id === 'from-claude').project, proj.id, 'a note in the project folder belongs to it');
  // renamed
  fs.renameSync(h1, path.join(dataNotes, 'renamed.md'));
  same('renamed'); assert.ok(!store.listNotes().some(n => n.id === 'hand-made') && store.listNotes().some(n => n.id === 'renamed'));
  // the same note moved to another project through the app
  const moved = store.saveNote({ id: a.id, project: proj.id });
  same('moved to a project'); assert.equal(moved.project, proj.id); assert.ok(!fs.existsSync(fileA));
  // deleted by hand and through the app
  fs.rmSync(h2); same('deleted by hand');
  store.deleteNote(b.id); same('deleted');
  // a file that is not a note, and one that cannot be a note, are ignored
  fs.writeFileSync(path.join(dataNotes, 'readme.txt'), 'x'); fs.writeFileSync(path.join(dataNotes, '.hidden.md.1.2.tmp'), 'x');
  same('other files');
});

test('notes: the summaries and pages agree with the full list', () => {
  for (let i = 0; i < 12; i++) store.saveNote({ title: `Many ${i}`, body: `body number ${i} ` + 'w '.repeat(200), project: i % 3 ? '' : proj.id });
  const all = store.listNotes();
  const s = store.listNoteSummaries({ limit: 1000 });
  assert.equal(s.total, all.length);
  assert.deepEqual(s.items.map(n => n.id), all.map(n => n.id));
  for (const [i, n] of s.items.entries()) { assert.equal('body' in n, false, 'a summary has no text'); assert.equal(n.preview, all[i].body.slice(0, 220)); assert.equal(n.title, all[i].title); }
  assert.deepEqual(store.listNoteSummaries({ limit: 5, offset: 3 }).items.map(n => n.id), all.slice(3, 8).map(n => n.id));
  assert.deepEqual(store.listNoteSummaries({ project: proj.id, limit: 1000 }).items.map(n => n.id), all.filter(n => n.project === proj.id).map(n => n.id));
  assert.deepEqual(store.listNoteSummaries({ q: 'MANY 11' }).items.map(n => n.title), ['Many 11']);
  assert.equal(store.listNoteSummaries({ q: 'number 3 ' }).items.length >= 1, true, 'words in the first 220 characters are searched');
});

test('notes: a note that cannot be read is left out of the list and never saved over', { skip: NO_READ_ONLY }, () => {
  if (isRoot) return;
  const f = path.join(dataNotes, 'locked.md'); fs.writeFileSync(f, note('Locked')); fs.chmodSync(f, 0o000);
  try { same('unreadable'); assert.throws(() => store.saveNote({ id: 'locked', title: 'x' }), /could not be read/); }
  finally { fs.chmodSync(f, 0o644); }
  same('readable again');
});

test('actions: the remembered list equals a fresh read after add, change and delete, by Jade and by hand', () => {
  const a = store.addAction({ text: 'First action', owner: 'Pat' });
  const b = store.addAction({ text: 'Project action', project: proj.id, due: '2031-01-01' });
  same('added');
  assert.ok(JSON.parse(fs.readFileSync(path.join(jade, 'actions.json'), 'utf8')).some(x => x.id === b.id));
  store.updateAction(a.id, { status: 'done', doneNote: 'sent' }); same('updated');
  // edited by hand in the data folder (a different size) and in the project folder (same size, later time)
  const list = JSON.parse(fs.readFileSync(dataActions, 'utf8')); list.push({ id: 'by-hand', text: 'Typed into the file', status: 'open', project: '', createdAt: '2031-01-01T00:00:00Z' });
  fs.writeFileSync(dataActions, JSON.stringify(list, null, 2));
  same('hand edit, data folder'); assert.ok(store.listActions().some(x => x.id === 'by-hand'));
  const pf = path.join(jade, 'actions.json'), pt = fs.readFileSync(pf, 'utf8');
  fs.writeFileSync(pf, pt.replace('Project action', 'Project actiom')); at(pf, '2032-01-01T00:00:00Z');
  same('hand edit, project folder'); assert.equal(store.listActions().find(x => x.id === b.id).text, 'Project actiom');
  // a change made through the app is made on top of the hand edit, not the older copy
  store.updateAction('by-hand', { priority: 'high' }); same('update after hand edit');
  assert.equal(JSON.parse(fs.readFileSync(dataActions, 'utf8')).find(x => x.id === 'by-hand').priority, 'high');
  // deleted and replaced by hand
  fs.rmSync(pf); same('project file deleted');
  fs.writeFileSync(dataActions, '[]'); same('data file emptied');
  store.addAction({ text: 'After the wipe' }); same('add after');
  store.deleteAction(store.listActions()[0].id); same('deleted');
});

test('actions: two saves straight after each other both stand, and the file is never half-written', () => {
  store.addAction({ text: 'close one' }); store.addAction({ text: 'close two' });
  const texts = store.listActions().map(x => x.text);
  assert.ok(texts.includes('close one') && texts.includes('close two'));
  same('two quick saves');
  assert.deepEqual(JSON.parse(fs.readFileSync(dataActions, 'utf8')).map(x => x.text).sort(), slowActions().map(x => x.text).sort());
  assert.deepEqual(fs.readdirSync(path.dirname(dataActions)).filter(f => f.endsWith('.tmp')), []);
});

test('a save that is cut short (a temporary file left beside the real one) changes nothing', () => {
  const before = fs.readFileSync(dataActions, 'utf8');
  fs.writeFileSync(path.join(path.dirname(dataActions), '.actions.json.123.7.tmp'), '[{"id":"half');
  fs.writeFileSync(path.join(dataNotes, '.some-note.md.123.7.tmp'), '---\ntitle: half');
  assert.equal(fs.readFileSync(dataActions, 'utf8'), before);
  same('leftovers'); store.addAction({ text: 'works after' }); same('save after leftovers');
});

test('a failed write leaves the old file whole and no temporary file', { skip: NO_READ_ONLY || (isRoot && 'cannot make a folder read-only for root') }, () => {
  const d = folder('readonly'); const p = store.saveProject({ name: 'Locked', folders: [d] });
  const x = store.addAction({ text: 'kept safe', project: p.id });
  const file = path.join(d, 'Jade', 'actions.json'), before = fs.readFileSync(file, 'utf8');
  fs.chmodSync(path.join(d, 'Jade'), 0o500);
  try {
    const y = store.addAction({ text: 'cannot go there', project: p.id });   // falls back to the data folder, nothing lost
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(path.join(d, 'Jade')).filter(f => f.endsWith('.tmp')), []);
    assert.ok(store.listActions().some(a => a.id === y.id) && store.listActions().some(a => a.id === x.id));
  } finally { fs.chmodSync(path.join(d, 'Jade'), 0o700); }
});

test('queryActions and the owners list agree with the full list', () => {
  for (const [t, o, d, s] of [['alpha one', 'Kim', '2031-03-01', 'open'], ['beta two', 'Lee', '', 'open'], ['alpha three', 'Kim', '2031-01-01', 'done']]) { const x = store.addAction({ text: t, owner: o, due: d }); if (s === 'done') store.updateAction(x.id, { status: 'done' }); }
  const all = store.listActions();
  assert.deepEqual(store.queryActions({ status: 'open', q: 'ALPHA' }).map(a => a.text), ['alpha one']);
  assert.deepEqual(store.queryActions({ status: 'done', owner: 'Kim' }).map(a => a.text), ['alpha three']);
  assert.equal(store.queryActions({ status: 'all' }).length, all.length);
  const open = store.queryActions({ status: 'open' });
  assert.equal(open.length, all.filter(a => a.status !== 'done').length);
  assert.deepEqual(open.map(a => a.due || '9999'), [...open.map(a => a.due || '9999')].sort(), 'soonest due first');
  assert.deepEqual(store.queryActions({ status: 'open', limit: 2, offset: 1 }).map(a => a.id), open.slice(1, 3).map(a => a.id));
  assert.ok(store.actionOwners().includes('Kim') && store.actionOwners().includes('Lee'));
});

test('the actions of a project that is deleted drop out of what is remembered', () => {
  const d = folder('gone'); const p = store.saveProject({ name: 'Gone', folders: [d] });
  store.addAction({ text: 'in gone', project: p.id });
  assert.ok(store.listActions().some(a => a.text === 'in gone'));
  store.deleteProject(p.id);
  assert.ok(!store.listActions().some(a => a.text === 'in gone'), 'the project record is gone, so is the list of its actions');
  same('after project delete');
});

process.on('exit', () => { try { removeDir(tmp); } catch {} });
