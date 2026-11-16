// How hard the model thinks. A stand-in `claude` on PATH writes down the argv of every run, so each test reads what Jade really sent:
// chat.effort reaches a chat, a chat's own choice beats it, agents.effort reaches an agent job and a meeting's extraction call,
// checkerEffort reaches the checking agent, jade-effort on an agent file beats the setting, and '' sends no --effort at all.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-effort-'));
const bin = path.join(tmp, 'bin'), dump = path.join(tmp, 'runs.jsonl');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
if (a[0] !== '-p') { if (a[0] === 'auth') process.stdout.write('{}'); process.exit(0); }
const note = extra => fs.appendFileSync(${JSON.stringify(dump)}, JSON.stringify({ argv: a, ...extra }) + '\\n');
const result = text => JSON.stringify({ type: 'result', result: text, is_error: false });
if (a.includes('--input-format')) {          // a chat's warm process: one answer per line
  require('node:readline').createInterface({ input: process.stdin }).on('line', () => { note({ kind: 'chat' }); console.log(result('ok')); });
} else {
  let prompt = '';
  process.stdin.on('data', c => { prompt += c; });
  process.stdin.on('end', () => {
    if (!a.includes('--json-schema')) { note({ kind: 'agent' }); console.log(result('done')); return; }
    const props = JSON.parse(a[a.indexOf('--json-schema') + 1]).properties || {};
    let out;
    if (props.verdicts) {
      const made = prompt.slice(prompt.lastIndexOf('# What it produced'));
      out = { verdicts: JSON.parse(made.slice(made.indexOf('['))).map(i => ({ item_id: i.item_id, verdict: 'supported', evidence: i.output.quote, instruction: '', note: '' })), missed: [] };
      note({ kind: 'check' });
    } else {
      const text = prompt.split('--- TRANSCRIPT ---\\n')[1].split('\\n--- END')[0];
      out = { items: [{ text: 'A point', quote: text.split('\\n')[0] }] };
      note({ kind: 'extract' });
    }
    console.log(JSON.stringify({ type: 'result', result: '', is_error: false, structured_output: out, modelUsage: { 'stand-in': {} }, total_cost_usd: 0 }));
  });
}
`, { mode: 0o755 });
process.env.PATH = bin + path.delimiter + process.env.PATH;
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
const jobs = await import('../server/core/jobs.js');
const warm = await import('../server/core/warm.js');
const judge = await import('../server/core/judge.js');
const meetings = await import('../server/core/meetings.js');
const effort = await import('../server/core/effort.js');
config.load(); store.init();
after(() => { warm.shutdown(); fs.rmSync(tmp, { recursive: true, force: true }); });

const runs = () => (fs.existsSync(dump) ? fs.readFileSync(dump, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);
const last = kind => runs().filter(r => r.kind === kind).at(-1);
const flag = r => (r.argv.includes('--effort') ? r.argv[r.argv.indexOf('--effort') + 1] : null);
const put = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const chat = async cid => { const j = await jobs.enqueueAndWait({ agent: 'jade', input: { message: 'hello', thread: cid, route: 'home' }, trigger: 'chat' }); assert.equal(j.status, 'done', j.error); warm.shutdown(); };

test('chat.effort reaches a chat run, and a chat\'s own choice beats it', async () => {
  config.save({ chat: { effort: 'high' } });
  const a = store.resolveThread('new');
  await chat(a);
  assert.equal(flag(last('chat')), 'high');
  const b = store.resolveThread('new');
  store.updateThread(b, { effort: 'low' });
  await chat(b);
  assert.equal(flag(last('chat')), 'low', 'the chat\'s own choice wins');
});

test('an empty chat.effort sends no --effort, and the automated setting never leaks into a chat', async () => {
  config.save({ chat: { effort: '' }, agents: { effort: 'max' } });
  await chat(store.resolveThread('new'));
  assert.equal(flag(last('chat')), null);
  config.save({ agents: { effort: '' } });
});

test('agents.effort reaches an agent job, and the agent file\'s jade-effort beats it', async () => {
  put(path.join(process.env.JADE_CLAUDE_HOME, 'agents', 'worker-bee.md'), '---\nname: worker-bee\ndescription: x\njade-handler: markdown\n---\nDo the thing.\n');
  put(path.join(process.env.JADE_CLAUDE_HOME, 'agents', 'careful.md'), '---\nname: careful\ndescription: x\njade-handler: markdown\njade-effort: low\n---\nDo it carefully.\n');
  config.save({ agents: { effort: 'high' } });
  const run = async id => { const j = await jobs.enqueueAndWait({ agent: id, input: {}, trigger: 'manual' }); assert.equal(j.status, 'done', j.error); };
  await run('worker-bee');
  assert.equal(flag(last('agent')), 'high');
  await run('careful');
  assert.equal(flag(last('agent')), 'low', 'jade-effort wins for that agent');
  config.save({ agents: { effort: '' } });
  await run('worker-bee');
  assert.equal(flag(last('agent')), null, 'nothing is sent when nothing is set');
  config.save({ agents: { effort: 'turbo' } });   // not a level Claude Code knows
  await run('worker-bee');
  assert.equal(flag(last('agent')), null);
  config.save({ agents: { effort: '' } });
});

// ---- a meeting: the extraction calls, then the checking agent
const TEXT = 'Dana: I will send the budget to Priya by Friday.';
const folder = path.join(tmp, 'proj');
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, 'm.txt'), TEXT);
const project = store.saveProject({ name: 'Helios', folders: [folder] }).id;
meetings.use({ transcripts: { read: async () => ({ ok: true, text: TEXT, format: 'txt', date: '2026-11-12', title: 'Check-in', attendees: ['Dana'], chars: TEXT.length }) } });
const sk = path.join(store.dirs.skills, 'fx-points');
put(path.join(sk, 'SKILL.md'), '---\nname: fx-points\ndescription: points\n---\nList the points.\n');
put(path.join(sk, 'schema.json'), JSON.stringify({ type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, quote: { type: 'string' } }, required: ['text', 'quote'] } } }, required: ['items'], 'x-jade': { heading: 'Key points', quoteField: 'quote', saveTo: 'record', show: ['text'] } }));
const transcriptFile = (extra = '') => put(path.join(store.dirs.agents, 'transcript.md'), `---\nname: transcript\ndescription: Reads meetings.\ntools: []\nskills: [fx-points]\njade-loop: meeting\njade-checked: true\n${extra}---\nYou read meeting transcripts.\n`);
let n = 0;
const meet = async () => { const before = runs().length; const r = meetings.create({ project, file: { name: `m${++n}.txt`, path: path.join(folder, 'm.txt'), hash: 'h' + n, duplicateOf: null } }); await meetings.idle(); assert.equal(meetings.get(r.id).status, 'review', JSON.stringify(meetings.get(r.id).steps)); return runs().slice(before); };

test('agents.effort reaches a meeting\'s extraction call and checkerEffort the checking agent; the checker follows agents.effort when its own is blank', async () => {
  transcriptFile();
  config.save({ agents: { effort: 'medium', checkerEffort: 'xhigh' } });
  let got = await meet();
  assert.equal(flag(got.find(r => r.kind === 'extract')), 'medium');
  assert.equal(flag(got.find(r => r.kind === 'check')), 'xhigh');
  config.save({ agents: { effort: 'medium', checkerEffort: '' } });
  got = await meet();
  assert.equal(flag(got.find(r => r.kind === 'check')), 'medium', 'blank means the same as agents.effort');
});

test('jade-effort on the Transcript agent beats agents.effort for its extraction call; and blank everywhere sends no flag', async () => {
  transcriptFile('jade-effort: max\n');
  config.save({ agents: { effort: 'low', checkerEffort: '' } });
  let got = await meet();
  assert.equal(flag(got.find(r => r.kind === 'extract')), 'max');
  assert.equal(flag(got.find(r => r.kind === 'check')), 'low', 'the checker is not the Transcript agent');
  transcriptFile();
  config.save({ agents: { effort: '', checkerEffort: '' } });
  got = await meet();
  assert.ok(got.length >= 2);
  for (const r of got) assert.equal(flag(r), null, r.kind);
});

test('the judge call and the effort helper accept only the levels Claude Code knows', async () => {
  assert.deepEqual(effort.LEVELS, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(effort.valid('turbo'), ''); assert.equal(effort.valid(''), '');
  const before = runs().length;
  await judge.judge({ system: 's', prompt: '--- TRANSCRIPT ---\nx y z\n--- END', schema: { type: 'object', properties: { items: { type: 'array' } } }, effort: 'high' });
  assert.equal(flag(runs()[before]), 'high');
});

test('the settings and set-up pages carry the new controls', async () => {
  const s = fs.readFileSync(path.join(import.meta.dirname, '..', 'public/js/views/settings.js'), 'utf8');
  assert.match(s, /How hard Jade thinks/); assert.match(s, /data-k="agents\.effort"/); assert.match(s, /data-k="agents\.checkerEffort"/);
  assert.equal((s.match(/data-k="chat\.effort"/g) || []).length, 1, 'chat effort is not duplicated');
  const { finishSetup } = await import('../public/js/views/setup.js');
  const sent = [];
  await finishSetup({ name: '', model: '', checkerModel: '', install: 'no', effort: { chat: 'high', agents: 'low' } }, { api: async (m, u, b) => { sent.push([u, b]); return u === '/api/setup' ? { connectionChecked: true } : u === '/api/projects' ? [] : {}; }, ui: { toast() {} }, state: {}, go() {} });
  const cfg = sent.find(([u, b]) => u === '/api/config' && b?.agents)[1];
  assert.equal(cfg.chat.effort, 'high'); assert.equal(cfg.agents.effort, 'low');
  config.save({ chat: { effort: 'high' }, agents: { effort: 'low' } });
  assert.deepEqual((await import('../server/modules/setup.js')).state().efforts, { chat: 'high', agents: 'low' }, 'set-up starts from what is saved (blank at first)');
  assert.deepEqual(config.DEFAULTS.agents, { model: '', checkerModel: '', effort: '', checkerEffort: '' });
});
