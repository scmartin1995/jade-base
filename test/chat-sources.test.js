// A chat gets Jade's own sources when the message is about them: the calendar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-chat-sources-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const agents = await import('../server/core/agents.js');
config.load(); store.init();

test('meeting questions get the calendar', () => {
  assert.deepEqual(agents.chatSources('are there any emails from the vendor that need my approval?'), []);
  assert.ok(agents.chatSources('what meetings do I have tomorrow?').includes('calendar'));
  assert.deepEqual(agents.chatSources('look up ABC-42 for me'), []);
  assert.deepEqual(agents.chatSources('summarise the migration principles record'), []);
});

