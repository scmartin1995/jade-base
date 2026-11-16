// Dreams end to end with no real model: a stand-in `claude` on PATH writes down every run (argv, system prompt, prompt) and answers
// with the JSON in reply.json. Covers the context (two labelled sources), the ideas held to structure, repeats, web off and on (what
// the run was and was not given), accepting (a file is made only after the confirm, and only in the temp Claude home), and the
// module being off (no routes, no nav, no schedule).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-dreams-'));
const bin = path.join(tmp, 'bin'), dump = path.join(tmp, 'runs.jsonl'), replyFile = path.join(tmp, 'reply.json');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
if (a[0] !== '-p') { if (a[0] === 'auth') process.stdout.write('{}'); process.exit(0); }
let prompt = '';
process.stdin.on('data', c => { prompt += c; });
process.stdin.on('end', () => {
  const sf = a.includes('--append-system-prompt-file') ? a[a.indexOf('--append-system-prompt-file') + 1] : '';
  let system = ''; try { system = fs.readFileSync(sf, 'utf8'); } catch {}
  fs.appendFileSync(${JSON.stringify(dump)}, JSON.stringify({ argv: a, system, prompt }) + '\\n');
  console.log(JSON.stringify({ type: 'result', result: fs.readFileSync(${JSON.stringify(replyFile)}, 'utf8'), is_error: false }));
});
`, { mode: 0o755 });
process.env.PATH = bin + path.delimiter + process.env.PATH;
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const jobs = await import('../server/core/jobs.js');
const agents = await import('../server/core/agents.js');
const modules = await import('../server/core/modules.js');
const router = await import('../server/core/router.js');
const scheduler = await import('../server/core/scheduler.js');
const warm = await import('../server/core/warm.js');
const dreams = await import('../server/core/dreams.js');
const { bus } = await import('../server/core/bus.js');
config.load(); store.init();
after(async () => {
  warm.shutdown();
  for (const p of store.listProjects()) store.patchProject(p.id, { folders: [] });   // so the folder watchers close before the folders go
  store.syncWatches();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });   // retries cover a watcher still closing
});

const CH = process.env.JADE_CLAUDE_HOME;
const folder = path.join(tmp, 'work', 'helios');
fs.mkdirSync(folder, { recursive: true });
const project = store.saveProject({ name: 'Helios', folders: [folder] }).id;
const outside = path.join(tmp, 'work', 'garden');

// a Claude Code session in the project's folder and one outside it (invented words)
const sess = (cwd, text) => {
  const dir = path.join(CH, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-')); fs.mkdirSync(dir, { recursive: true });
  const t = new Date(Date.now() - 864e5).toISOString();
  const line = (type, message, extra = {}) => JSON.stringify({ type, cwd, sessionId: 's', timestamp: t, isSidechain: false, entrypoint: 'cli', message, ...extra });
  fs.writeFileSync(path.join(dir, 's.jsonl'), [line('user', { role: 'user', content: text }), line('assistant', { role: 'assistant', content: [{ type: 'text', text: 'Reply about ' + text }, { type: 'thinking', thinking: 'HIDDEN-THOUGHT' }] }),
    line('assistant', { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Write', input: { file_path: path.join(cwd, 'out.md'), content: 'HIDDEN-CONTENT' } }] })].join('\n') + '\n');
};
sess(folder, 'Tidy the Helios risk register');
sess(outside, 'Water the tomatoes');
// Jade's own week
const t = store.newThread('Weekly summary');
store.appendTurn(t.id, { role: 'user', text: 'Write the weekly summary for Helios' });
store.appendTurn(t.id, { role: 'jade', text: 'Here is the summary.', touched: [{ path: '/x/summary.md', isNew: true }] });
store.saveNote({ title: 'Helios kickoff notes', body: 'x', project });
store.addAction({ text: 'Send the budget', project }); store.updateAction(store.listActions()[0].id, { status: 'done' });

await modules.init({ jobs, agents, store, bus });
modules.set('dreams', true);

const runs = () => (fs.existsSync(dump) ? fs.readFileSync(dump, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const reply = o => fs.writeFileSync(replyFile, '```json\n' + JSON.stringify(o) + '\n```');
const call = async (method, p, body = {}) => { const h = router.match(method, p, false); assert.ok(h, `${method} ${p} has a route`); return h.fn({ p: h.p, q: new URLSearchParams(), body }); };
const run = async () => { const before = runs().length; const j = await jobs.enqueueAndWait({ agent: 'dreams', input: {}, trigger: 'manual' }); assert.equal(j.status, 'done', j.error); return runs().slice(before)[0]; };
const night = () => store.state('dreams', { nights: [] }).nights[0];

const agentIdea = { kind: 'agent', title: 'Weekly summary writer', detail: 'Writes the weekly summary', suggestion: 'Try it on Friday', evidence: 'asked for the weekly summary on the 10th and again on the 12th', project,
  draft: { name: 'weekly-summary-writer', description: 'Writes the weekly summary for a project', tools: 'Read, Grep, Bash', prompt: 'Read the notes and write a short weekly summary. Never change a file.' } };
const skillIdea = { kind: 'skill', title: 'Risk register tidy-up', detail: 'Same steps each time', suggestion: 'Save it', evidence: 'tidied the register on the 12th, as on the 5th', draft: { name: 'tidy-risk-register', description: 'When the risk register needs tidying', body: '1. Open the register.\n2. Merge duplicates.', automation: 'weekdays 16:30' } };
const docIdea = { kind: 'doc', title: 'How the weekly summary is made', detail: 'Never written down', suggestion: 'Write it', evidence: 'done by hand on the 10th', project, draft: { title: 'Weekly summary: how it is made', body: '## Steps\n- to fill in' } };
const memIdea = { kind: 'memory', title: 'Summary goes out on Fridays', detail: 'x', suggestion: 'x', evidence: 'said on the 12th', draft: { fact: 'The weekly summary goes out on Fridays.' } };
const frontier = { kind: 'frontier', title: 'A new checking method', detail: 'x', suggestion: 'x', sources: ['https://example.com/method', 'not a link'] };

test('the agent file is a Claude Code agent with the Dreams conventions, and the module is off until switched on', () => {
  const d = agents.get('dreams');
  assert.equal(d.origin, 'built-in'); assert.equal(d.handler, 'dreams'); assert.equal(d.module, 'dreams');
  assert.match(fs.readFileSync(path.join(import.meta.dirname, '..', 'agents', 'dreams.md'), 'utf8'), /^name: jade-dreams$/m);
  assert.equal(d.schedule, 'daily 02:30');
  assert.deepEqual(d.context, ['profile', 'facts', 'projects', 'skills-list', 'agents', 'work-week', 'dream-history', 'looking-outward']);
  assert.ok(d.skills.length === 0);
  assert.equal(modules.list().find(m => m.id === 'dreams').defaultOff, true);
});

test('the work-week context has Jade\'s week and Claude Code\'s, each labelled; Claude Code shows typed words, replies and file paths only', async () => {
  const prep = await agents.prepare(agents.get('dreams'), {});
  const p = prep.prompt;
  assert.match(p, /## work-week\n## Source 1: Jade \(this app\)/);
  assert.match(p, /User: Write the weekly summary for Helios/);
  assert.match(p, /files: new summary\.md/);
  assert.match(p, /note: Helios kickoff notes/);
  assert.match(p, /done: Send the budget/);
  assert.match(p, /## Source 2: Claude Code on this computer/);
  assert.match(p, /You: Tidy the Helios risk register/);
  assert.match(p, /Claude: Reply about Tidy the Helios risk register/);
  assert.match(p, /files touched: out\.md/);
  assert.doesNotMatch(p, /HIDDEN-THOUGHT|HIDDEN-CONTENT/);
  assert.doesNotMatch(p, /Water the tomatoes/, 'the default scope is the Jade projects\' folders');
  assert.match(p, /## dream-history\n\(no earlier ideas\)/);
});

test('dreams.claude: "all" adds the other folders, "off" says it is not read', async () => {
  config.save({ dreams: { claude: 'all' } });
  assert.match((await agents.prepare(agents.get('dreams'), {})).prompt, /Water the tomatoes/);
  config.save({ dreams: { claude: 'off' } });
  const p = (await agents.prepare(agents.get('dreams'), {})).prompt;
  assert.match(p, /Source 2: Claude Code on this computer: switched off/);
  assert.doesNotMatch(p, /Tidy the Helios risk register/);
  assert.match(p, /Source 1: Jade/);
  config.save({ dreams: { claude: 'projects' } });
});

test('a run through the job path keeps only ideas that meet their kind\'s rules; web off sends no web tools and no outward section', async () => {
  config.save({ dreams: { web: false } });
  reply({ summary: 'A week of summaries.', ideas: [agentIdea, skillIdea, docIdea, memIdea, frontier,
    { ...agentIdea, title: 'No evidence agent', evidence: '' },
    { ...agentIdea, title: 'No draft agent', draft: { name: 'x' } },
    { kind: 'worth-doing', title: 'An old kind', evidence: 'the 10th' }, { kind: 'agent' }, null, 'text'] });
  const r = await run();
  const allowed = r.argv[r.argv.indexOf('--allowedTools') + 1];
  assert.doesNotMatch(allowed, /WebSearch|WebFetch/);
  assert.doesNotMatch(r.prompt, /## looking-outward|general terms about the kind of work|This section is given only when/);
  assert.doesNotMatch(r.system, /Never put the person's name/);
  assert.match(r.system, /\*\*agent\*\*: a new agent worth building/);
  const n = night();
  assert.deepEqual(n.ideas.map(i => i.kind), ['agent', 'skill', 'doc', 'memory'], 'outward kinds are closed with the web off, and weak ideas are dropped');
  assert.equal(n.summary, 'A week of summaries.');
  assert.ok(n.ideas.every(i => i.status === 'new' && i.id.startsWith(n.date)));
  assert.equal(n.ideas[0].project, project);
  assert.equal(n.read.web, false);
});

test('web on: the run gets the web tools and the outward section; outward kinds need a real address and keep only real ones', async () => {
  config.save({ dreams: { web: true } });
  reply({ summary: 'Again.', ideas: [frontier, { kind: 'tool', title: 'No address', detail: 'x', sources: ['ftp://nope'] }, { ...frontier, kind: 'tool', title: 'A tool' }] });
  const r = await run();
  assert.match(r.argv[r.argv.indexOf('--allowedTools') + 1], /WebSearch,WebFetch/);
  assert.match(r.prompt, /## looking-outward\nThis section is given only when/);
  assert.match(r.prompt, /Never put the person's name, their company/);
  const n = night();
  assert.deepEqual(n.ideas.map(i => i.title), ['A new checking method', 'A tool']);
  assert.deepEqual(n.ideas[0].sources, ['https://example.com/method']);
  config.save({ dreams: { web: false } });
});

test('an idea already made in the last month is not made again; one made on the same day can be remade', async () => {
  store.setState('dreams', { nights: [{ date: '2026-01-05', summary: '', ideas: [{ id: 'o', kind: 'agent', title: 'Weekly summary writer.', status: 'dismissed' }] }] });
  reply({ summary: 'x', ideas: [agentIdea, { ...skillIdea, title: 'Risk register tidy-up' }, { ...skillIdea, title: 'Risk register tidy up' }] });
  await run();
  assert.deepEqual(night().ideas.map(i => i.title), ['Risk register tidy-up']);
  assert.match((await agents.prepare(agents.get('dreams'), {})).prompt, /\[agent\] Weekly summary writer\.: dismissed/);
});

test('agents.model reaches the run, and jade-effort / agents.effort apply as for the other built-ins', async () => {
  config.save({ agents: { model: 'stand-in-model', effort: 'low' } });
  reply({ summary: 'x', ideas: [] });
  let r = await run();
  assert.equal(r.argv[r.argv.indexOf('--model') + 1], 'stand-in-model');
  assert.equal(r.argv[r.argv.indexOf('--effort') + 1], 'low');
  assert.equal(night().ideas.length, 0, 'an empty night is fine');
  config.save({ agents: { model: '', effort: '' } });
  r = await run();
  assert.ok(!r.argv.includes('--effort'));
});

// ---- accepting
const fresh = async ideas => { reply({ summary: 's', ideas }); await run(); return night(); };
const ids = n => Object.fromEntries(n.ideas.map(i => [i.kind, i.id]));
const files = dir => { const out = []; const walk = d => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) e.isDirectory() ? walk(path.join(d, e.name)) : out.push(path.join(d, e.name)); }; walk(dir); return out; };

test('accepting an agent idea: the page can read the whole file first; nothing is made without that exact text confirmed', async () => {
  store.setState('dreams', { nights: [] });
  const n = await fresh([{ ...agentIdea, title: 'Accept agent one' }, { ...skillIdea, title: 'Accept skill one' }, { ...docIdea, title: 'Accept doc one' }, { ...memIdea, title: 'Accept memory one' }]);
  const id = ids(n);
  const before = files(CH).filter(f => !f.includes(path.sep + 'projects' + path.sep));
  const p = await call('GET', `/api/dreams/${n.date}/idea/${id.agent}/preview`);
  assert.match(p.text, /^---\nname: weekly-summary-writer\n/);
  assert.match(p.text, /tools: "Read, Grep"\n/, 'a tool that edits or runs commands is not given');
  assert.match(p.text, /Read the notes and write a short weekly summary\./);
  assert.equal(p.where, path.join(CH, 'agents', 'weekly-summary-writer.md'));
  await assert.rejects(() => call('POST', `/api/dreams/${n.date}/idea/${id.agent}/accept`, {}), /needs your yes/);
  await assert.rejects(() => call('POST', `/api/dreams/${n.date}/idea/${id.agent}/accept`, { token: 'made-up' }), /needs your yes/);
  assert.deepEqual(files(CH).filter(f => !f.includes(path.sep + 'projects' + path.sep)), before, 'nothing was written');
  await call('POST', `/api/dreams/${n.date}/idea/${id.agent}/accept`, { token: p.token });
  assert.equal(fs.readFileSync(p.where, 'utf8'), p.text, 'the file is exactly the text that was shown');
  const a = agents.get('weekly-summary-writer');
  assert.equal(a.origin, 'yours'); assert.equal(a.runnable, true);
  assert.equal(night().ideas.find(i => i.kind === 'agent').status, 'accepted');
  await assert.rejects(() => call('POST', `/api/dreams/${n.date}/idea/${id.agent}/accept`, { token: p.token }), /already been answered/);
});

test('accepting a skill idea makes it in Claude Code\'s skills folder, listed as yours', async () => {
  const n = night(), id = ids(n);
  const p = await call('GET', `/api/dreams/${n.date}/idea/${id.skill}/preview`);
  const claudeCopy = path.join(CH, 'skills', 'tidy-risk-register', 'SKILL.md');
  assert.ok(p.where.startsWith(claudeCopy) && /also saved in Jade/.test(p.where));
  assert.equal(p.files.length, 2, 'every file that will be written is listed');
  assert.ok(p.files.some(f => f.path === claudeCopy));
  p.where = claudeCopy;
  assert.match(p.text, /name: tidy-risk-register/); assert.match(p.text, /2\. Merge duplicates\./);
  assert.ok(!fs.existsSync(p.where));
  await assert.rejects(() => call('POST', `/api/dreams/${n.date}/idea/${id.skill}/accept`, { token: 'no' }), /needs your yes/);
  assert.ok(!fs.existsSync(p.where));
  await call('POST', `/api/dreams/${n.date}/idea/${id.skill}/accept`, { token: p.token });
  assert.ok(fs.existsSync(p.where));
  const s = (await import('../server/core/skills.js')).get('tidy-risk-register');
  assert.equal(s.origin, 'yours');
});

test('accepting a doc idea saves a note in the project\'s Jade/Notes; a memory idea goes through memory', async () => {
  const n = night(), id = ids(n);
  const pd = await call('GET', `/api/dreams/${n.date}/idea/${id.doc}/preview`);
  assert.match(pd.where, /Helios/);
  assert.equal(store.listNotes().filter(x => x.title === 'Weekly summary: how it is made').length, 0);
  await assert.rejects(() => call('POST', `/api/dreams/${n.date}/idea/${id.doc}/accept`, {}), /needs your yes/);
  assert.equal(store.listNotes().filter(x => x.title === 'Weekly summary: how it is made').length, 0);
  await call('POST', `/api/dreams/${n.date}/idea/${id.doc}/accept`, { token: pd.token });
  const note = store.listNotes().find(x => x.title === 'Weekly summary: how it is made');
  assert.equal(note.project, project);
  assert.ok(files(path.join(folder, 'Jade', 'Notes')).length >= 1);
  const pm = await call('GET', `/api/dreams/${n.date}/idea/${id.memory}/preview`);
  assert.equal(pm.text, 'The weekly summary goes out on Fridays.');
  await assert.rejects(() => call('POST', `/api/dreams/${n.date}/idea/${id.memory}/accept`, {}), /needs your yes/);
  assert.ok(!store.readFacts().includes(pm.text));
  await call('POST', `/api/dreams/${n.date}/idea/${id.memory}/accept`, { token: pm.token });
  assert.ok(store.readFacts().includes(pm.text));
});

test('an idea can be dismissed, and a draft that cannot be made as it is says why instead of making it', async () => {
  const n = await fresh([{ ...agentIdea, title: 'Collides', draft: { ...agentIdea.draft, name: 'weekly-summary-writer' } }, { ...agentIdea, title: 'Bad name', draft: { ...agentIdea.draft, name: 'jade-thing' } }, { ...docIdea, title: 'To dismiss' }]);
  const [a, b, c] = n.ideas;
  assert.match((await call('GET', `/api/dreams/${n.date}/idea/${a.id}/preview`)).problem, /already an agent called/);
  assert.match((await call('GET', `/api/dreams/${n.date}/idea/${b.id}/preview`)).problem, /must be short lower-case words/);
  await assert.rejects(() => call('POST', `/api/dreams/${n.date}/idea/${a.id}/accept`, { token: 'x' }), /already an agent/);
  await call('POST', `/api/dreams/${n.date}/idea/${c.id}/dismiss`);
  assert.equal(night().ideas.find(i => i.id === c.id).status, 'dismissed');
  assert.equal(store.listNotes().filter(x => x.title === 'To dismiss').length, 0);
  assert.equal(files(path.join(CH, 'agents')).filter(f => /jade-thing/.test(f)).length, 0);
  await assert.rejects(() => call('GET', '/api/dreams/2000-01-01/idea/none/preview'), /not there any more/);
});

test('a frontier or tool idea, when accepted, becomes an action', async () => {
  config.save({ dreams: { web: true } });
  const n = await fresh([{ ...frontier, title: 'Frontier to act on', suggestion: 'Try the new method on one report', project }]);
  const i = n.ideas[0];
  const p = await call('GET', `/api/dreams/${n.date}/idea/${i.id}/preview`);
  assert.equal(p.text, 'Try the new method on one report');
  await call('POST', `/api/dreams/${n.date}/idea/${i.id}/accept`, { token: p.token });
  assert.ok(store.listActions().some(a => a.text === 'Try the new method on one report' && a.project === project && a.source === 'dreams'));
  config.save({ dreams: { web: false } });
});

// ---- the module off, the schedule
test('Run now works with the module on and Routines off; the page data is served', async () => {
  assert.equal(modules.enabled('routines'), false);
  const j = await call('POST', '/api/dreams/run');
  assert.equal(j.agent, 'dreams');
  await jobs.enqueueAndWait({ agent: 'dreams', input: {} });
  const d = await call('GET', '/api/dreams');
  assert.equal(d.scheduleOn, false); assert.equal(d.settings.claude, 'projects'); assert.deepEqual(d.kinds.map(k => k.id), ['agent', 'skill', 'doc', 'memory']);
});

test('the nightly schedule runs only with Dreams on AND Routines on', () => {
  const has = () => scheduler.tasks().some(t => t.key === 'agent:dreams');
  modules.set('routines', true); modules.set('dreams', true);
  assert.equal(has(), true);
  assert.equal(scheduler.tasks().find(t => t.key === 'agent:dreams').schedule, 'daily 02:30');
  modules.set('routines', false);
  assert.equal(has(), false, 'Dreams on, Routines off');
  modules.set('routines', true); modules.set('dreams', false);
  assert.equal(has(), false, 'Routines on, Dreams off');
  modules.set('routines', false);
});

test('with the module off there is no nav entry, and none of its routes answers', async () => {
  modules.set('dreams', false);
  const m = modules.list().find(x => x.id === 'dreams');
  assert.equal(m.enabled, false);
  assert.deepEqual(m.nav, [{ route: 'dreams', label: 'Dreams' }], 'the dock shows only enabled modules');
  const before = fs.readdirSync(path.join(CH, 'agents')).length;
  for (const [method, p] of [['GET', '/api/dreams'], ['POST', '/api/dreams/run'], ['GET', '/api/dreams/x/idea/y/preview'], ['POST', '/api/dreams/x/idea/y/accept'], ['POST', '/api/dreams/x/idea/y/dismiss']])
    await assert.rejects(() => call(method, p, { token: 't' }), e => e.status === 403 && /switched off/.test(e.message), `${method} ${p}`);
  assert.equal(fs.readdirSync(path.join(CH, 'agents')).length, before);
  modules.set('dreams', true);
});

test('the Dreams page and the settings text say what is read and where it goes', () => {
  const view = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'js', 'views', 'dreams.js'), 'utf8');
  const settings = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'js', 'views', 'settings.js'), 'utf8');
  for (const src of [view, settings]) { assert.match(src, /what was typed to Claude|you typed to Claude Code/); assert.match(src, /nowhere else/); }
  assert.match(settings, /dreams\.claude/); assert.match(settings, /dreams\.web/); assert.match(settings, /dreams\.days/); assert.match(settings, /dreams\.maxCharsPerSession/); assert.match(settings, /dreams\.maxChars"/);
  assert.match(settings, /id !== 'dreams' \|\| dreamsOn/, 'the section is only there while the module is on');
});

test('accepting a skill writes both files create-only, lists both in the preview, and a failure part-way leaves nothing behind', async () => {
  store.setState('dreams', { nights: [] });
  const n = await fresh([{ ...skillIdea, title: 'Create-only skill', draft: { ...skillIdea.draft, name: 'create-only-skill' } }, { ...docIdea, title: 'Create-only doc', draft: { title: 'Create-only note', body: 'x' } }]);
  const id = ids(n);
  const p = await call('GET', `/api/dreams/${n.date}/idea/${id.skill}/preview`);
  const mine = path.join(store.dirs.skills, 'create-only-skill', 'SKILL.md'), theirs = path.join(CH, 'skills', 'create-only-skill', 'SKILL.md');
  assert.deepEqual(p.files.map(f => f.path).sort(), [mine, theirs].sort(), 'every file that will be written is shown');
  assert.match(p.where, /also saved in Jade's skills/);
  // a real failure after the first file: Jade's own skills folder cannot be written to, so the second file fails and the first is taken away again
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    fs.mkdirSync(store.dirs.skills, { recursive: true });
    fs.chmodSync(store.dirs.skills, 0o555);
    try {
      await assert.rejects(() => call('POST', `/api/dreams/${n.date}/idea/${id.skill}/accept`, { token: p.token }), /Nothing was made/);
    } finally { fs.chmodSync(store.dirs.skills, 0o755); }
    assert.ok(!fs.existsSync(path.dirname(theirs)), 'the first file and its folder were taken away again');
    assert.equal(night().ideas.find(i => i.kind === 'skill').status, 'new', 'and the idea can still be answered');
  }
  // now it works, and the notes are create-only as well
  await call('POST', `/api/dreams/${n.date}/idea/${id.skill}/accept`, { token: (await call('GET', `/api/dreams/${n.date}/idea/${id.skill}/preview`)).token });
  assert.ok(fs.existsSync(mine) && fs.existsSync(theirs));
  const pd = await call('GET', `/api/dreams/${n.date}/idea/${id.doc}/preview`);
  assert.equal(pd.files.length, 1); assert.match(pd.files[0].text, /title: Create-only note/);
  store.saveNote({ title: 'Create-only note', body: 'someone else\'s words' });
  const again = await call('GET', `/api/dreams/${n.date}/idea/${id.doc}/preview`);
  assert.match(again.problem || '', /already a note/, 'an existing note of that title today is not written over');
});
