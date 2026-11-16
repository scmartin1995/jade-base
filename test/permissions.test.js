// The permission policy: what Jade allows at once, what it asks about, what it refuses, and that an edit can be undone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-perm-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const perm = await import('../server/core/permissions.js');
config.load();
const HOME = config.JADE_HOME;
const given = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-given-'));          // a folder the user gave Jade
config.save({ memory: { folders: [HOME, given] }, permissions: { mode: 'irreversible' } });
fs.mkdirSync(path.join(HOME, 'deliverables'), { recursive: true });

test('classify: reads, edits, commands and connector tools', () => {
  assert.equal(perm.classify('Read', { file_path: '/x' }).kind, 'read');
  assert.equal(perm.classify('Write', { file_path: path.join(HOME, 'deliverables', 'new.md') }).kind, 'create');
  assert.equal(perm.classify('Bash', { command: 'ls -la && cat README.md' }).kind, 'command');
  assert.equal(perm.classify('Bash', { command: 'rm -rf build' }).kind, 'destructive');
  assert.equal(perm.classify('Bash', { command: 'git reset --hard HEAD~1' }).kind, 'destructive');
  assert.equal(perm.classify('Bash', { command: 'echo hi > notes.md' }).kind, 'command', 'a > redirect to a new file is a write');
  assert.equal(perm.classify('Bash', { command: 'echo hi > notes.md' }).overwrites, null);
  fs.writeFileSync(path.join(HOME, 'notes.md'), 'old');
  assert.equal(perm.classify('Bash', { command: 'echo hi > notes.md' }).overwrites, path.join(HOME, 'notes.md'), 'an existing file is an overwrite (backed up)');
  assert.equal(perm.classify('Bash', { command: 'echo hi > /etc/hosts' }).kind, 'destructive', 'outside anywhere Jade may edit');
  assert.equal(perm.classify('Bash', { command: 'echo hi >> notes.md' }).kind, 'command', '>> appends');
  assert.equal(perm.classify('Bash', { command: 'sudo apt install x' }).kind, 'dangerous');
  assert.equal(perm.classify('mcp__claude_ai_Gmail__search_threads', {}).kind, 'read');
  assert.equal(perm.classify('mcp__claude_ai_Gmail__send_message', {}).kind, 'external');
  assert.equal(perm.classify('mcp__claude_ai_Dropbox__delete', {}).kind, 'external');
});

test('irreversible mode: working files and new deliverables just happen, overwrites keep the old version', async () => {
  const work = perm.workDir();
  assert.equal((await perm.decide({ job: 'j1', tool: 'Write', input: { file_path: path.join(work, 'scratch.txt') } })).behavior, 'allow');
  const d = path.join(HOME, 'deliverables', 'plan.md');
  assert.equal((await perm.decide({ job: 'j1', tool: 'Write', input: { file_path: d } })).behavior, 'allow', 'a new deliverable');
  fs.writeFileSync(d, 'version one');
  const r = await perm.decide({ job: 'j1', tool: 'Edit', input: { file_path: d } });
  assert.equal(r.behavior, 'allow'); assert.equal(r.asked, false);
  const kept = perm.changes().find(c => c.backup && c.path.endsWith('plan.md'));
  assert.ok(kept, 'the previous version was kept');
  assert.equal(fs.readFileSync(kept.backup, 'utf8'), 'version one');
  fs.writeFileSync(d, 'version two');
  perm.restore(kept.id);
  assert.equal(fs.readFileSync(d, 'utf8'), 'version one', 'restore puts it back');
  assert.ok(perm.changes().find(c => c.kind === 'restore' && c.backup), 'and the restore itself kept version two');
});

test('irreversible mode: anywhere under home is editable, system paths are refused; deleting user files asks; working-file deletes do not', async () => {
  const inHome = await perm.decide({ job: 'j2', tool: 'Write', input: { file_path: path.join(os.homedir(), 'Documents', 'Client X', 'brief.md') } });
  assert.equal(inHome.behavior, 'allow', 'a deliverable anywhere under home');
  const outside = await perm.decide({ job: 'j2', tool: 'Write', input: { file_path: '/etc/jade.conf' } });
  assert.equal(outside.behavior, 'deny');
  const overwrite = await perm.decide({ job: 'j2', tool: 'Bash', input: { command: `echo new > ${path.join(HOME, 'notes.md')}` } });
  assert.equal(overwrite.behavior, 'allow'); assert.equal(overwrite.asked, false);
  assert.ok(perm.changes().find(c => c.backup && c.path.endsWith('notes.md')), 'the file a redirect overwrites was kept');
  assert.equal((await perm.decide({ job: 'j2', tool: 'Bash', input: { command: `rm -rf ${perm.workDir()}/tmp` } })).behavior, 'allow', 'only Jade\'s working files');
  assert.equal((await perm.decide({ job: 'j2', tool: 'Bash', input: { command: 'npm test' } })).behavior, 'allow', 'an ordinary command');
  const p = perm.decide({ job: 'j2', tool: 'Bash', input: { command: `rm ${given}/charter.docx` } });
  await new Promise(r => setTimeout(r, 20));
  const q = perm.pendingList();
  assert.equal(q.length, 1, 'the delete is waiting for the user');
  assert.equal(q[0].kind, 'destructive');
  perm.answer(q[0].id, false);
  const r = await p;
  assert.equal(r.behavior, 'deny'); assert.equal(r.asked, true);
  // allowed and remembered for the rest of the run: the next destructive command in the same job does not ask
  const p2 = perm.decide({ job: 'j2', tool: 'Bash', input: { command: `rm ${given}/old.xlsx` } });
  await new Promise(r => setTimeout(r, 20));
  perm.answer(perm.pendingList()[0].id, true, true);
  assert.equal((await p2).behavior, 'allow');
  assert.equal((await perm.decide({ job: 'j2', tool: 'Bash', input: { command: `rm ${given}/older.xlsx` } })).asked, false);
  perm.forgetJob('j2');
});

test('connector writes ask; read mode refuses everything; auto mode asks nothing', async () => {
  const p = perm.decide({ job: 'j3', tool: 'mcp__claude_ai_Gmail__send_message', input: { to: 'a@b' } });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(perm.pendingList()[0]?.kind, 'external');
  perm.answer(perm.pendingList()[0].id, false);
  assert.equal((await p).behavior, 'deny');
  config.save({ permissions: { mode: 'read' } });
  assert.equal((await perm.decide({ job: 'j4', tool: 'Write', input: { file_path: path.join(perm.workDir(), 'a') } })).behavior, 'deny');
  config.save({ permissions: { mode: 'auto' } });
  assert.equal((await perm.decide({ job: 'j5', tool: 'Bash', input: { command: `rm ${given}/x` } })).behavior, 'allow');
  assert.equal((await perm.decide({ job: 'j5', tool: 'mcp__claude_ai_Gmail__send_message', input: {} })).asked, false);
  config.save({ permissions: { mode: 'irreversible' } });
});
