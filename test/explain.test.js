// The plain-words version of a permission question: what will happen, to which files, whether it can be undone, what No means.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../server/core/explain.js';

const cmd = (command, extra = {}) => explain({ kind: 'command', command, ...extra });

test('creating and editing a file say what happens and that the earlier version is kept', () => {
  const e = explain({ kind: 'edit', path: '/home/u/OneDrive/Projects/Team/Records/app-orders.md', exists: true });
  assert.match(e.headline, /change a file: app-orders\.md/);
  assert.equal(e.level, 'undoable');
  assert.match(e.levelText, /earlier version is saved first/);
  assert.deepEqual(e.files, [{ name: 'app-orders.md', where: 'Projects › Team › Records' }]);
  const n = explain({ kind: 'create', path: '/x/y/new.md', exists: false });
  assert.match(n.headline, /create a new file: new\.md/);
  assert.match(n.steps[0], /Nothing that exists now is touched/);
});

test('a delete is final, names the files, and is called out', () => {
  const e = explain({ kind: 'destructive', command: 'rm -rf "/home/u/Docs/old plans" /home/u/Docs/draft.docx' });
  assert.equal(e.level, 'final');
  assert.match(e.headline, /^Jade wants to delete old plans, draft\.docx/);
  assert.match(e.levelText, /does not keep a copy/);
  assert.deepEqual(e.files.map(f => f.name), ['old plans', 'draft.docx'], 'the folder and the file it deletes are both listed, with where they are');
});

test('ordinary commands are put in plain words', () => {
  assert.match(cmd('mv a.txt /home/u/Archive/').steps[0], /Move a\.txt to Archive|Move a\.txt to/);
  assert.match(cmd('cp report.docx /home/u/Backup/').steps[0], /Copy report\.docx/);
  assert.equal(cmd('cp report.docx /home/u/Backup/').level, 'undoable');
  assert.match(cmd('git push origin main', {}).steps[0], /publishes it/);
  assert.equal(cmd('git push origin main').level, 'final');
  assert.match(cmd('curl -s https://example.com/data.json').steps[0], /Contact a web address \(example\.com\)/);
  assert.match(cmd('npm install left-pad').steps[0], /Install or update software \(left-pad\)/);
  assert.match(cmd('python build.py').steps[0], /Run a program \(build\.py\)/);
});

test('a command that only looks is safe, and says nothing changes', () => {
  const e = cmd('ls -la && cat README.md | grep title');
  assert.equal(e.level, 'safe');
  assert.match(e.levelText, /only looks/);
});

test('a chain takes the worst step, and long chains are summarised', () => {
  const e = cmd('cd /tmp && cp a b && rm -f old.txt');
  assert.equal(e.level, 'final');
  assert.equal(e.steps.length, 2, 'the cd is left out');
  assert.match(e.steps[0], /^Copy a to /);
  assert.ok(e.steps.some(s => /Delete old\.txt/.test(s)));
  assert.ok(!e.steps.some(s => /^Run “cd”/.test(s)), 'cd is not worth mentioning');
  const long = cmd('rm a && rm b && rm c && rm d && rm e && rm f && rm g');
  assert.equal(long.steps.length, 6); assert.match(long.steps.at(-1), /and 2 more steps/);
});

test('a command it cannot read is said to be unreadable, never guessed at', () => {
  const e = cmd('frobnicate --all');
  assert.equal(e.level, 'unknown');
  assert.match(e.steps[0], /cannot tell exactly/);
  assert.match(e.levelText, /cannot promise it can be undone/);
});

test('a redirect that overwrites a file names the file', () => {
  const e = cmd('echo hi > /home/u/notes.md', { overwrites: '/home/u/notes.md' });
  assert.ok(e.steps.some(s => /Replace the contents of notes\.md/.test(s)));
  assert.deepEqual(e.files.map(f => f.name), ['notes.md']);
});

test('the model\'s own one-line description is passed along, trimmed', () => {
  const e = explain({ kind: 'command', command: 'ls', input: { description: '  Lists the   files in the folder  ' } });
  assert.equal(e.own, 'Lists the files in the folder');
});

test('sending through a connector is final and says No means nothing is sent', () => {
  const e = explain({ kind: 'external', label: 'send message via Gmail' });
  assert.equal(e.level, 'final');
  assert.match(e.headline, /send message using Gmail/);
  assert.match(e.ifNo, /Nothing is sent/);
});

test('a dangerous command is called out as reaching the whole computer', () => {
  const e = explain({ kind: 'dangerous', command: 'sudo apt install x' });
  assert.match(e.headline, /whole computer/);
  assert.equal(e.level, 'final');
});

test('it never throws on odd input', () => {
  for (const r of [undefined, {}, { kind: 'command' }, { kind: 'command', command: '"unterminated' }, { kind: 'edit' }, { kind: 'zzz', label: 'x' }, { kind: 'command', command: '&& || ;' }])
    assert.doesNotThrow(() => explain(r));
});
