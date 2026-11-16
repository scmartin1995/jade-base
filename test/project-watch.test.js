// An agent or a skill Claude Code creates in a project that had no .claude/agents or .claude/skills folder when Jade started shows up
// without a restart.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitFor } from './helpers/server.js';
import { removeDir } from './helpers/rm.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-pwatch-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const agents = await import('../server/core/agents.js');
const { bus } = await import('../server/core/bus.js');
config.load(); store.init();
after(() => removeDir(tmp));

const heard = [];
bus.on('event', e => heard.push(e.type));
const proj = path.join(tmp, 'site');
fs.mkdirSync(proj, { recursive: true });
store.saveProject({ name: 'Site', folders: [proj] });
const stop = agents.watch();
after(() => stop());

test('an agent created in a project with no .claude folder at all appears without a restart', async () => {
  heard.length = 0;
  fs.mkdirSync(path.join(proj, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'agents', 'late.md'), '---\nname: late\ndescription: made after start\n---\nDo it.\n');
  await waitFor(() => heard.includes('agents') || null, { message: 'an agents event' });
  assert.ok(agents.list().some(a => a.id === 'late'), 'the list has it');
});

test('a second agent in the folder that now exists is seen too (the watch moved down)', async () => {
  heard.length = 0;
  await new Promise(r => setTimeout(r, 600));   // the watch is re-armed after a short pause
  fs.writeFileSync(path.join(proj, '.claude', 'agents', 'later.md'), '---\nname: later\ndescription: and another\n---\nDo it.\n');
  await waitFor(() => heard.includes('agents') || null, { message: 'an agents event for the second file' });
});

test('a skill created in a project with no .claude/skills folder tells the page', async () => {
  heard.length = 0;
  fs.mkdirSync(path.join(proj, '.claude', 'skills', 'tidy-notes'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude', 'skills', 'tidy-notes', 'SKILL.md'), '---\nname: tidy-notes\ndescription: tidy\n---\nTidy.\n');
  await waitFor(() => heard.includes('skills') || null, { message: 'a skills event' });
});
