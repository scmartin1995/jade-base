// The build loop: a chat reply that created or changed files is checked by Skeptic for completion against the request and the
// plan agreed in the chat; a failed check sends it back to Jade to fix, the fix is checked again, and after build.rounds checks
// (or once the user has moved on) it is the user's call. The engine is a fake; real-model checks are not run here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-build-loop-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
config.save({ name: 'Alex' });
const store = await import('../server/core/store.js');
const judge = await import('../server/core/judge.js');
const skeptic = await import('../server/core/skeptic.js');
const review = await import('../server/core/review.js');
const permissions = await import('../server/core/permissions.js');

const C = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11'];
let clock = Date.parse('2026-06-01T09:00:00Z');   // each turn is a second later than the last: no waiting, and the order is certain
const say = (cid, turn) => store.appendTurn(cid, { at: new Date(clock += 1000).toISOString(), ...turn }).turns.at(-1);
const sent = [];
review.useSendBack(opts => { sent.push(opts); return { id: 'fix' }; });
let seen = null;
// Skeptic, faked: fails C3 while a changed file still says TODO, else passes.
judge.use(({ prompt, label }) => {
  assert.equal(label, 'Skeptic');
  const version = /criteria_version: (\w+)/.exec(prompt)[1];
  const [item] = JSON.parse(prompt.slice(prompt.indexOf('# Items') + 7));
  seen = item;
  const per = C.map(id => ({ id, result: 'n/a', evidence: '', reason: 'does not apply' }));
  per[0] = { id: 'C1', result: 'pass', evidence: item.source.request, reason: 'asked for' };
  const todo = item.output.files_changed.find(f => /TODO/.test(f.content_now));
  if (todo) {
    per[2] = { id: 'C3', result: 'fail', evidence: 'TODO: totals', reason: 'the totals section is not written' };
    return { data: { workflow_id: 'build', criteria_version: version, verdicts: [{ item_id: 'B1', verdict: 'fix_output', note: 'Write the totals.', per_criterion: per }] }, model: 'fake-opus' };
  }
  return { data: { workflow_id: 'build', criteria_version: version, verdicts: [{ item_id: 'B1', verdict: 'pass', note: '', per_criterion: per }] }, model: 'fake-opus' };
});

const file = path.join(process.env.JADE_HOME, 'work', 'report.md');
fs.mkdirSync(path.dirname(file), { recursive: true });
const touched = [{ path: file, isNew: true }];

test('a reply that changed files starts the loop; a reply that changed nothing, or one the app sent itself, does not', () => {
  assert.deepEqual(review.buildDue({ input: { thread: 'c1' }, touched }), { round: 1 });
  assert.equal(review.buildDue({ input: { thread: 'c1' }, touched: [] }), null);
  assert.equal(review.buildDue({ input: { thread: 'c1', auto: true }, touched }), null);
  // a fix round is always checked again, until the last round
  assert.deepEqual(review.buildDue({ input: { thread: 'c1', auto: true, buildFix: true, round: 1 }, touched: [] }), { round: 2 });
  assert.equal(review.buildDue({ input: { thread: 'c1', auto: true, buildFix: true, round: 3 }, touched }), null);
  config.save({ build: { loop: false } });
  assert.equal(review.buildDue({ input: { thread: 'c1' }, touched }), null, 'the setting turns it off');
  config.save({ build: { loop: true } });
});

