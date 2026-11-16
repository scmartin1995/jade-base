// The file ring shows outputs only. The classifier (server/core/outputs.js) must agree with the shared agreed examples, which
// are read from test/fixtures/filing-fixtures.json (a copy of the plan's contract file). Also: corrections, bundle leads,
// the loose flag, Windows paths and the shape of the routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers/server.js';
import { removeDir } from './helpers/rm.js';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-outputs-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const files = await import('../server/core/files.js');
const outputs = await import('../server/core/outputs.js');
config.load(); store.init();
const AUTH = { 'x-jade': process.env.JADE_TOKEN };

const fixtures = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'filing-fixtures.json'), 'utf8'));

test('the fixture file is really loaded', () => {
  assert.ok(fixtures.cases.length >= 35 && fixtures.ruleCases.length >= 5, 'cases: ' + fixtures.cases.length);
  assert.ok(fixtures.overrideCases.length >= 2);
});

test('every agreed example gets its class and flags', () => {
  for (const c of fixtures.cases) {
    const got = outputs.classify(c.path);
    assert.equal(got.class, c.class, `${c.path}: expected ${c.class}, got ${got.class}`);
    for (const f of c.flags || []) assert.ok(got.flags.includes(f), `${c.path}: missing flag ${f}`);
  }
});

test('every agreed correction example', () => {
  for (const c of fixtures.overrideCases) {
    const got = outputs.classify(c.path, { overrides: c.overrides });
    assert.equal(got.class, c.class, c.path);
    for (const f of c.flags || []) assert.ok(got.flags.includes(f), `${c.path}: missing flag ${f}`);
  }
});

test('flags are not set when they should not be', () => {
  assert.deepEqual(outputs.classify('ProjectA/Sessions/260101_Topic/Output/Guide.html').flags, []);
  assert.ok(!outputs.classify('ProjectA/Sessions/S/Output/Deep.docx').flags.includes('loose'));
});

test('no folder name is special until the user sets it: Client Facing and Records are ordinary folders by default', () => {
  config.save({ output: { rules: { bundleDir: '', recordDirs: [], systemNames: outputs.DEFAULT_RULES.systemNames } } });
  assert.ok(!outputs.classify('ProjectA/Client Facing/B/index.html').flags.includes('bundle:lead'));
  assert.equal(outputs.classify('ProjectA/Records/record-topic.md').class, 'working');
  assert.equal(outputs.classify('ProjectA/move-log.csv').class, 'working');
  assert.equal(outputs.classify('soul.md').class, 'working', 'soul.md is not a filing name');
  assert.equal(outputs.classify('ProjectA/_status.md').class, 'working');
  assert.equal(outputs.classify('ProjectA/Archive/old.docx').class, 'archive');
  config.save({ output: { rules: { bundleDir: 'client facing' } } });
});

test('output.rules in the settings add the user\'s own folder names', () => {
  config.save({ output: { rules: fixtures.rules } });
  try {
    for (const c of fixtures.ruleCases) {
      const got = outputs.classify(c.path);
      assert.equal(got.class, c.class, `${c.path}: expected ${c.class}, got ${got.class}`);
      for (const f of c.flags || []) assert.ok(got.flags.includes(f), `${c.path}: missing flag ${f}`);
    }
    assert.ok(outputs.classify('ProjectA/Client Facing/B/sub/index.html').flags.includes('bundle:member'), 'only the top of a bundle leads');
  } finally { config.save({ output: { rules: { bundleDir: 'client facing', recordDirs: [], systemNames: outputs.DEFAULT_RULES.systemNames } } }); }
});

test('windows and upper-case paths classify the same as the plain ones', () => {
  const a = outputs.classify('ProjectA\\Sessions\\S\\Output\\Final.PPTX');
  assert.equal(a.class, 'output');
  assert.equal(outputs.classify('PROJECTA/OUTPUT/Bundle/INDEX.HTML').class, 'output');
});

test('an empty or odd path is just working, never a throw', () => {
  for (const p of ['', '/', undefined, null, '//', '.']) assert.equal(outputs.classify(p).class, 'working');
});

