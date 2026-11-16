// Adding an action that is the same as an open one returns that one; it never links to an unrelated action that only shares the words.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeDir } from './helpers/rm.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-dedupe-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
config.load(); store.init();
after(() => removeDir(tmp));

test('the same words in another project or for another owner are a different action', () => {
  const a = store.addAction({ text: 'Send the report', project: 'alpha', owner: 'Sam' });
  assert.notEqual(store.addAction({ text: 'Send the report', project: 'beta', owner: 'Sam' }).id, a.id, 'other project');
  assert.notEqual(store.addAction({ text: 'Send the report', project: 'alpha', owner: 'Priya' }).id, a.id, 'other owner');
  assert.notEqual(store.addAction({ text: 'Send the report', project: '', owner: '' }).id, a.id, 'no project');
});

test('the very same action (even with other capitals or spacing) is not added twice', () => {
  const a = store.addAction({ text: 'Book the room', project: 'alpha', owner: 'Sam' });
  assert.equal(store.addAction({ text: '  book  the ROOM ', project: 'alpha', owner: 'Sam' }).id, a.id);
  store.updateAction(a.id, { status: 'done' });
  assert.notEqual(store.addAction({ text: 'Book the room', project: 'alpha', owner: 'Sam' }).id, a.id, 'a finished one is not reused');
});
