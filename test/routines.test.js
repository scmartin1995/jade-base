// The Routines page's server side: a skill's schedule set there wins over its file's, the switch still decides whether it runs,
// Jade's upkeep intervals are settings rather than fixed numbers, and the page is in the navigation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-routines-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const skills = await import('../server/core/skills.js');
const scheduler = await import('../server/core/scheduler.js');
const modules = await import('../server/core/modules.js');

const dir = path.join(store.dirs.skills, 'weekly-recap');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: weekly-recap\ndescription: Recap the week\nautomation: fri 15:00\n---\nDo the recap.\n');
const recap = () => skills.list().find(s => s.name === 'weekly-recap');

test('a skill runs on its file\'s schedule only once switched on, and a schedule set on Routines wins', () => {
  assert.equal(recap().automation, 'fri 15:00'); assert.equal(recap().automationOn, false);
  skills.setPrefs('weekly-recap', { automation: true });
  assert.equal(recap().automationOn, true);
  skills.setPrefs('weekly-recap', { schedule: 'mon 09:00' });
  assert.equal(recap().automation, 'mon 09:00'); assert.equal(recap().suggested, 'fri 15:00');
  assert.ok(scheduler.tasks().some(t => t.key === 'skill:weekly-recap' && t.schedule === 'mon 09:00'));
  skills.setPrefs('weekly-recap', { automation: false });
  assert.ok(!scheduler.tasks().some(t => t.key === 'skill:weekly-recap'), 'off means it does not run');
});

test('Jade\'s upkeep intervals come from settings, never below five minutes', () => {
  const memory = () => scheduler.tasks().find(t => t.key === 'memory').schedule;
  assert.equal(memory(), 'every 15m');
  config.save({ memory: { reindexMinutes: 60 } });
  assert.equal(memory(), 'every 60m');
  config.save({ memory: { reindexMinutes: 1 } });
  assert.equal(memory(), 'every 5m');
});

test('Routines is a page in the navigation, off until the user turns it on; Agents is named for what it holds', () => {
  const r = modules.list().find(m => m.id === 'routines');
  assert.equal(r.defaultOff, true); assert.equal(r.enabled, false); assert.equal(r.nav[0].route, 'routines');
  assert.equal(modules.list().find(m => m.id === 'agents').name, 'Agents');
});