test('a correction wins over every rule, whatever the case or slash', () => {
  const p = 'ProjectA/Sessions/S/Output/Notes.docx';
  assert.equal(outputs.classify(p).class, 'output');
  assert.equal(outputs.classify(p, { overrides: { 'projecta\\sessions\\s\\OUTPUT\\notes.DOCX': 'not-output' } }).class, 'working');
  assert.equal(outputs.classify('ProjectA/.git/x.docx', { overrides: { 'ProjectA/.git/x.docx': 'output' } }).class, 'output');
});

test('corrections are saved, reload from disk, and clear', () => {
  const file = path.join(config.STATE, 'output-overrides.json');
  outputs.setOverride('ProjectA/Sessions/S/Output/Notes.docx', 'not-output');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).items, { 'ProjectA/Sessions/S/Output/Notes.docx': 'not-output' });
  assert.equal(outputs.classify('ProjectA/Sessions/S/Output/Notes.docx', { overrides: outputs.loadOverrides() }).class, 'working');
  outputs.setOverride('ProjectA\\Sessions\\S\\Output\\notes.docx', 'output');          // replaces the same file, not a second entry
  assert.equal(Object.keys(outputs.loadOverrides()).length, 1);
  outputs.setOverride('ProjectA/Sessions/S/Output/Notes.docx', 'clear');
  assert.deepEqual(outputs.loadOverrides(), {});
});

test('bad corrections are refused', () => {
  const bad = [[undefined, 'output'], ['', 'output'], ['  ', 'output'], ['A/b.docx', 'maybe'], ['A/b.docx', undefined], ['../x/b.docx', 'output'], ['A/../../b.docx', 'output'],
    ['A/b\0.docx', 'output'], ['x'.repeat(2000), 'output'], [42, 'output'], ['/nowhere/at/all.docx', 'output']];
  for (const [p, as] of bad) assert.throws(() => outputs.setOverride(p, as), e => e.status === 400, String(p).slice(0, 30) + ' / ' + as);
});

test('a damaged corrections file is read as empty, and wrong values are ignored', () => {
  const file = path.join(config.STATE, 'output-overrides.json');
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(outputs.loadOverrides(), {});
  fs.writeFileSync(file, JSON.stringify({ items: { 'A/b.docx': 'output', 'A/c.docx': 'bogus' } }));
  assert.deepEqual(outputs.loadOverrides(), { 'A/b.docx': 'output' });
  fs.rmSync(file);
});

// ---- the list, from a small vault on disk
const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-outputs-vault-'));
const put = (rel, ms) => { const f = path.join(vault, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); if (ms) fs.utimesSync(f, ms / 1000, ms / 1000); return f; };
const T = Date.now();
put('ProjectA/Sessions/S1/Output/Guide.html', T - 3e3);
put('ProjectA/Sessions/S1/Output/Notes.md', T - 2e3);
put('ProjectA/Sessions/S1/Input/source.xlsx', T - 1e3);
put('ProjectA/Sessions/S1/work/draft.html', T - 1e3);
put('ProjectA/Client Facing/Bundle/index.html', T - 5e3);
put('ProjectA/Client Facing/Bundle/assets/chart.png', T - 5e3);
put('ProjectA/Client Facing/Overview.pptx', T - 9e3);
put('ProjectA/LooseSummary.docx', T - 1e4);
put('ProjectB/Output/Report.pdf', T - 2e4);
put('LooseSlides.pptx', T - 3e4);
config.save({ memory: { folders: [vault] }, output: { rules: { bundleDir: 'client facing' } } });
files.invalidate();

test('the list holds only outputs, newest first, one entry per bundle', () => {
  const list = outputs.listOutputs({ limit: 50 });
  assert.deepEqual(list.map(o => o.name), ['Guide.html', 'index.html', 'Overview.pptx', 'LooseSummary.docx', 'Report.pdf', 'LooseSlides.pptx']);
  const lead = list.find(o => o.name === 'index.html');
  assert.equal(lead.bundle, true);
  assert.equal(lead.bundleFiles, 2);
  assert.equal(lead.title, 'Bundle');
  assert.deepEqual(list.filter(o => o.loose).map(o => o.name), ['LooseSummary.docx', 'LooseSlides.pptx']);
  assert.ok(list.every(o => !Number.isNaN(Date.parse(o.modified))));
});

