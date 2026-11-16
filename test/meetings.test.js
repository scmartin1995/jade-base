// The meeting workflow with a faked model (judge.use) and a faked transcript reader. The agent and its skills are written into the temp
// data folder, so a skill added there is picked up with no code change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-meetings-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
config.save({ name: 'Sam' });
const store = await import('../server/core/store.js');
const judge = await import('../server/core/judge.js');
const skeptic = await import('../server/core/skeptic.js');
const meetings = await import('../server/core/meetings.js');
store.init();

const folder = path.join(process.env.JADE_HOME, 'proj');
fs.mkdirSync(folder, { recursive: true });
const project = store.saveProject({ name: 'Helios', folders: [folder] }).id;

const TEXT = 'Dana: I will send the budget to Priya by Friday.\nPriya: We risk missing the launch date if the vendor is late.\nMarcus: We decided to keep the current vendor.';
const Q = { budget: 'I will send the budget to Priya by Friday', risk: 'We risk missing the launch date if the vendor is late', decision: 'We decided to keep the current vendor' };
const tfile = path.join(folder, 'steerco.txt');
fs.writeFileSync(tfile, TEXT);
meetings.use({ transcripts: { read: async () => ({ ok: true, text: TEXT, format: 'txt', date: '2026-11-12', title: 'Steering committee', attendees: ['Dana', 'Priya', 'Marcus'], chars: TEXT.length }) } });

