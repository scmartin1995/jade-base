// A run records the model that really answered, so its cost can be checked afterwards: for a dashboard build (a loop job) and a
// one-shot agent run through the stand-in `claude`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { removeDir } from './helpers/rm.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-jobmodel-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const { installFakeClaude } = await import('./helpers/fake-claude.js');
const claude = installFakeClaude(path.join(tmp, 'bin'));
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const jobs = await import('../server/core/jobs.js');
const judge = await import('../server/core/judge.js');
const modules = await import('../server/core/modules.js');
const agents = await import('../server/core/agents.js');
const { bus } = await import('../server/core/bus.js');
const warm = await import('../server/core/warm.js');
config.load(); store.init();
await modules.init({ jobs, agents, store, bus });
after(() => { warm.shutdown(); removeDir(tmp); });

async function finished(j) {
  for (let i = 0; i < 100; i++) { const cur = jobs.get(j.id); if (['done', 'error'].includes(cur?.status)) return cur; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('the run did not finish');
}

test('a dashboard build records the model Claude Code reported, not the one asked for', async () => {
  const P = store.saveProject({ name: 'Cost', description: '', folders: [] });
  const dashboards = await import('../server/core/dashboards.js');
  const d = dashboards.create(P.id, { name: 'D' });
  judge.use(() => ({ data: { title: 'T', sections: [{ layout: 'text', title: 'x', note: 'hello' }] }, model: 'reported-model' }));
  const j = await finished(jobs.enqueue({ agent: 'dashboard-builder', input: { project: P.id, dashboard: d.id }, title: 'Build' }));
  assert.equal(j.status, 'done', j.error);
  assert.equal(j.model, 'reported-model');
  assert.equal(j.result.model, 'reported-model');
  // and a change to it
  const c = await finished(jobs.enqueue({ agent: 'dashboard-builder', input: { project: P.id, dashboard: d.id, change: 'shorter' }, title: 'Change' }));
  assert.equal(c.model, 'reported-model');
});

test('a one-shot agent run still records its model, and a loop that reports none leaves it as it was', async () => {
  config.save({ agents: { model: 'asked-model' } });
  const j = await finished(jobs.enqueue({ agent: 'note-actions', input: { text: 'Dana will send the budget on Friday.' } }));
  assert.equal(j.status, 'done', j.error);
  assert.equal(j.model, 'asked-model');
  assert.ok(claude.calls().length > 0);
});
