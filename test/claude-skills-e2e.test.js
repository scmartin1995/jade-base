// Owned skills end to end: an agent's skills: names resolve through skills.forAgent from the repo, the installed jade-* copies and Claude Code's skills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-e2e-skills-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const skills = await import('../server/core/skills.js');
const claudehome = await import('../server/core/claudehome.js');
const config = await import('../server/core/config.js');

const mk = (dir, name) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d ${name}\n---\nbody ${name}\n`); };

test('claude home comes from claudehome only', () => {
  assert.equal(claudehome.home(), process.env.JADE_CLAUDE_HOME);
  mk(path.join(claudehome.skillsDir(), 'plain'), 'plain');
  assert.equal(skills.byName('plain').origin, 'claude');
});

test('forAgent: installed copy, then repo copy, then any skill; unknown names dropped', () => {
  mk(path.join(claudehome.skillsDir(), 'jade-e2eagent-inst'), 'jade-e2eagent-inst');
  const repo = path.join(config.APP_ROOT, 'agents', 'e2eagent', 'skills', 'shipped');
  mk(repo, 'shipped');
  try {
    const got = skills.forAgent(['inst', 'shipped', 'plain', 'nope'], 'e2eagent');
    assert.deepEqual(got.map(s => s.name), ['jade-e2eagent-inst', 'shipped', 'plain']);
    assert.equal(skills.forAgent(['plain']).length, 1);
  } finally { fs.rmSync(path.join(config.APP_ROOT, 'agents', 'e2eagent'), { recursive: true, force: true }); }
});
