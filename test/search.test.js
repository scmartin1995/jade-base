// One search across documents, files by name, and chats: results of every kind, ranked together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-search-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const memory = await import('../server/core/memory.js');
const files = await import('../server/core/files.js');
const search = await import('../server/core/search.js');
config.load();
const HOME = config.JADE_HOME;
for (const d of ['notes', 'docs', 'deliverables', 'projects']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
fs.writeFileSync(path.join(HOME, 'notes', 'helios-minutes.md'), '# Helios weekly\n\nThe racking supplier slipped two weeks. Tom to confirm the new delivery date on Friday.\n');
fs.writeFileSync(path.join(HOME, 'docs', 'atlas-status.md'), '# Atlas CRM status\n\nMigration dry run passed. Data mapping for contacts is the open risk.\n');
fs.writeFileSync(path.join(HOME, 'deliverables', 'helios-status-dashboard.html'), '<html><body>dashboard</body></html>');
config.save({ memory: { folders: [HOME] } });
await memory.rebuild();
files.scan?.();
store.appendTurn('c1', { role: 'user', text: 'What did Tom say about the racking delivery?' });
store.appendTurn('c1', { role: 'jade', text: 'The racking crew slips two weeks; the new date is due Friday.' });

test('documents by content, with prefix matching and a snippet', () => {
  const r = search.search('racking supplier', { kinds: ['document'] });
  assert.ok(r.length >= 1, 'found the minutes');
  assert.equal(r[0].kind, 'note');
  assert.match(r[0].snippet, /racking/i);
  assert.ok(search.search('migrat', { kinds: ['document'] }).some(x => x.title === 'Atlas CRM status'), '"migrat" finds "Migration"');
});

test('files by name, any type', () => {
  const r = search.search('dashboard', { kinds: ['file'] });
  assert.ok(r.some(x => x.kind === 'file' && x.title === 'helios-status-dashboard.html'), 'the html deliverable by name');
});

test('chats take part, and everything ranks together', () => {
  const all = search.search('racking');
  const kinds = new Set(all.map(x => x.kind));
  assert.ok(kinds.has('note'), 'note'); assert.ok(kinds.has('chat'), 'chat');
  assert.ok(all.every((x, i) => i === 0 || all[i - 1].score >= x.score), 'sorted by score');
  const chat = all.find(x => x.kind === 'chat');
  assert.equal(chat.path, '#/chat/c1');
  assert.match(chat.snippet, /racking/i);
});
