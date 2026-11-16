// Skill sources: yours, built-in, Claude Code, project and plugin folders; precedence, ownedBy and exact-name lookup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-skills-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const skills = await import('../server/core/skills.js');
const store = await import('../server/core/store.js');

const mk = (dir, name, desc, extra = '') => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n${extra}---\nbody of ${name}\n`);
};
const ch = path.join(tmp, 'claude');
const proj = path.join(tmp, 'proj');
const plug = path.join(ch, 'plugins', 'cache', 'm', 'acme', '1.0');

mk(path.join(ch, 'skills', 'shared'), 'shared', 'from claude code');
mk(path.join(proj, '.claude', 'skills', 'shared'), 'shared', 'from project');
mk(path.join(proj, '.claude', 'skills', 'projonly'), 'projonly', 'project only');
mk(path.join(plug, 'skills', 'shared'), 'shared', 'from plugin');
mk(path.join(plug, 'skills', 'plugonly'), 'plugonly', 'plugin only');
mk(path.join(ch, 'skills', 'jade-transcript-key-points'), 'key-points', 'extract quarterly budget decisions');
fs.mkdirSync(path.join(ch, 'agents'), { recursive: true });
fs.writeFileSync(path.join(ch, 'agents', 'jade-transcript.md'), '---\nname: jade-transcript\n---\nx\n');
fs.writeFileSync(path.join(ch, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'acme@m': [{ installPath: plug }] } }));
const p = store.saveProject({ name: 'Proj', folders: [proj] });

test('every source is read and carries its origin', () => {
  const by = Object.fromEntries(skills.list().map(s => [s.name, s]));
  assert.equal(by.projonly.origin, 'project:' + p.id);
  assert.equal(by.plugonly.origin, 'plugin:acme');
  assert.equal(by.shared.origin, 'claude');
});

test('same name: claude beats project beats plugin; yours beats claude', () => {
  assert.equal(skills.byName('shared').description, 'from claude code');
  mk(path.join(process.env.JADE_HOME, 'skills', 'shared'), 'shared', 'from yours');
  assert.equal(skills.byName('shared').origin, 'yours');
  fs.rmSync(path.join(ch, 'skills', 'shared'), { recursive: true });
  fs.rmSync(path.join(process.env.JADE_HOME, 'skills', 'shared'), { recursive: true });
  assert.equal(skills.byName('shared').origin, 'project:' + p.id);
});

test('jade- skills carry ownedBy and stay out of chat matching', () => {
  const s = skills.list().find(x => x.name === 'key-points');
  assert.equal(s.ownedBy, 'jade-transcript');
  assert.equal(skills.match('extract quarterly budget decisions').some(x => x.name === 'key-points'), false);
});

test('byName and forAgent are exact and skip unknown names', () => {
  assert.deepEqual(Object.keys(skills.byName('plugonly')).sort(), ['body', 'description', 'dir', 'enabled', 'name', 'origin']);
  assert.equal(skills.byName('plug'), null);
  assert.deepEqual(skills.forAgent(['plugonly', 'nope', 'key-points']).map(s => s.name), ['plugonly', 'key-points']);
});

test('watchDirs covers the added folders', () => {
  const w = skills.watchDirs();
  assert.ok(w.includes(path.join(proj, '.claude', 'skills')));
  assert.ok(w.includes(path.join(plug, 'skills')));
});
