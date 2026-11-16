// The Agents page: a verifier's card (Skeptic) lists the skills it checks builds against, and the builder's card still does too.
// Renders the page's own code into a stand-in root, with the API answers stubbed, so no browser is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-agents-page-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const agents = await import('../server/core/agents.js');
const view = (await import('../public/js/views/agents.js')).default;
const { esc } = await import('../public/js/ui.js').catch(() => ({ esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }));

async function page() {
  const list = agents.list().map(({ body, ...a }) => ({ ...a, prompt: body }));
  const answers = { '/api/agents': list, '/api/schedule': [], '/api/projects': [] };
  const root = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
  const ui = { esc, icon: () => '', ago: () => '', fmtDate: () => '', projectOptions: () => '' };
  const ctx = { params: [], api: async (_m, url) => { if (url in answers) return answers[url]; throw new Error('no ' + url); }, ui, state: { jobs: [], streams: new Map() }, runAgent: async () => ({}) };
  await view.render(root, ctx);
  return root.innerHTML;
}
const card = (html, name) => html.split('<article').find(c => c.includes(`<h3 class="grow">${name}</h3>`)) || '';

test("Skeptic's card lists the skills its agent file names, and names none this app does not ship", async () => {
  const skeptic = agents.get('skeptic');
  assert.deepEqual(skeptic.skills, []);
  const c = card(await page(), 'Skeptic');
  assert.ok(c, 'Skeptic has a card');
  assert.ok(!c.includes('Builds are checked against these skills'), 'no skills, no line');
});

test('the Worker still shows its chips, without the verifier line', async () => {
  const html = await page();
  assert.ok(card(html, 'Worker').includes('Worker'));
  assert.ok(!card(html, 'Worker').includes('Builds are checked against'), 'only verifiers get the line');
});