test('limit is honoured and nonsense limits fall back', () => {
  assert.equal(outputs.listOutputs({ limit: 2 }).length, 2);
  assert.equal(outputs.listOutputs({ limit: 'abc' }).length, 6);
  assert.equal(outputs.listOutputs({ limit: -5 }).length, 6);
});

test('a correction changes the list; an absolute path works too', () => {
  const abs = path.join(vault, 'ProjectA', 'Sessions', 'S1', 'work', 'draft.html');
  outputs.setOverride(abs, 'output');
  assert.ok(outputs.listOutputs({ limit: 50 }).some(o => o.name === 'draft.html'));
  assert.deepEqual(Object.keys(outputs.loadOverrides()), ['ProjectA/Sessions/S1/work/draft.html']);
  outputs.setOverride('LooseSlides.pptx', 'not-output');
  assert.ok(!outputs.listOutputs({ limit: 50 }).some(o => o.name === 'LooseSlides.pptx'));
  outputs.setOverride(abs, 'clear'); outputs.setOverride('LooseSlides.pptx', 'clear');
  assert.equal(outputs.listOutputs({ limit: 50 }).length, 6);
});

// ---- the routes, over HTTP on a throwaway port
test('routes: shape, the X-Jade header on writes, and bad input', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-outputs-srv-'));
  const claudeHome = path.join(home, 'claude');
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ memory: { folders: [vault] }, output: { rules: { bundleDir: 'client facing' } } }));
  const child = await startServer({ home, claudeHome, bin: path.join(home, 'bin'), token: process.env.JADE_TOKEN });   // a free port, a stand-in claude, and it is up when this returns
  try {
    const base = child.base;
    const j = await (await fetch(base + '/api/outputs', { headers: AUTH })).json();
    assert.deepEqual(Object.keys(j), ['outputs']);
    assert.deepEqual(Object.keys(j.outputs[0]).sort(), ['area', 'bundle', 'kind', 'loose', 'modified', 'name', 'path', 'project', 'title']);
    assert.equal(j.outputs.length, 6);
    assert.equal((await (await fetch(base + '/api/outputs?limit=1', { headers: AUTH })).json()).outputs.length, 1);
    const post = (body, h = { 'X-Jade': '1' }) => fetch(base + '/api/outputs/override', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
    assert.equal((await post({ path: 'LooseSlides.pptx', as: 'not-output' }, {})).status, 403, 'no header, no write');
    assert.equal((await post({ path: 'LooseSlides.pptx', as: 'sideways' })).status, 400);
    assert.equal((await post({ path: '../x', as: 'output' })).status, 400);
    const ok = await post({ path: 'LooseSlides.pptx', as: 'not-output' });
    assert.deepEqual(await ok.json(), { ok: true, path: 'LooseSlides.pptx', as: 'not-output' });
    assert.equal((await (await fetch(base + '/api/outputs', { headers: AUTH })).json()).outputs.length, 5);
    const ring = await (await fetch(base + '/api/outputs/ring', { headers: AUTH })).json();
    assert.equal(ring.outputs.length, 5); assert.equal(ring.total, 5, 'the ring answer carries the total');
    assert.deepEqual(Object.keys(ring.outputs[0]).sort(), ['area', 'bundle', 'bundleFiles', 'file', 'group', 'loose', 'mtime', 'overridden', 'project', 'title']);
    await child.stop();
    // a restart keeps the correction
    const again = await startServer({ home, claudeHome, bin: path.join(home, 'bin'), token: process.env.JADE_TOKEN });
    try {
      assert.equal((await (await fetch(again.base + '/api/outputs', { headers: AUTH })).json()).outputs.length, 5, 'correction survived the restart');
    } finally { await again.stop(); }
  } finally { await child.stop(); removeDir(home); }
});

test('loose needs at most two path segments; three is working', () => {
  assert.deepEqual(outputs.classify('ProjectA/Misc/Deep.docx'), { class: 'working', flags: [] });
  assert.deepEqual(outputs.classify('ProjectA/Misc.pdf'), { class: 'output', flags: ['loose'] });
  assert.equal(outputs.classify('ProjectA/Notes.md').class, 'working', 'a loose markdown file is not a finished document type');
});
