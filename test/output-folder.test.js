// Where Jade saves what it makes: its own deliverables folder by default, or a folder the user chose (their notes folder). A chosen
// folder that is not there right now falls back to the default instead of being created; it counts as a place Jade may edit, and
// the dashboard goes there for a project with no folder of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { writeStub } from './helpers/stub.js';

// prepare() turns editing on only when an engine is installed; a stand-in "claude" on PATH gives it one.
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-output-bin-'));
writeStub(bin, 'claude', 'process.exit(0);\n');
process.env.PATH = bin + path.delimiter + process.env.PATH;
process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-output-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const perm = await import('../server/core/permissions.js');
const agents = await import('../server/core/agents.js');
config.load(); store.init();
const HOME = config.JADE_HOME;
const notes = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-notes-'));

test('by default it is Jade\'s own deliverables folder', () => {
  assert.equal(config.outputDir(), path.join(HOME, 'deliverables'));
  assert.equal(config.outputIsCustom(), false);
});

test('a chosen folder is used, a missing one is not created', () => {
  config.save({ output: { folder: notes } });
  assert.equal(config.outputDir(), notes);
  assert.equal(config.outputIsCustom(), true);
  config.save({ output: { folder: path.join(os.tmpdir(), 'jade-no-such-folder-' + Date.now()) } });
  assert.equal(config.outputDir(), path.join(HOME, 'deliverables'), 'an offline drive falls back');
  assert.equal(fs.existsSync(path.join(os.tmpdir(), 'jade-no-such-folder')), false);
  config.save({ output: { folder: notes } });
});

test('the chosen folder is somewhere Jade may edit, and deleting there asks first', async () => {
  const n = path.join(notes, 'new.md');
  assert.equal((await perm.decide({ job: 'o0', tool: 'Write', input: { file_path: n } })).behavior, 'allow', 'a new file there');
  const f = path.join(notes, 'plan.md');
  fs.writeFileSync(f, 'one');
  const r = await perm.decide({ job: 'o1', tool: 'Edit', input: { file_path: f } });
  assert.equal(r.behavior, 'allow'); assert.ok(perm.touches(['o1']).some(t => t.path === f && t.change), 'the earlier version is kept');
  const del = perm.decide({ job: 'o1', tool: 'Bash', input: { command: `rm ${f}` } });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(perm.pendingList()[0]?.kind, 'destructive');
  perm.answer(perm.pendingList()[0].id, false);
  assert.equal((await del).behavior, 'deny');
});

test('the instruction names the chosen folder and tells the model to use a sub-folder, with no reference to a wiki rule section', async () => {
  const prep = await agents.prepare({ ...agents.get('jade'), context: [] }, { message: 'hi', thread: 't' }, 'claude');
  assert.ok(prep.system.includes(notes));
  assert.match(prep.system, /put new files in a sub-folder, not loose at its top level/);
  assert.doesNotMatch(prep.system, /wiki/i, 'no rule file that is never supplied');
  assert.ok(prep.dirs.includes(notes), 'the engine may reach it');
  config.save({ output: { folder: '' } });
  const plain = await agents.prepare({ ...agents.get('jade'), context: [] }, { message: 'hi', thread: 't' }, 'claude');
  assert.ok(plain.system.includes(path.join(HOME, 'deliverables')));
  assert.doesNotMatch(plain.system, /put new files in a sub-folder/);
});
