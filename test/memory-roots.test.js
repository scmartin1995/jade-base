// The search index covers every project's folders and the data folder's notes by default; Settings folders are extra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-memroots-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const memory = await import('../server/core/memory.js');
config.load(); store.init();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-memroots-dirs-'));
const projDir = path.join(tmp, 'proj'), extra = path.join(tmp, 'extra');
fs.mkdirSync(projDir); fs.mkdirSync(extra); fs.mkdirSync(store.dirs.notes, { recursive: true });
fs.writeFileSync(path.join(projDir, 'a.md'), '# Zebrafish plan\n\nquokka procurement schedule\n');
fs.writeFileSync(path.join(extra, 'b.md'), '# Extra\n\nnarwhal budget table\n');
fs.writeFileSync(path.join(store.dirs.notes, 'n.md'), '# Note\n\naxolotl note text\n');

test('defaults: project folders and the notes folder, nothing configured', async () => {
  store.saveProject({ name: 'P', folders: [projDir] });
  const r = memory.roots();
  assert.ok(r.includes(projDir) && r.includes(store.dirs.notes));
  assert.ok(!r.includes(extra));
  await memory.rebuild();
  assert.ok(memory.search('quokka procurement').length);
  assert.ok(memory.search('axolotl note').length);
});

test('user-configured memory folders are extra roots', async () => {
  config.save({ memory: { folders: [extra] } });
  const r = memory.roots();
  assert.ok(r.includes(extra) && r.includes(projDir) && r.includes(store.dirs.notes));
  await memory.rebuild();
  assert.ok(memory.search('narwhal budget').length);
  assert.ok(memory.search('quokka procurement').length);
});
