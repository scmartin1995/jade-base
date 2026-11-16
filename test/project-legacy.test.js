// A project file written by an older Jade (with the fixed status fields) still loads, and a new project has only the plain fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-legacy-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
config.load(); store.init();

test('an old project file with status, milestones and risks loads and saves', () => {
  fs.writeFileSync(path.join(store.dirs.projects, 'old.json'), JSON.stringify({ id: 'old', name: 'Old', description: 'd', status: { health: 'red', percent: 40 }, milestones: [{ name: 'x' }], risks: [], statusHistory: [], phase: 'Delivery' }));
  const p = store.getProject('old');
  assert.equal(p.name, 'Old');
  assert.equal(store.listProjects().some(x => x.id === 'old'), true);
  assert.doesNotThrow(() => store.patchProject('old', { owner: 'me' }));
});

test('a new project is the plain record', () => {
  const p = store.saveProject({ name: 'Fresh' });
  assert.deepEqual(Object.keys(p).sort(), ['createdAt', 'description', 'folders', 'id', 'links', 'name', 'owner', 'tags', 'updatedAt']);
});
