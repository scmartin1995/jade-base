// Guiding lights for project dashboards: which HTML files count, in what order, where a dashboard goes, what the agent sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-dash-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const files = await import('../server/core/files.js');
const dashboards = await import('../server/core/dashboards.js');
config.load();
const HOME = config.JADE_HOME;
const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-vault-'));
const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-helios-'));
fs.mkdirSync(path.join(HOME, 'projects'), { recursive: true });
fs.mkdirSync(path.join(HOME, 'deliverables'), { recursive: true });
fs.writeFileSync(path.join(vault, 'Q3 portfolio DASHBOARD.html'), '<html><head><style>:root{--accent:#2dd5b7} body{font-family: Inter, sans-serif}</style></head><body><h1>Q3</h1><table><tr><td>x</td></tr></table><script>alert(1)</script></body></html>');
fs.writeFileSync(path.join(vault, 'notes.html'), '<html><body>not a dashboard</body></html>');
fs.writeFileSync(path.join(projDir, 'helios-dashboard-v2.html'), '<html><head><style>body{font-family: Georgia}</style></head><body><div class="card">Helios</div></body></html>');
fs.writeFileSync(path.join(vault, 'dashboard-template.htm'), '<html><body>old</body></html>');
const old = Date.now() / 1000 - 400 * 86400; fs.utimesSync(path.join(vault, 'dashboard-template.htm'), old, old);
config.save({ memory: { folders: [HOME, vault] } });
const p = store.saveProject({ name: 'Helios Warehouse Move', folders: [projDir] });
files.scan(true);

test('only html files named dashboard count; the project\'s own folder comes first, then newest', () => {
  const list = dashboards.exemplars(p.id);
  assert.deepEqual(list.map(e => e.name), ['helios-dashboard-v2.html', 'Q3 portfolio DASHBOARD.html', 'dashboard-template.htm']);
  assert.equal(list[0].ownProject, true);
  assert.equal(list[1].ownProject, false);
  assert.ok(!list.some(e => e.name === 'notes.html'));
});

test('excerpt is an outline of the information shown, not the styling', () => {
  fs.writeFileSync(path.join(vault, 'exec dashboard.html'), `<html><head><title>Exec dashboard</title><style>.x{color:red}</style></head><body>
    <h1>Portfolio</h1><div class="card"><div class="label">Budget spent</div><div class="big">62%</div></div><div class="card"><div class="label">Days to go</div><div class="big">41 days</div></div>
    <h2>Milestones</h2><table><tr><th>Milestone</th><th>Date</th><th>Status</th></tr><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr></table>
    <h2>Risks</h2><table><tr><th>Risk</th><th>Owner</th><th>Mitigation</th></tr><tr><td>x</td><td>y</td><td>z</td></tr></table><script>alert(1)</script></body></html>`);
  const x = dashboards.excerpt(path.join(vault, 'exec dashboard.html'));
  assert.match(x, /TITLE: Exec dashboard/);
  assert.match(x, /# Portfolio/); assert.match(x, /## Milestones/); assert.match(x, /## Risks/);
  assert.match(x, /label: Budget spent/); assert.match(x, /label: Days to go/);
  assert.match(x, /column: Milestone/); assert.match(x, /column: Mitigation/);
  assert.match(x, /table 1 with 2 rows, table 2 with 1 rows/);
  assert.match(x, /62%/); assert.match(x, /41 days/);
  assert.ok(!x.includes('color:red'), 'no styling'); assert.ok(!x.includes('alert(1)'));
});

test('the questionnaire does not offer Jade\'s own records inside the project as files that hold the facts', () => {
  const put = (rel, t = 'x') => { const f = path.join(projDir, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
  put('Jade/Meetings/transcripts/notes.txt', 'Ann: hello'); put('Jade/Meetings/2026-11-10 Weekly.md', '## Key points'); put('Jade/actions.json', '[]');
  put('Jade/Dashboards/d.html', '<html></html>'); put('budget.xlsx', 'x'); put('plan.docx', 'x');
  files.invalidate();
  const offered = dashboards.questionOptions(p.id).files.map(f => f.label);
  assert.ok(offered.includes('budget.xlsx') && offered.includes('plan.docx'), 'the project\'s own documents are offered');
  for (const gone of ['notes.txt', '2026-11-10 Weekly.md', 'actions.json', 'd.html']) assert.ok(!offered.includes(gone), gone + ' is Jade\'s own record');
});
