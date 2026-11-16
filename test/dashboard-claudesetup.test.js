// How a project is set up for Claude Code, read from disk: files and counts, and the sessions of a folder (never their text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-cs-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const cs = await import('../server/core/claudesetup.js');

const folder = path.join(tmp, 'My Project.v2');
const put = (f, t = 'x') => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
put(path.join(folder, 'CLAUDE.md'), '# rules');
put(path.join(folder, '.claude/settings.json'), '{}');
put(path.join(folder, '.claude/agents/a.md')); put(path.join(folder, '.claude/agents/b.md'));
put(path.join(folder, '.claude/skills/one/SKILL.md')); put(path.join(folder, '.claude/skills/empty/readme.md'));
put(path.join(folder, '.claude/commands/c.md'));
put(path.join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { files: { command: 'secret-cmd' }, mail: {} } }));
fs.mkdirSync(path.join(folder, '.git'));

const sdir = path.join(process.env.JADE_CLAUDE_HOME, 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'));
const session = (name, cwd, mtime) => { const f = path.join(sdir, name); put(f, JSON.stringify({ type: 'user', cwd, message: 'SECRET CONVERSATION' }) + '\n'); fs.utimesSync(f, mtime, mtime); };

test('files and counts of a folder; the tools file gives names only', () => {
  const s = cs.forFolder(folder);
  assert.equal(s.claudeMd.exists, true); assert.equal(s.claudeMd.bytes, 7);
  assert.deepEqual(s.settings, { shared: true, local: false });
  assert.equal(s.agents, 2); assert.equal(s.skills, 1); assert.equal(s.commands, 1);
  assert.deepEqual(s.mcp, { exists: true, servers: ['files', 'mail'] });
  assert.equal(s.git, true);
  assert.equal(s.command, `cd "${folder}" && claude`);
  assert.ok(!JSON.stringify(s).includes('secret-cmd'));
});

test('no sessions found is null, not 0', () => {
  assert.equal(cs.forFolder(folder).sessions, null);
  assert.match(cs.describe(cs.forFolder(folder)), /no Claude Code sessions found/);
});

test('sessions: directory name from the path, counted, newest date, confirmed by cwd, no conversation text returned', () => {
  session('a.jsonl', folder, 1700000000); session('b.jsonl', folder, 1700500000);
  put(path.join(sdir, 'notes.txt'));
  const s = cs.forFolder(folder);
  assert.equal(s.sessions.count, 2);
  assert.equal(s.sessions.newest, new Date(1700500000 * 1000).toISOString());
  assert.ok(!JSON.stringify(s).includes('SECRET'));
  const text = cs.describe(s);
  assert.match(text, /^Has a CLAUDE\.md, 2 agents, 1 skill, 1 command, 2 connected tools \(files, mail\), Claude Code settings, git, 2 Claude Code sessions, last on \d+ Nov/);
});

test('a folder whose path spells the same but whose sessions came from elsewhere has none', () => {
  fs.rmSync(sdir, { recursive: true });
  session('x.jsonl', path.join(tmp, 'My', 'Project', 'v2'), 1700000000);
  assert.equal(cs.forFolder(folder).sessions, null);
});

test('a folder with nothing', () => {
  const e = cs.forFolder(path.join(tmp, 'plain')); assert.equal(e.exists, false);
  fs.mkdirSync(path.join(tmp, 'plain'));
  assert.match(cs.describe(cs.forFolder(path.join(tmp, 'plain'))), /^Not set up for Claude Code yet/);
});
