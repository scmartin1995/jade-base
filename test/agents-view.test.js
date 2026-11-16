// The Agents page: cards grouped by origin with the install banner, and one agent's page; Run only for agents Jade can run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-agents-view-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const agents = await import('../server/core/agents.js');
const agentfiles = await import('../server/core/agentfiles.js');
const view = (await import('../public/js/views/agents.js')).default;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
fs.mkdirSync(path.join(tmp, 'claude', 'agents'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'claude', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews code.\ntools: Read\n---\nReview it.\n');

async function page(params = []) {
  const list = agents.list().map(({ body, ...a }) => ({ ...a, prompt: body }));
  const answers = { '/api/agents': list, '/api/schedule': [], '/api/projects': [], '/api/agents/install': agentfiles.installStatus() };
  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const ui = { esc, icon: () => '', ago: () => '', projectOptions: () => '' };
  const api = async (_m, url) => { if (url in answers) return answers[url]; if (/\/detail$/.test(url)) { const a = agents.get(decodeURIComponent(url.split('/')[3])); return { owned: [], editable: a.origin !== 'plugin' }; } throw new Error('no ' + url); };
  await view.render(root, { params, api, ui, state: { jobs: [], streams: new Map() }, runAgent: async () => ({}) });
  return root.innerHTML;
}
const card = (html, name) => html.split('<article').find(c => c.includes(`<h3 class="grow">${name}</h3>`)) || '';

test('groups by origin, marks built-ins, shows the install banner, and offers Run only where Jade can run it', async () => {
  const html = await page();
  assert.match(html, /Yours \(Claude Code/); assert.match(html, /built-in agents/);
  assert.match(html, /Not installed/); assert.match(html, /data-install/);
  assert.ok(card(html, 'Skeptic').includes('<span class="badge">Jade</span>'));
  assert.ok(card(html, 'Action Extractor').includes('data-run="note-actions"'), 'a Jade agent with a handler can run');
  assert.ok(!card(html, 'reviewer').includes('data-run'), 'a plain Claude Code agent cannot');
  assert.ok(card(html, 'reviewer').includes('To read only'));
});

test('one agent\'s page shows prompt, tools, model and, for a checked agent, Skeptic\'s numbers', async () => {
  const html = await page(['reviewer']);
  assert.match(html, /Review it/); assert.match(html, /<span class="chip">Read<\/span>/); assert.match(html, /Not chosen/); assert.match(html, /data-edit/);
  assert.ok(!html.includes('data-run="reviewer"'));
  assert.match(await page(['skeptic']), /Tools/);
});
