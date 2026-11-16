// Skeptic in chat, on request: which messages ask for it, which reply it checks, what it is shown, how its verdict lands in the
// chat, and that every verdict is logged for its page. The engine is a fake; real-model checks are not run here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-skeptic-chat-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
config.save({ name: 'Sam' });
const store = await import('../server/core/store.js');
const judge = await import('../server/core/judge.js');
const skeptic = await import('../server/core/skeptic.js');
const review = await import('../server/core/review.js');
const agents = await import('../server/core/agents.js');

const C = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
// turns are found by their time, and real ones are seconds apart; a few milliseconds keeps these apart too
let clock = Date.parse('2026-06-01T09:00:00Z');   // each turn is a second later than the last: no waiting, and the order is certain
const say = (cid, turn) => store.appendTurn(cid, { at: new Date(clock += 1000).toISOString(), ...turn });
let seen = null;
// Skeptic, faked: fails C3 when the reply claims a file that is not in files_changed, else passes.
judge.use(({ prompt, label }) => {
  assert.equal(label, 'Skeptic');
  const version = /criteria_version: (\w+)/.exec(prompt)[1];
  const [item] = JSON.parse(prompt.slice(prompt.indexOf('# Items') + 7));
  seen = item;
  const per = C.map(id => ({ id, result: 'n/a', evidence: '', reason: 'does not apply' }));
  per[0] = { id: 'C1', result: 'pass', evidence: item.source.request, reason: 'it was answered' };
  const claimsFile = /I created (\S+)/.exec(item.output.reply);
  if (claimsFile && !item.output.files_changed.length) {
    per[2] = { id: 'C3', result: 'fail', evidence: `I created ${claimsFile[1]}`, reason: 'no such file was written' };
    return { data: { workflow_id: 'chat', criteria_version: version, verdicts: [{ item_id: 'R1', verdict: 'fix_output', note: 'Write the file or stop saying it exists.', per_criterion: per }] }, model: 'fake-opus' };
  }
  return { data: { workflow_id: 'chat', criteria_version: version, verdicts: [{ item_id: 'R1', verdict: 'pass', note: '', per_criterion: per }] }, model: 'fake-opus' };
});

test('asking for Skeptic in a chat is recognised; mentioning it is not enough', () => {
  for (const m of ['okay lets have skeptic check it', 'Skeptic, review that', 'can skeptic verify this?', 'run it past skeptic'])
    assert.equal(review.asksForSkeptic(m), true, m);
  for (const m of ['what is skeptic?', 'check the budget numbers', 'tell me about the skeptic agent'])
    assert.equal(review.asksForSkeptic(m), false, m);
});

test('the reply checked is the last one from Jade, and the request is the message before it, not the ask for Skeptic', () => {
  const t = store.newThread('t');
  say(t.id, { role: 'user', text: 'Summarise the risks for Atlas' });
  say(t.id, { role: 'jade', text: 'There are three risks.' });
  say(t.id, { role: 'user', text: 'have skeptic check it' });
  const f = review.replyToCheck(store.getThread(t.id));
  assert.equal(f.reply.text, 'There are three risks.');
  assert.equal(f.request.text, 'Summarise the risks for Atlas');
});

test('a reply that claims a file it never wrote fails, and the chat says what is wrong and how to fix it', async () => {
  const t = store.newThread('t2');
  say(t.id, { role: 'user', text: 'Write the status report to a file' });
  say(t.id, { role: 'jade', text: 'Done. I created status.md with this week\'s update.' });
  say(t.id, { role: 'user', text: 'okay lets have skeptic check it' });
  const r = await review.checkTurn({ input: { thread: t.id } });
  assert.equal(r.verdict, 'fix_output');
  assert.equal(seen.source.request, 'Write the status report to a file');
  assert.ok('context_jade_was_given' in seen.source && 'files_jade_read' in seen.source, 'Skeptic sees what Jade had to go on');
  assert.deepEqual(seen.output.files_changed, []);
  const turns = store.getThread(t.id).turns;
  const note = turns.at(-1);
  assert.equal(note.skeptic, true);
  assert.match(note.text, /Only what was done/); assert.match(note.text, /fix it/);
  assert.equal(turns.find(x => x.text.startsWith('Done.')).skeptic.verdict, 'fix_output', 'the reply is marked');
});

test('a sound reply passes, and Skeptic\'s own note is never what gets checked next', async () => {
  const t = store.newThread('t3');
  say(t.id, { role: 'user', text: 'What is 2 and 2?' });
  say(t.id, { role: 'jade', text: 'Four.' });
  const r = await review.checkTurn({ input: { thread: t.id } });
  assert.equal(r.verdict, 'pass');
  assert.match(store.getThread(t.id).turns.at(-1).text, /Nothing wrong found/);
  assert.equal(review.replyToCheck(store.getThread(t.id)).reply.text, 'Four.');
});

test('every verdict, from any workflow, is in Skeptic\'s log', () => {
  const h = skeptic.history();
  assert.deepEqual(h.map(v => [v.workflow, v.verdict]), [['chat', 'fix_output'], ['chat', 'pass']]);
  assert.deepEqual(h[0].failed, ['C3']);
  assert.equal(h[0].model, 'fake-opus');
});

test('the chat criteria pass their own check', () => {
  const p = skeptic.parseCriteria(fs.readFileSync(review.criteriaPath(), 'utf8'));
  assert.deepEqual(p.problems, []); assert.deepEqual(p.criteria.map(c => c.id), C); assert.equal(p.workflow, 'chat');
});

test('Skeptic is on the Agents page as a verifier, and not something a chat can start on its own', () => {
  const s = agents.get('skeptic');
  assert.equal(s.kind, 'verifier'); assert.equal(s.hidden, false); assert.equal(s.schedule, '');
});
