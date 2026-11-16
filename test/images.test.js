// Images pasted into a chat: kept as files under attachments/, refused when they are not plain images, and named in the turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-images-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
config.load(); store.init();

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a pasted PNG is saved under attachments/<chat>/ as a .png', () => {
  const f = store.saveImage('c-123', PNG);
  assert.ok(f.startsWith(path.join(store.dirs.attachments, 'c-123') + path.sep));
  assert.equal(path.extname(f), '.png');
  assert.equal(fs.readFileSync(f).subarray(1, 4).toString(), 'PNG');
});

test('anything that is not a plain image is refused (SVG and HTML can carry script)', () => {
  for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'https://example.com/a.png', '']) {
    assert.throws(() => store.saveImage('c-123', bad), /Only PNG, JPEG, GIF or WebP/);
  }
});

test('an image over 8 MB is refused', () => {
  const big = 'data:image/png;base64,' + Buffer.alloc(store.MAX_IMAGE_BYTES + 1).toString('base64');
  assert.throws(() => store.saveImage('c-123', big), /under 8 MB/);
});

test('a strange chat id cannot place the file outside attachments/', () => {
  const f = store.saveImage('../../outside', PNG);
  assert.ok(path.resolve(f).startsWith(store.dirs.attachments + path.sep));
});

test('any other file is kept under its own name in the chat folder', () => {
  const data = 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' + Buffer.from('fake docx').toString('base64');
  const f = store.saveAttachment('c-9', { name: 'Status Report Q4.docx', data });
  assert.equal(path.basename(f), 'Status Report Q4.docx');
  assert.ok(f.startsWith(path.join(store.dirs.attachments, 'c-9') + path.sep));
  assert.equal(fs.readFileSync(f, 'utf8'), 'fake docx');
  // a file with no type still works (browsers send an empty type for unknown extensions)
  const g = store.saveAttachment('c-9', { name: 'notes.unknownext', data: 'data:;base64,' + Buffer.from('x').toString('base64') });
  assert.equal(path.basename(g), 'notes.unknownext');
});

test('programs and scripts are refused; names cannot leave the folder; size and empty files are checked', () => {
  const data = 'data:application/octet-stream;base64,' + Buffer.from('x').toString('base64');
  for (const name of ['setup.exe', 'run.ps1', 'go.bat', 'x.lnk', 'a.vbs']) assert.throws(() => store.saveAttachment('c-9', { name, data }), /program or script/);
  const f = store.saveAttachment('c-9', { name: '..\\..\\outside.txt', data });
  assert.ok(path.resolve(f).startsWith(store.dirs.attachments + path.sep));
  assert.throws(() => store.saveAttachment('c-9', { name: 'e.txt', data: 'data:text/plain;base64,' }), /empty/);
  const big = 'data:text/plain;base64,' + Buffer.alloc(store.MAX_FILE_BYTES + 1).toString('base64');
  assert.throws(() => store.saveAttachment('c-9', { name: 'big.txt', data: big }), /over 25 MB/);
});

test('an image sent with no words is saved without any made-up text, and the chat is named for it', async () => {
  const agents = await import('../server/core/agents.js');
  const th = store.newThread('');
  store.appendTurn(th.id, { role: 'user', text: '', images: [store.saveImage(th.id, PNG)] });
  const t = store.getThread(th.id);
  assert.equal(t.turns[0].text, '');
  assert.equal(t.title, 'Image');
  const prep = await agents.prepare(agents.get('jade'), { message: '', thread: th.id, images: t.turns[0].images }, 'claude');
  assert.match(prep.prompt, /sent what is attached below with no message/);
  assert.doesNotMatch(prep.prompt, /What do you make of this/);
  assert.equal(agents.titleFor(agents.get('jade'), { images: t.turns[0].images }), 'Sent an image');
});