const itemsSchema = (extra = {}) => ({ type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, ...extra, quote: { type: 'string' } }, required: ['text', 'quote'] } } }, required: ['items'] });
function writeSkill(name, body, xjade, extra) {
  const d = path.join(store.dirs.skills, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n${body}\n`);
  fs.writeFileSync(path.join(d, 'schema.json'), JSON.stringify({ ...itemsSchema(extra), 'x-jade': xjade }));
}
writeSkill('fx-points', 'List the points that were made.', { heading: 'Key points', quoteField: 'quote', saveTo: 'record', show: ['text'] });
writeSkill('fx-actions', 'List what somebody promised to do.', { heading: 'Action items', quoteField: 'quote', saveTo: 'actions', map: { text: 'text', owner: 'owner', due: 'due_date', dueWords: 'due' }, show: ['text', 'owner', 'due', 'due_date'] }, { owner: { type: 'string' }, due: { type: 'string' }, due_date: { type: 'string' } });
function writeAgent(skills) {
  fs.mkdirSync(store.dirs.agents, { recursive: true });
  fs.writeFileSync(path.join(store.dirs.agents, 'transcript.md'), `---\nname: transcript\ndescription: Reads meetings.\ntools: []\nskills: [${skills.join(', ')}]\njade-loop: meeting\njade-checked: true\n---\nYou read meeting transcripts for a project manager.\n`);
}
writeAgent(['fx-points', 'fx-actions']);

// ---- the fake model
let calls, outputs, checker;
const reset = () => {
  calls = [];
  outputs = {
    'fx-points': () => [{ text: 'The vendor is a risk', quote: Q.risk }],
    'fx-actions': () => [{ text: 'Send the budget', owner: 'Dana', due: 'Friday', due_date: '2026-11-13', quote: Q.budget }],
    'fx-decisions': () => [{ text: 'Keep the vendor', quote: Q.decision }],
  };
  checker = ({ items }) => ({ verdicts: items.map(i => ({ item_id: i.item_id, verdict: 'supported', evidence: i.output.quote, instruction: '', note: '' })), missed: [] });
  judge.use(async ({ system, prompt, label, schema }) => {
    if (label === 'Skeptic') {
      const items = JSON.parse(prompt.slice(prompt.indexOf('# What it produced') + 18));
      calls.push({ label, prompt, items });
      return { data: checker({ items, prompt }), model: 'fake-checker' };
    }
    const skill = label.replace('Transcript: ', '');
    const n = calls.filter(c => c.skill === skill).length;
    calls.push({ label, skill, system, prompt, schema });
    const out = outputs[skill];
    return { data: { items: typeof out === 'function' ? out(n) : out }, model: 'fake-model' };
  });
};
reset();

let n = 0;
async function drop(over = {}) {
  const file = { name: `m${++n}.txt`, path: tfile, hash: 'h' + n, duplicateOf: null, ...over };
  const r = meetings.create({ project, file });
  await meetings.idle();
  return r.id;
}
const all = m => m.skills.flatMap(s => s.items);
const accept = (m, ids) => meetings.patch(m.id, { items: ids.map(id => ({ id, accepted: true })) });

test('the schema check covers type, required, enum, items and properties', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: 'array', items: { type: 'string', enum: ['x', 'y'] } } } };
  assert.equal(meetings.validate({ a: ['x'] }, s), null);
  assert.match(meetings.validate({}, s), /missing "a"/);
  assert.match(meetings.validate({ a: [1] }, s), /a\[0\]/);
  assert.match(meetings.validate({ a: ['z'] }, s), /one of x, y/);
});

test('happy path: each skill runs once, every item is checked, accepted items are recorded and actions added', async () => {
  reset();
  const m = meetings.get(await drop());
  assert.equal(m.status, 'review');
  assert.equal(m.title, 'Steering committee'); assert.equal(m.date, '2026-11-12'); assert.deepEqual(m.attendees, ['Dana', 'Priya', 'Marcus']);
  assert.deepEqual(m.skills.map(s => s.heading), ['Key points', 'Action items']);
  assert.ok(all(m).every(i => i.codeCheck.ok && i.verdict === 'supported'));
  assert.deepEqual(m.counts, { passed: 2, corrected: 0, notChecked: 0 });
  // the prompt is the agent's prompt then the skill's text, as written; the schema sent has no x-jade
  const c = calls.find(x => x.skill === 'fx-actions');
  assert.ok(c.system.startsWith('You read meeting transcripts for a project manager.') && c.system.includes('List what somebody promised to do.'));
  assert.ok(!('x-jade' in c.schema));
  assert.ok(m.steps.some(s => s.name === 'check' && s.model === 'fake-checker'));
  // the checker is shown the instructions and the log is written
  assert.ok(calls.find(x => x.label === 'Skeptic').prompt.includes('List the points that were made.'));
  assert.ok(skeptic.history().some(v => v.workflow === 'transcript' && v.verdict === 'pass'));

  const keep = all(m).map(i => i.id);
  accept(m, keep);
  const filesMod = await import('../server/core/files.js');
  filesMod.scan(true);   // a file map that is already cached
  const r = meetings.writeRecord(m.id);
  assert.ok(filesMod.scan().some(f => f.path === r.recordPath), 'the record is in the file map at once, not at the next scan');
  assert.equal(r.recordPath, path.join(folder, 'Jade', 'Meetings', '2026-11-12 Steering committee.md'));
  const md = fs.readFileSync(r.recordPath, 'utf8');
  assert.match(md, /^---\ndate: 2026-11-12\nproject: Helios/);
  assert.match(md, /transcript: \.\.|transcript: /);
  assert.match(md, /checked: "2 passed, 0 corrected, 0 not checked"/);
  assert.match(md, /## Key points\n\n- The vendor is a risk\n  > We risk missing/);
  assert.match(md, /## Action items\n\n- Send the budget \(owner: Dana; due: Friday, 2026-11-13\)/);
  assert.doesNotMatch(md, /Due date:|Text:/, 'no field names leak into the sentence');
  const acts = store.listActions().filter(a => a.source === r.recordPath);
  assert.equal(acts.length, 1);
  assert.equal(acts[0].owner, 'Dana'); assert.equal(acts[0].project, project); assert.equal(acts[0].due, '2026-11-13');
  assert.equal(meetings.get(m.id).status, 'recorded');
});

test('a quote that is not in the transcript fails the code check and is not sent to the checker', async () => {
  reset();
  outputs['fx-points'] = () => [{ text: 'Made up', quote: 'We will double the budget next year' }, { text: 'Real', quote: Q.risk }];
  const m = meetings.get(await drop());
  const bad = m.skills[0].items.find(i => i.fields.text === 'Made up');
  assert.equal(bad.codeCheck.ok, false); assert.match(bad.codeCheck.reason, /not word for word/);
  assert.equal(bad.verdict, 'not-checked');
  const sent = calls.find(c => c.label === 'Skeptic').items.map(i => i.item_id);
  assert.ok(!sent.includes(bad.id));
  assert.equal(m.counts.notChecked, 1);
});

test('schema-invalid output is asked for again once with the error, then used', async () => {
  reset();
  outputs['fx-points'] = k => (k === 0 ? [{ text: 5, quote: Q.risk }] : [{ text: 'Fixed', quote: Q.risk }]);
  const m = meetings.get(await drop());
  const mine = calls.filter(c => c.skill === 'fx-points');
  assert.equal(mine.length, 2);
  assert.match(mine[1].prompt, /did not match the required format/);
  assert.equal(m.status, 'review');
  assert.equal(m.skills[0].items[0].fields.text, 'Fixed');
});

test('output that is invalid twice fails the run in plain words, nothing is recorded', async () => {
  reset();
  outputs['fx-points'] = () => [{ text: 5, quote: Q.risk }];
  const m = meetings.get(await drop());
  assert.equal(m.status, 'failed'); assert.match(m.error, /wrong format/);
  assert.equal(m.recordPath, null);
});

test('an item the checker skips is "not-checked", never a pass', async () => {
  reset();
  checker = ({ items }) => ({ verdicts: items.filter(i => i.skill !== 'fx-points').map(i => ({ item_id: i.item_id, verdict: 'supported', evidence: i.output.quote, instruction: '', note: '' })), missed: [] });
  const m = meetings.get(await drop());
  assert.equal(all(m).filter(i => i.verdict === 'not-checked').length, 1);
  assert.equal(m.counts.notChecked, 1);
});

test('evidence that is not in the transcript, or an instruction quote not in the instructions, makes the item "not-checked"; missed quotes must be real', async () => {
  reset();
  checker = ({ items, prompt }) => ({
    verdicts: items.map((i, k) => k === 0
      ? { item_id: i.item_id, verdict: 'supported', evidence: 'something nobody said at all', instruction: '', note: '' }
      : { item_id: i.item_id, verdict: 'wrong', evidence: i.output.quote, instruction: 'an instruction nobody wrote', note: 'bad' }),
    missed: prompt.includes('List the points that were made.') ? [{ skill: 'fx-points', text: 'Real miss', quote: Q.decision }, { skill: 'fx-points', text: 'Invented', quote: 'this was never said here' }] : [] });
  config.save({ meetings: { maxRounds: 0 } });
  const m = meetings.get(await drop());
  config.save({ meetings: { maxRounds: 1 } });
  assert.ok(all(m).every(i => i.verdict === 'not-checked'));
  assert.deepEqual(m.missed.map(x => x.text), ['Real miss']);
  assert.equal(m.missedDropped, 1, 'the count of discarded entries is kept');
});

test('a repair round re-runs only the skill with a disputed item, with the notes, and checks only what changed', async () => {
  reset();
  outputs['fx-actions'] = k => (k === 0 ? [{ text: 'Send the budget', owner: 'Priya', due: 'Friday', due_date: '', quote: Q.budget }] : [{ text: 'Send the budget', owner: 'Dana', due: 'Friday', due_date: '', quote: Q.budget }]);
  checker = ({ items }) => ({ verdicts: items.map(i => (i.output.owner === 'Priya' ? { item_id: i.item_id, verdict: 'wrong', evidence: i.output.quote, instruction: 'List what somebody promised to do.', note: 'Dana said it, not Priya' }
    : { item_id: i.item_id, verdict: 'supported', evidence: i.output.quote, instruction: '', note: '' })), missed: [] });
  const m = meetings.get(await drop());
  assert.equal(calls.filter(c => c.skill === 'fx-points').length, 1);
  const a = calls.filter(c => c.skill === 'fx-actions');
  assert.equal(a.length, 2);
  assert.match(a[1].prompt, /Dana said it, not Priya/);
  const checks = calls.filter(c => c.label === 'Skeptic');
  assert.equal(checks.length, 3, 'a check for each skill, then one for the skill that was repaired'); assert.equal(checks[2].items.length, 1);
  const fixed = m.skills[1].items[0];
  assert.equal(fixed.fields.owner, 'Dana'); assert.equal(fixed.verdict, 'supported');
  assert.deepEqual(m.counts, { passed: 1, corrected: 1, notChecked: 0 });
  assert.ok(m.steps.some(s => s.name === 'extract fx-actions'));
});

test('a disputed item that stays disputed keeps its verdict', async () => {
  reset();
  checker = ({ items }) => ({ verdicts: items.map(i => ({ item_id: i.item_id, verdict: 'not-asked', evidence: '', instruction: i.skill === 'fx-points' ? 'List the points that were made.' : 'List what somebody promised to do.', note: 'no' })), missed: [] });
  const m = meetings.get(await drop());
  assert.equal(m.status, 'review');
  assert.ok(all(m).every(i => i.verdict === 'not-asked'));
  assert.equal(calls.filter(c => c.skill === 'fx-points').length, 2);   // one repair round, then stop
});

test('a usage limit pauses the run, and it carries on when the limit lifts', async () => {
  reset();
  const ok = judge.judge;
  judge.use(async () => { throw new judge.LimitError("You've hit your limit", new Date(Date.now() + 3600e3)); });
  const r = meetings.create({ project, file: { name: 'limit.txt', path: tfile, hash: 'hl', duplicateOf: null } });
  for (let i = 0; i < 50 && meetings.get(r.id).status !== 'paused'; i++) await new Promise(f => setTimeout(f, 20));
  const m = meetings.get(r.id);
  assert.equal(m.status, 'paused'); assert.ok(m.pausedUntil);
  // a second upload waits behind it
  const second = meetings.create({ project, file: { name: 'wait.txt', path: tfile, hash: 'hw', duplicateOf: null } });
  await new Promise(f => setTimeout(f, 50));
  assert.equal(meetings.get(second.id).status, 'queued');
  reset();
  meetings.resumeNow();
  await meetings.idle();
  assert.equal(meetings.get(r.id).status, 'review');
  assert.equal(meetings.get(second.id).status, 'review');
  assert.equal(ok, judge.judge);
});

test('the same file twice does not start a second run', async () => {
  reset();
  const first = await drop({ hash: 'same' });
  const before = calls.length;
  const r = meetings.create({ project, file: { name: 'again.txt', path: tfile, hash: 'same', duplicateOf: first } });
  await meetings.idle();
  assert.deepEqual(r, { id: first, duplicateOf: first });
  assert.equal(calls.length, before);
});

test('an unreadable transcript fails with the reason', async () => {
  reset();
  meetings.use({ transcripts: { read: async () => ({ ok: false, reason: 'This file is empty.' }) } });
  const m = meetings.get(await drop());
  meetings.use({ transcripts: { read: async () => ({ ok: true, text: TEXT, format: 'txt', date: '2026-11-12', title: 'Steering committee', attendees: [], chars: TEXT.length }) } });
  assert.equal(m.status, 'failed'); assert.equal(m.error, 'This file is empty.');
});

test('a fourth skill folder appears in the result and the record with no code change', async () => {
  reset();
  writeSkill('fx-decisions', 'List what was decided.', { heading: 'Decisions', quoteField: 'quote', saveTo: 'record', show: ['text'] });
  writeAgent(['fx-points', 'fx-actions', 'fx-decisions']);
  const m = meetings.get(await drop());
  assert.deepEqual(m.skills.map(s => s.heading), ['Key points', 'Action items', 'Decisions']);
  accept(m, all(m).map(i => i.id));
  const md = fs.readFileSync(meetings.writeRecord(m.id).recordPath, 'utf8');
  assert.match(md, /## Decisions\n\n- Keep the vendor/);
  writeAgent(['fx-points', 'fx-actions']);
});

test('a new skill whose heading is none of the usual three still shows on a dashboard, with no code change', async () => {
  reset();
  outputs['fx-stakeholders'] = () => [{ text: 'The warehouse lead must sign off', quote: Q.decision }];
  writeSkill('fx-stakeholders', 'List who must be kept informed.', { heading: 'Stakeholders', quoteField: 'quote', saveTo: 'record', show: ['text'] });
  writeAgent(['fx-points', 'fx-actions', 'fx-stakeholders']);
  const m = meetings.get(await drop());
  accept(m, all(m).map(i => i.id));
  const rec = meetings.writeRecord(m.id).recordPath;
  const dashboards = await import('../server/core/dashboards.js');
  const row = dashboards.collect(project).sources.meetings.find(x => x._path === rec);
  assert.deepEqual(row._other, [{ heading: 'Stakeholders', total: 1, items: ['The warehouse lead must sign off'] }]);
  assert.equal(row.decisions, 1, 'the usual three are counted as before');
  // and the page draws it
  class Node { constructor(t) { this.tag = t; this.attrs = {}; this.kids = []; } setAttribute(k, v) { this.attrs[k] = String(v); } appendChild(k) { this.kids.push(k); return k; } }
  globalThis.document = { createElement: t => new Node(t), createElementNS: (ns, t) => new Node(t), createTextNode: t => ({ text: String(t) }) };
  const text = n => (n.text !== undefined ? n.text : n.kids.map(text).join(' '));
  const { default: draw } = await import('../public/js/dashboard/layouts/meetings.js');
  const out = text(draw({ layout: 'meetings', filter: [], limit: 3 }, { data: { sources: { meetings: [row] } }, schema: (await import('../server/core/dashboardspec.js')).publicSchema() }));
  assert.match(out, /Stakeholders/); assert.match(out, /The warehouse lead must sign off/);
  writeAgent(['fx-points', 'fx-actions']);
});

test('auto-accept records what was supported at once and leaves the rest out', async () => {
  reset();
  config.save({ meetings: { accept: 'auto' } });
  outputs['fx-points'] = () => [{ text: 'Real', quote: Q.risk }, { text: 'Made up', quote: 'We will double the budget next year' }];
  const m = meetings.get(await drop());
  config.save({ meetings: { accept: 'review' } });
  assert.equal(m.status, 'recorded');
  const md = fs.readFileSync(m.recordPath, 'utf8');
  assert.match(md, /- Real/); assert.doesNotMatch(md, /Made up/);
});

test('writing the record again updates the same file and does not add the action twice', async () => {
  reset();
  outputs['fx-actions'] = () => [{ text: 'Send the budget twice', owner: 'Dana', due: 'Friday', quote: Q.budget }];
  const m = meetings.get(await drop());
  accept(m, all(m).map(i => i.id));
  const a = meetings.writeRecord(m.id).recordPath;
  meetings.patch(m.id, { items: [{ id: m.skills[0].items[0].id, fields: { text: 'Edited point' } }] });
  const b = meetings.writeRecord(m.id).recordPath;
  assert.equal(a, b);
  assert.match(fs.readFileSync(b, 'utf8'), /Edited point/);
  assert.equal(store.listActions().filter(x => x.text.startsWith('Send the budget twice')).length, 1);
});

test('rerun starts again from the saved transcript; delete keeps the transcript and the record', async () => {
  reset();
  const m = meetings.get(await drop());
  accept(m, all(m).map(i => i.id));
  const rec = meetings.writeRecord(m.id).recordPath;
  meetings.rerun(m.id);
  await meetings.idle();
  assert.equal(meetings.get(m.id).status, 'review');
  assert.equal(meetings.list(project).some(x => x.id === m.id), true);
  meetings.remove(m.id);
  assert.equal(meetings.get(m.id), null);
  assert.ok(fs.existsSync(rec) && fs.existsSync(tfile));
});

test('patch rejects a bad date and the list drops the checker\'s evidence', async () => {
  reset();
  const m = meetings.get(await drop());
  assert.throws(() => meetings.patch(m.id, { date: 'yesterday' }), /look like/);
  assert.ok(all(meetings.get(m.id)).some(i => i.evidence));
  assert.ok(meetings.list(project).map(meetings.slim).every(x => all(x).every(i => !('evidence' in i))));
});

// ---------------------------------------------------------------- repairs found while checking meeting reading
const first = (m, skill) => m.skills.find(s => s.skill === skill).items[0];

test('a record never replaces a file that is not this meeting\'s own: same date and title get " (2)", a stranger\'s file is kept', async () => {
  reset();
  const dir = path.join(folder, 'Jade', 'Meetings');
  fs.mkdirSync(dir, { recursive: true });
  const stranger = path.join(dir, '2026-11-12 Overwrite check.md');
  fs.writeFileSync(stranger, 'my own notes, not a meeting record');
  const rec = async () => {
    meetings.use({ transcripts: { read: async () => ({ ok: true, text: TEXT, format: 'txt', date: '2026-11-12', title: 'Overwrite check', attendees: [], chars: TEXT.length }) } });
    const m = meetings.get(await drop());
    accept(m, all(m).map(i => i.id));
    return meetings.writeRecord(m.id).recordPath;
  };
  const a = await rec(), b = await rec();
  assert.equal(fs.readFileSync(stranger, 'utf8'), 'my own notes, not a meeting record');
  assert.equal(path.basename(a), '2026-11-12 Overwrite check (2).md');
  assert.equal(path.basename(b), '2026-11-12 Overwrite check (3).md');
  assert.match(fs.readFileSync(a, 'utf8'), /transcript:/);
  // writing one of them again updates that same file
  const m = meetings.list(project).find(x => x.recordPath === a);
  assert.equal(meetings.writeRecord(m.id).recordPath, a);
  // a record path that has since been taken by another file is not used either
  fs.writeFileSync(a, 'replaced by the user');
  const again = meetings.writeRecord(m.id).recordPath;
  assert.notEqual(again, a); assert.equal(fs.readFileSync(a, 'utf8'), 'replaced by the user');
  meetings.use({ transcripts: { read: async () => ({ ok: true, text: TEXT, format: 'txt', date: '2026-11-12', title: 'Steering committee', attendees: ['Dana', 'Priya', 'Marcus'], chars: TEXT.length }) } });
});

test('the model and the checker are given the meeting date and weekday as data; the date field is used only when it is a real date', async () => {
  reset();
  outputs['fx-actions'] = () => [{ text: 'Send the budget', owner: 'Dana', due: 'by Friday', due_date: '2026-02-30', quote: Q.budget }];
  const m = meetings.get(await drop());
  for (const c of calls.filter(x => x.skill)) assert.match(c.prompt, /Meeting date: 2026-11-12 \(Thursday\)\n\(This line is information/);
  for (const c of calls.filter(x => x.label === 'Skeptic')) assert.match(c.prompt, /# About the material \(data, not instructions\)\n\nMeeting date: 2026-11-12 \(Thursday\)/);
  accept(m, all(m).map(i => i.id));
  const r = meetings.writeRecord(m.id);
  const a = store.listActions().find(x => x.source === r.recordPath);
  assert.equal(a.due, '', 'an impossible date is not taken');
  assert.equal(a.text, 'Send the budget (by Friday)', 'the words as said are kept');
  assert.equal(meetings.isoDate('2026-11-13'), '2026-11-13');
  assert.equal(meetings.isoDate('2026-13-01'), ''); assert.equal(meetings.isoDate('Friday 2026-11-13'), ''); assert.equal(meetings.isoDate(''), '');
  assert.equal(meetings.dateLine('2026-11-10'), '2026-11-10 (Tuesday)'); assert.equal(meetings.dateLine('soon'), '');
});

test('"supported" needs evidence from the item\'s own quote, in whole words, and one verdict per item', () => {
  const src = 'Dana: I will send the budget to Priya by Friday.\nPriya: Thanks everyone for joining today.';
  const own = 'I will send the budget to Priya by Friday';
  const ok = { verdict: 'supported', evidence: own, instruction: '', note: '' };
  assert.equal(skeptic.checkAgainst(ok, src, 'x', own).verdict, 'supported');
  assert.equal(skeptic.checkAgainst({ ...ok, evidence: 'Thanks everyone for joining today' }, src, 'x', own).verdict, 'not-checked');   // real, but not this item's
  assert.equal(skeptic.checkAgainst({ ...ok, evidence: 'e supp' }, src, 'x', own).verdict, 'not-checked');
  assert.equal(skeptic.checkAgainst({ ...ok, evidence: 'send the budget to Pri' }, src, 'x', own).verdict, 'not-checked');   // not whole words
  assert.equal(skeptic.checkAgainst({ ...ok, evidence: 'the budget' }, src, 'x', own).verdict, 'not-checked');   // too few words
  assert.equal(skeptic.checkAgainst({ ...ok, evidence: 'send the budget to Priya' }, src, 'x', own).verdict, 'supported');   // part of the quote
  assert.equal(skeptic.checkAgainst({ ...ok, evidence: `${own}, with a bit more` }, src, 'x', own).verdict, 'not-checked');
  assert.equal(skeptic.checkAgainst({ verdict: 'wrong', evidence: 'Thanks everyone for joining today', instruction: 'Only list things that were promised', note: '' }, src, 'Only list things that were promised.', own).verdict, 'wrong');
});

test('two verdicts for one item make it not-checked, and discarded "missed" entries are counted and kept on the meeting', async () => {
  reset();
  checker = ({ items }) => ({
    verdicts: items.flatMap(i => [{ item_id: i.item_id, verdict: 'supported', evidence: i.output.quote, instruction: '', note: '' }, { item_id: i.item_id, verdict: 'wrong', evidence: i.output.quote, instruction: 'List the points that were made.', note: 'x' }]),
    missed: [{ skill: 'fx-points', text: 'a', quote: 'never said anywhere here' }, { skill: 'fx-points', text: 'b', quote: 'too short' }] });
  config.save({ meetings: { maxRounds: 0 } });
  const m = meetings.get(await drop());
  config.save({ meetings: { maxRounds: 1 } });
  assert.ok(all(m).every(i => i.verdict === 'not-checked'));
  assert.equal(m.missedDropped, 4, 'two entries from each skill\'s check');
  assert.deepEqual(m.missed, []);
});

test('a quote of fewer than three words, or part of a word, fails the code check', async () => {
  reset();
  outputs['fx-points'] = () => [{ text: 'Short', quote: 'the budget' }, { text: 'Fragment', quote: 'send the budget to Pri' }, { text: 'Fine', quote: Q.risk }];
  config.save({ meetings: { maxRounds: 0 } });
  const m = meetings.get(await drop());
  config.save({ meetings: { maxRounds: 1 } });
  const by = t => m.skills[0].items.find(i => i.fields.text === t);
  assert.equal(by('Short').codeCheck.ok, false); assert.match(by('Short').codeCheck.reason, /too short/);
  assert.equal(by('Fragment').codeCheck.ok, false);
  assert.equal(by('Fine').codeCheck.ok, true);
});

test('items that fail the code check go back in the repair round with the reason', async () => {
  reset();
  outputs['fx-points'] = k => (k === 0 ? [{ text: 'Made up', quote: 'We will double the budget next year' }] : [{ text: 'Real', quote: Q.risk }]);
  const m = meetings.get(await drop());
  const mine = calls.filter(c => c.skill === 'fx-points');
  assert.equal(mine.length, 2, 'asked once more');
  assert.match(mine[1].prompt, /We will double the budget next year/);
  assert.match(mine[1].prompt, /not word for word in the transcript/);
  assert.equal(m.skills[0].items[0].fields.text, 'Real'); assert.equal(m.skills[0].items[0].verdict, 'supported');
  assert.equal(m.counts.corrected, 1);
});

test('edits must match the skill: text or a list of text, known fields only, 400 otherwise', async () => {
  reset();
  const m = meetings.get(await drop());
  const act = first(m, 'fx-actions'), pt = first(m, 'fx-points');
  const bad = body => assert.throws(() => meetings.patch(m.id, body), e => e.status === 400);
  bad({ items: [{ id: pt.id, fields: { text: { a: 1 } } }] });
  bad({ items: [{ id: pt.id, fields: { text: 5 } }] });
  bad({ items: [{ id: pt.id, fields: { text: [1] } }] });
  bad({ items: [{ id: pt.id, fields: { text: ['a'] } }] });   // the schema says text, not a list
  bad({ items: [{ id: pt.id, fields: { nothing: 'x' } }] });
  bad({ items: [{ id: pt.id, fields: { quote: 'x' } }] });
  bad({ items: [{ id: pt.id, fields: 'text' }] });
  assert.equal(first(meetings.get(m.id), 'fx-points').fields.text, pt.fields.text, 'nothing was stored');
  meetings.patch(m.id, { items: [{ id: act.id, fields: { owner: 'Priya', due: 'Monday' } }] });
  assert.equal(first(meetings.get(m.id), 'fx-actions').fields.owner, 'Priya');
});

test('a person can add a possibly-missed item: checked against the schema, marked as theirs, kept and recorded', async () => {
  reset();
  checker = ({ items, prompt }) => ({ verdicts: items.map(i => ({ item_id: i.item_id, verdict: 'supported', evidence: i.output.quote, instruction: '', note: '' })),
    missed: prompt.includes('List the points that were made.') ? [{ skill: 'fx-points', text: 'Keep the vendor', quote: Q.decision }] : [] });
  const m = meetings.get(await drop());
  assert.equal(m.missed.length, 1);
  const bad = add => assert.throws(() => meetings.patch(m.id, { items: [{ add }] }), e => e.status === 400);
  bad({ skill: 'nope', fields: { text: 'x' } });
  bad({ skill: 'fx-points', fields: { text: { a: 1 } } });
  bad({ skill: 'fx-points', fields: { other: 'x' } });
  bad({ skill: 'fx-points', fields: {} });
  bad({ skill: 'fx-points', fields: { text: 'x' }, quote: 4 });
  bad('text');
  const r = meetings.patch(m.id, { items: [{ add: { skill: 'fx-points', text: 'Keep the vendor', fields: {}, quote: Q.decision } }] });
  const added = r.skills[0].items.find(i => i.addedByPM);
  assert.equal(added.fields.text, 'Keep the vendor'); assert.equal(added.verdict, 'added-by-pm'); assert.equal(added.accepted, true);
  assert.equal(added.codeCheck, null); assert.equal(r.missed.length, 0, 'it leaves the missed list');
  assert.equal(r.counts.added, 1);
  // a skill with more fields: the others are blank, and an owner can be given
  const r2 = meetings.patch(m.id, { items: [{ add: { skill: 'fx-actions', fields: { text: 'Call the vendor', owner: 'Marcus' } } }] });
  const a2 = r2.skills[1].items.find(i => i.addedByPM);
  assert.deepEqual(a2.fields, { text: 'Call the vendor', owner: 'Marcus' });   // blanks are filled in only for fields the schema requires
  accept(m, all(meetings.get(m.id)).map(i => i.id));
  const rec = meetings.writeRecord(m.id);
  assert.match(fs.readFileSync(rec.recordPath, 'utf8'), /1 added by you|2 added by you/);
  assert.ok(store.listActions().some(a => a.source === rec.recordPath && a.text === 'Call the vendor' && a.owner === 'Marcus'));
});

test('a record reads as sentences: the kind as a bold label, the text first, no field names, one due', () => {
  const S = { heading: 'Risks and issues', show: ['kind', 'text', 'impact', 'raised_by'] };
  const md = meetings.sectionText({ ...S, items: [{ accepted: true, quote: 'q', fields: { kind: 'risk', text: 'Scanners may arrive late', impact: '', raised_by: 'Priya' } }] });
  assert.match(md, /- \*\*Risk:\*\* Scanners may arrive late \(raised by: Priya\)\n  > q/);
  assert.doesNotMatch(md, /Text:|Raised By/);
  const a = meetings.sectionText({ heading: 'Actions', show: ['text', 'owner', 'due', 'due_date'], items: [{ accepted: true, quote: 'q', fields: { text: 'Send it', owner: 'Marcus', due: 'by Thursday', due_date: '2026-11-12' } }, { accepted: true, quote: 'q', fields: { text: 'Call', owner: '', due: '', due_date: '2026-11-20' } }] });
  assert.match(a, /- Send it \(owner: Marcus; due: by Thursday, 2026-11-12\)/);
  assert.match(a, /- Call \(due: 2026-11-20\)/);
});

test('a title made from a file name is readable: no date, no "zoom", a capital', () => {
  assert.equal(meetings.guessTitle('zoom_2026-11-09_brightside-kickoff.vtt'), 'Brightside kickoff');
  assert.equal(meetings.guessTitle('warehouse weekly.txt'), 'Warehouse weekly');
  assert.equal(meetings.guessTitle('2026-11-10.vtt'), 'Meeting');
  assert.equal(meetings.guessTitle(''), 'Meeting');
});

test('deleting a failed meeting also removes the copy of its transcript, but not one another meeting still uses', () => {
  reset();
  const dir = store.projectDir(project, 'Meetings/transcripts');
  const mk = (name, status, over = {}) => { const f = path.join(dir, name); fs.writeFileSync(f, 'x'); const id = 'mdel-' + name.replace(/\W/g, ''); fs.writeFileSync(path.join(process.env.JADE_HOME, '.state', 'meetings', id + '.json'), JSON.stringify({ id, project, status, skills: [], source: { path: f, name }, ...over })); return { id, f }; };
  fs.mkdirSync(path.join(process.env.JADE_HOME, '.state', 'meetings'), { recursive: true });
  const bad = mk('bad.txt', 'failed'), ok = mk('ok.txt', 'recorded');
  meetings.remove(bad.id); meetings.remove(ok.id);
  assert.equal(fs.existsSync(bad.f), false, 'the stray copy of a failed meeting goes');
  assert.equal(fs.existsSync(ok.f), true, 'a recorded meeting\'s transcript is kept');
});

test('a meeting that is still being read cannot be edited (the run would overwrite the edit); it can once it is ready', async () => {
  reset();
  const m = meetings.get(await drop());
  for (const status of meetings.ACTIVE) {
    fs.writeFileSync(path.join(config.STATE, 'meetings', `${m.id}.json`), JSON.stringify({ ...m, status }));
    assert.throws(() => meetings.patch(m.id, { title: 'New title' }), e => e.status === 409 && /still being read/.test(e.message));
  }
  fs.writeFileSync(path.join(config.STATE, 'meetings', `${m.id}.json`), JSON.stringify({ ...m, status: 'review' }));
  assert.equal(meetings.patch(m.id, { title: 'New title' }).title, 'New title');
});

test('round trip: what writeRecord writes is what the dashboards read back (one format, one file)', async () => {
  reset();
  const m = meetings.get(await drop());
  accept(m, all(m).map(i => i.id));
  const rec = meetings.writeRecord(m.id).recordPath;
  const dashboards = await import('../server/core/dashboards.js');
  const record = await import('../server/core/meetingrecord.js');
  const read = dashboards.readMeetings(project).find(x => x.file === rec);
  assert.ok(read, 'the record is read');
  const now = meetings.get(m.id);
  assert.equal(read.date, now.date); assert.equal(read.title, now.title);
  // every heading comes back with exactly the item lines that were written for the kept items
  assert.deepEqual(Object.keys(read.sections), now.skills.map(s => s.heading));
  for (const s of now.skills) assert.deepEqual(read.sections[s.heading], record.parse(fs.readFileSync(rec, 'utf8')).sections[s.heading]);
  assert.deepEqual(read.sections['Key points'], ['The vendor is a risk']);
  assert.deepEqual(read.sections['Action items'], ['Send the budget (owner: Dana; due: Friday, 2026-11-13)']);
  // the writer and the reader share the one definition
  const front = { date: '2026-01-02', title: 'T' };
  const items = [{ label: 'Risk', text: 'a', details: ['impact: b'], quote: 'q' }, { text: 'c', quote: 'r' }];
  const back = record.parse(record.format(front, [{ heading: 'Risks', items }, { heading: 'Empty', items: [] }]), '/x/2026-01-02 T.md');
  assert.deepEqual(back.sections, { Risks: items.map(record.itemText), Empty: [] });
  assert.deepEqual([back.date, back.title], ['2026-01-02', 'T']);
  assert.equal(record.parse('## H\n\n- x\n', '/p/2026-03-04 Name here.md').title, 'Name here', 'file name fallback');
});

test('recording with nothing kept is refused, unless the person says so; a normal record is unchanged', async () => {
  reset();
  const m = meetings.get(await drop());
  assert.ok(all(m).every(i => i.accepted == null));
  assert.throws(() => meetings.writeRecord(m.id), e => e.status === 400 && /Nothing is ticked/.test(e.message));
  assert.throws(() => meetings.writeRecord(m.id, { empty: false }), e => e.status === 400);
  assert.equal(meetings.get(m.id).status, 'review', 'the meeting stays in review');
  assert.ok(!meetings.get(m.id).recordPath, 'nothing was written');
  // leaving every item out is the same as ticking nothing
  meetings.patch(m.id, { items: all(m).map(i => ({ id: i.id, accepted: false })) });
  assert.throws(() => meetings.writeRecord(m.id), e => e.status === 400);
  // the explicit empty record
  const r = meetings.writeRecord(m.id, { empty: true });
  assert.match(fs.readFileSync(r.recordPath, 'utf8'), /_Nothing was kept here\._/);
  assert.equal(meetings.get(m.id).status, 'recorded');
  // a normal record with one item kept needs no flag
  const m2 = meetings.get(await drop());
  accept(m2, [all(m2)[0].id]);
  assert.match(fs.readFileSync(meetings.writeRecord(m2.id).recordPath, 'utf8'), /- The vendor is a risk/);
});

test('a dashboard cell shows the words of a record item, not its Markdown markers, and never turns text into markup', async () => {
  const dir = path.join(folder, 'Jade', 'Meetings');
  fs.mkdirSync(dir, { recursive: true });
  const rec = path.join(dir, '2026-11-20 Markers.md');
  fs.writeFileSync(rec, `---\ndate: 2026-11-20\nproject: Helios\ntitle: Markers\n---\n## Risks and issues\n\n- **Risk:** The supplier may be _late_ with \`part-9\` <script>alert(1)</script> (impact: high; owner: Dana)\n  > the supplier\n- **Issue:** snake_case_name and 2*3*4 stay as written\n  > x\n`);
  const dashboards = await import('../server/core/dashboards.js');
  const row = dashboards.collect(project).sources.meetings.find(x => x._path === rec);
  assert.equal(row._lists.risks[0], 'Risk: The supplier may be late with part-9 <script>alert(1)</script> (impact: high; owner: Dana)');
  assert.equal(row._lists.risks[1], 'Issue: snake_case_name and 2*3*4 stay as written');
  assert.ok(!/\*\*|`/.test(row._lists.risks.join('')));
});
