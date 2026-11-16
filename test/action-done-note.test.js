// Marking an action done keeps its note; reopening drops it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-donenote-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const store = await import('../server/core/store.js');
store.init();

test('done keeps doneNote (trimmed); reopen drops it and doneAt', () => {
  const a = store.addAction({ text: 'Book the room' });
  const d = store.updateAction(a.id, { status: 'done', doneNote: '  Booked   for Friday ' });
  assert.equal(d.status, 'done'); assert.equal(d.doneNote, 'Booked for Friday'); assert.ok(d.doneAt);
  assert.equal(store.listActions().find(x => x.id === a.id).doneNote, 'Booked for Friday');
  const o = store.updateAction(a.id, { status: 'open' });
  assert.equal(o.doneNote, undefined); assert.equal(o.doneAt, undefined);
  assert.equal('doneNote' in store.listActions().find(x => x.id === a.id), false);
});