test('an unfinished build is sent back with Skeptic\'s notes, and the fix that finishes it passes', async () => {
  const t = store.newThread('build');
  say(t.id, { role: 'user', text: 'Plan: a report with a summary and totals.' });
  say(t.id, { role: 'jade', text: 'Agreed: summary first, then totals.' });
  const req = say(t.id, { role: 'user', text: 'Build the report as planned' });
  fs.writeFileSync(file, '# Report\nSummary here.\nTODO: totals\n');
  say(t.id, { role: 'jade', text: 'I created report.md.', job: 'j1', touched });
  const r1 = await review.checkTurn({ input: { thread: t.id, build: true, job: 'j1', round: 1 } });
  assert.equal(r1.verdict, 'fix_output'); assert.equal(r1.sentBack, true);
  assert.equal(seen.source.request, 'Build the report as planned');
  assert.ok(seen.source.earlier_conversation.some(l => l.includes('summary first, then totals')), 'Skeptic sees the plan agreed in the chat');
  assert.match(store.getThread(t.id).turns.at(-1).text, /not complete yet \(check 1 of 3\)[\s\S]*Finished, not partial/);
  const fix = sent.at(-1);
  assert.equal(fix.agent, 'jade');
  assert.equal(fix.input.buildFix, true); assert.equal(fix.input.auto, true); assert.equal(fix.input.requestAt, req.at);
  assert.match(fix.input.message, /C3 Finished, not partial/);
  assert.equal(fix.input.objections.length, 1);

  // the fix round: Jade finishes the file, and the second check sees both replies and passes
  fs.writeFileSync(file, '# Report\nSummary here.\nTotals: 12.\n');
  say(t.id, { role: 'jade', text: 'Wrote the totals; re-read it against the plan.', job: 'j2', touched });
  const r2 = await review.checkTurn({ input: { thread: t.id, build: true, job: 'j2', round: 2, requestAt: fix.input.requestAt, objections: fix.input.objections } });
  assert.equal(r2.verdict, 'pass');
  assert.equal(seen.output.replies.length, 2, 'every reply on the build is checked together');
  assert.match(store.getThread(t.id).turns.at(-1).text, /complete after 2 checks/);
  assert.equal(sent.filter(s => s.input.buildFix).length, 1, 'a pass sends nothing back to be fixed');
  const wrap = sent.at(-1);
  assert.equal(wrap.input.wrapUp, true); assert.equal(wrap.input.auto, true);
  assert.match(wrap.input.message, /complete after 2 checks/); assert.match(wrap.input.message, /Finished, not partial/); assert.match(wrap.input.message, /report\.md/);
  assert.match(wrap.input.message, /Still open/); assert.match(wrap.input.message, /Next/);
  assert.ok(store.getThread(t.id).turns.filter(x => x.skeptic === true).every(n => n.step === true && n.label), 'Skeptic\'s notes fold away');
});

test('after the last check, or once the user has moved on, it is the user\'s call', async () => {
  const before = sent.length;
  const t = store.newThread('build2');
  say(t.id, { role: 'user', text: 'Build the report' });
  fs.writeFileSync(file, 'TODO: totals\n');
  say(t.id, { role: 'jade', text: 'I created report.md.', job: 'k1', touched });
  const last = await review.checkTurn({ input: { thread: t.id, build: true, job: 'k1', round: 3 } });
  assert.equal(last.verdict, 'fix_output'); assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1).input.wrapUp, true); assert.match(sent.at(-1).input.message, /Still open after the last check: .*Finished, not partial/);
  assert.match(store.getThread(t.id).turns.at(-1).text, /last of 3 checks/);

  say(t.id, { role: 'jade', text: 'I created report.md again.', job: 'k2', touched });
  say(t.id, { role: 'user', text: 'never mind, something else' });
  const moved = await review.checkTurn({ input: { thread: t.id, build: true, job: 'k2', round: 1 } });
  assert.equal(moved.verdict, 'fix_output'); assert.equal(sent.length, before + 1, 'no summary is sent into a conversation the user has left');
  assert.notEqual(store.getThread(t.id).turns.at(-1).step, true, 'that note stays in view');
  assert.match(store.getThread(t.id).turns.at(-1).text, /You have moved on/);
});

test('the build criteria pass their own check, are logged as their own workflow, and no run may edit them', () => {
  const p = skeptic.parseCriteria(fs.readFileSync(review.buildCriteriaPath(), 'utf8'));
  assert.deepEqual(p.problems, []); assert.deepEqual(p.criteria.map(c => c.id), C); assert.equal(p.workflow, 'build');
  assert.ok(skeptic.history().some(v => v.workflow === 'build' && v.verdict === 'pass'));
  assert.equal(permissions.isAgentOwned(path.join(config.JADE_HOME, 'build', 'criteria.md')), true);
});
