// Skeptic on a chat reply, when the user asks for it ("okay, have Skeptic check it") or presses the button on a reply. Skeptic
// gets what Jade had to go on (the request, the recent conversation, the context Jade was given and the files it read) and what
// Jade produced (the reply and the files it created or changed), and checks it against agents/chat/criteria.md with the same
// evidence rules as everywhere else. Its verdict is a short message in the chat; "fix it" sends Jade back with the notes.
import fs from 'node:fs';
import path from 'node:path';
import * as config from './config.js';
import * as store from './store.js';
import * as agents from './agents.js';
import * as skeptic from './skeptic.js';
import * as agentfiles from './agentfiles.js';
import * as jobsMod from './jobs.js';
import { buildRounds, buildDue } from './chatreply.js';

export const WORKFLOW = 'chat';
export const criteriaPath = () => agentfiles.find(WORKFLOW, 'criteria.md') || undefined; // yours, then built in
const lessonsPath = () => path.join(config.JADE_HOME, WORKFLOW, 'lessons');
const cap = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '\n[… cut]' : String(s || ''));
const readFile = f => { try { const st = fs.statSync(f); return st.isFile() && st.size < 2e6 ? fs.readFileSync(f, 'utf8') : ''; } catch { return ''; } };

/** Asking for Skeptic in a chat message: "have Skeptic check it", "skeptic, review that", "run it past skeptic". */
export const ASK = /\bskeptic\b/i;
export function asksForSkeptic(message) {
  const m = String(message || '');
  return ASK.test(m) && /\b(check|review|verify|look|vet|audit|go over|run (it|this|that) (past|by|through))\b/i.test(m) && m.length < 300;
}

/** The reply to check: the given one, else the latest reply from Jade that is not a Skeptic note. */
export function replyToCheck(thread, at) {
  const turns = thread?.turns || [];
  const i = at ? turns.findIndex(t => t.at === at && t.role === 'jade') : turns.map((t, k) => [t, k]).filter(([t]) => t.role === 'jade' && t.skeptic !== true && !t.auto).map(([, k]) => k).pop() ?? -1;
  if (i < 0) return null;
  const request = turns.slice(0, i).reverse().find(t => t.role === 'user' && !asksForSkeptic(t.text));
  return { reply: turns[i], index: i, request, earlier: turns.slice(Math.max(0, i - 7), i).filter(t => t !== request && t.skeptic !== true) };
}

/** Run Skeptic on one reply. Writes its verdict into the chat and onto the reply. */
export async function checkTurn({ input = {}, signal, log = () => {} } = {}) {
  if (input.build) return checkBuild({ input, signal, log });
  const thread = store.getThread(input.thread);
  const found = replyToCheck(thread, input.at);
  if (!found) {
    store.appendTurn(input.thread, { role: 'jade', text: '_Skeptic: there is no reply from Jade here to check yet._', skeptic: true, auto: true });
    return { summary: 'Nothing to check' };
  }
  const { reply, request, earlier } = found;
  const job = reply.job && jobsMod.get(reply.job);
  log('Gathering what Jade had to go on…\n');
  // what Jade was given for that message, rebuilt the same way (projects, memory and so on, as the message called for)
  let context = '';
  try { const prep = await agents.prepare(agents.get('jade'), { message: request?.text || '', thread: input.thread }); context = prep.prompt; } catch (e) { context = `(could not rebuild: ${e.message})`; }
  const read = [...new Set((job?.tools || []).filter(t => t.name === 'Read' && t.detail).map(t => t.detail))].slice(0, 8);
  const changed = (reply.touched || []).slice(0, 8);
  const source = {
    request: request?.text || '(no message: the user sent an attachment)',
    attachments: [...(request?.files || []), ...(request?.images || [])].map(f => path.basename(f)),
    earlier_conversation: earlier.map(t => `${t.role === 'user' ? 'User' : 'Jade'}: ${cap(t.text, 1500)}`),
    context_jade_was_given: cap(context, 24000),
    files_jade_read: read.map(f => ({ path: f, content: cap(readFile(f), 6000) })),
  };
  const output = {
    reply: cap(reply.text, 12000),
    files_changed: changed.map(t => ({ path: t.path, new: !!t.isNew, content_now: cap(readFile(t.path), 6000) })),
  };
  log('Skeptic is checking…\n');
  const v = await skeptic.verify({ workflowId: WORKFLOW, criteriaPath: criteriaPath(), lessonsPath: lessonsPath(), items: [{ item_id: 'R1', source, output }], vars: { name: config.get().name || 'the user' }, signal });
  const r = v.verdicts.R1;
  const failed = (r.per_criterion || []).filter(c => c.result === 'fail');
  const titles = Object.fromEntries(skeptic.parseCriteria(readFile(criteriaPath())).criteria.map(c => [c.id, c.title]));
  const text = r.verdict === 'pass'
    ? `**Skeptic:** checked it against what Jade had to go on. Nothing wrong found.`
    : r.verdict === 'blocked'
      ? `**Skeptic** could not check this reply: ${r.note || 'not enough to go on'}.`
      : [`**Skeptic** found ${failed.length || 'a'} problem${failed.length === 1 ? '' : 's'}:`,
        ...failed.map(c => `- **${titles[c.id] || c.id}**: ${c.reason}${c.evidence ? ` (“${cap(c.evidence, 160)}”)` : ''}`),
        r.note ? `\n${r.note}` : '', '', '_Say “fix it” and Jade will correct it, showing its evidence._'].filter(s => s !== undefined).join('\n');
  store.markTurn(input.thread, reply.at, { skeptic: { verdict: r.verdict, failed: failed.map(c => c.id), at: new Date().toISOString() } });
  store.appendTurn(input.thread, { role: 'jade', text, skeptic: true, auto: true, verdict: r.verdict });
  return { summary: `Skeptic: ${r.verdict}${failed.length ? ` (${failed.map(c => c.id).join(', ')})` : ''}`, verdict: r.verdict, model: v.model };
}

// ------------------------------------------------------------------ the build loop
// The user's rule: whenever Jade builds something, it works in a loop (build, check, fix, check again), and Skeptic reviews it
// for completion against the instructions and the plan agreed in the chat. A build is a chat reply that created or changed files.
// Skeptic checks every reply of the build and the files as they are now against agents/build/criteria.md; anything that fails
// goes back to Jade as a fix round with Skeptic's notes, and the fix is checked again. The loop ends on a pass, when Skeptic
// cannot check it, when the user has moved on, or after build.rounds checks, when it is the user's call.
export { buildRounds, buildDue };   // the build loop's rules live with the chat reply (chatreply.js)
export const BUILD = 'build';
export const buildCriteriaPath = () => agentfiles.find(BUILD, 'criteria.md') || undefined; // yours, then built in
const buildLessonsPath = () => path.join(config.JADE_HOME, BUILD, 'lessons');
let sendBack = opts => jobsMod.enqueue(opts);
/** Tests replace how a fix round is started, so no real engine runs. */
export const useSendBack = fn => { sendBack = fn || (opts => jobsMod.enqueue(opts)); };

/** Skeptic on a build: the request, the plan in the conversation before it, every reply on it and the files as they are now. */
export async function checkBuild({ input = {}, signal, log = () => {} } = {}) {
  const thread = store.getThread(input.thread);
  const turns = thread?.turns || [];
  const round = Number(input.round) || 1, rounds = buildRounds();
  const note = (text, extra = {}) => store.appendTurn(input.thread, { role: 'jade', text, skeptic: true, auto: true, build: true, step: true, ...extra });   // step: folded away in the chat; Jade's summary is what the user reads
  const replyI = turns.findIndex(t => t.role === 'jade' && t.job === input.job);
  if (replyI < 0) return { summary: 'The build reply is gone' };
  const reqI = input.requestAt ? turns.findIndex(t => t.role === 'user' && t.at === input.requestAt)
    : turns.slice(0, replyI).map((t, k) => [t, k]).filter(([t]) => t.role === 'user' && !t.auto && !asksForSkeptic(t.text)).map(([, k]) => k).pop() ?? -1;
  const request = turns[reqI];
  const replies = turns.slice(reqI + 1, replyI + 1).filter(t => t.role === 'jade' && t.skeptic !== true && !t.auto);
  const files = [...new Map(replies.flatMap(t => t.touched || []).map(t => [t.path, t])).values()].slice(0, 10);
  log('Gathering the request, the plan and what was built…\n');
  let context = '';
  try { const prep = await agents.prepare(agents.get('jade'), { message: request?.text || '', thread: input.thread }); context = prep.prompt; } catch (e) { context = `(could not rebuild: ${e.message})`; }
  const source = {
    request: request?.text || '(no message: the user sent an attachment)',
    earlier_conversation: turns.slice(Math.max(0, reqI - 12), Math.max(0, reqI)).filter(t => t.skeptic !== true).map(t => `${t.role === 'user' ? 'User' : 'Jade'}: ${cap(t.text, 1500)}`),
    context_jade_was_given: cap(context, 16000),
  };
  const output = {
    replies: replies.map(t => cap(t.text, 6000)),
    files_changed: files.map(t => ({ path: t.path, new: !!t.isNew, content_now: cap(readFile(t.path), 8000) })),
  };
  log(`Skeptic is checking the build (check ${round} of ${rounds})…\n`);
  const objections = input.objections || [];
  const v = await skeptic.verify({ workflowId: BUILD, criteriaPath: buildCriteriaPath(), lessonsPath: buildLessonsPath(), items: [{ item_id: 'B1', source, output, earlier: objections }], vars: { name: config.get().name || 'the user' }, signal });
  const r = v.verdicts.B1;
  const failed = (r.per_criterion || []).filter(c => c.result === 'fail');
  const titles = Object.fromEntries(skeptic.parseCriteria(readFile(buildCriteriaPath())).criteria.map(c => [c.id, c.title]));
  store.markTurn(input.thread, turns[replyI].at, { skeptic: { verdict: r.verdict, failed: failed.map(c => c.id), at: new Date().toISOString(), build: true } });
  const done = { summary: `Skeptic build check ${round}/${rounds}: ${r.verdict}${failed.length ? ` (${failed.map(c => c.id).join(', ')})` : ''}`, verdict: r.verdict, round, model: v.model };
  // When the checks are over, Jade closes the build with a short summary in plain words, so the user is not left to work out what
  // Skeptic's notes mean or what to do next. The notes and the fix rounds fold away in the chat (turn.step); the summary stays.
  const wrapUp = (outcome, open = []) => {
    const caught = objections.flatMap(o => (o.failed || []).map(c => `${titles[c.id] || c.id}: ${cap(c.reason, 200)}`));
    const message = [
      'The build has been checked by Skeptic and the checks are over. Write the closing summary for the user now, in plain everyday words (they are not technical). Do not repeat your earlier replies, do not change any files and do not start sub-agents.',
      'Use exactly these four short parts, one to three lines each: **What was done** · **How it was checked** (Skeptic: how many checks, what it caught, whether that was fixed) · **Still open** (anything undone or needing the user\'s decision; write "Nothing" if none) · **Next** (the one thing you recommend they do now).',
      `The request: "${cap(request?.text || '', 1200)}"`,
      `Result of the checks: ${outcome}`,
      files.length ? `Files changed: ${files.map(t => path.basename(t.path)).join(', ')}` : '',
      caught.length ? `Skeptic caught earlier: ${caught.slice(0, 6).join('; ')}` : 'Skeptic caught nothing in the earlier checks.',
      open.length ? `Still open after the last check: ${open.slice(0, 6).join('; ')}` : '',
    ].filter(Boolean).join('\n');
    sendBack({ agent: 'jade', input: { message, thread: input.thread, via: 'text', route: 'chat', auto: true, wrapUp: true, requestAt: request?.at || '' },
      trigger: 'build-loop', title: 'Summing up the build', model: thread?.model || undefined });
  };
  if (r.verdict === 'pass') { note(`**Skeptic** checked the build against your request and the plan: complete${round > 1 ? ` after ${round} checks` : ''}.`, { verdict: 'pass', label: `Skeptic check ${round}: complete` }); wrapUp(`complete${round > 1 ? ` after ${round} checks` : ' on the first check'}.`); return done; }
  if (r.verdict === 'blocked') { note(`**Skeptic** could not check this build: ${r.note || 'not enough to go on'}. It is your call.`, { verdict: 'blocked', label: 'Skeptic could not check this build' }); wrapUp(`Skeptic could not check it (${r.note || 'not enough to go on'}), so it is not confirmed complete.`); return done; }
  const problems = failed.map(c => `- **${titles[c.id] || c.id}**: ${c.reason}${c.evidence ? ` (“${cap(c.evidence, 160)}”)` : ''}`);
  const head = [`**Skeptic** found the build is not complete yet (check ${round} of ${rounds}):`, ...problems, r.note ? `\n${r.note}` : ''].join('\n');
  // the user has written since: the build is theirs to pick up, not Jade's to keep working on behind them
  const movedOn = turns.slice(replyI + 1).some(t => t.role === 'user' && !t.auto);
  if (movedOn || round >= rounds) {
    note(`${head}\n\n_${movedOn ? 'You have moved on, so Jade has not been sent back.' : `That was the last of ${rounds} checks, so it is your call now.`} Say “fix it” and Jade will try again, or tell it what to change._`, { verdict: r.verdict, label: movedOn ? 'Skeptic found problems; you had moved on' : `Skeptic check ${round}: ${failed.length} problem${failed.length === 1 ? '' : 's'} left open`, ...(movedOn ? { step: false } : {}) });
    if (!movedOn) wrapUp(`not complete after ${round} checks, the last allowed, so it is the user\'s call.`, failed.map(c => `${titles[c.id] || c.id}: ${cap(c.reason, 200)}`));
    return done;
  }
  note(`${head}\n\n_Sent back to Jade to fix. The fix is checked again._`, { verdict: r.verdict, label: `Skeptic check ${round}: ${failed.length} problem${failed.length === 1 ? '' : 's'}, sent back to fix` });
  const sent = [...objections, { round, note: r.note || '', failed: failed.map(c => ({ id: c.id, reason: c.reason, evidence: c.evidence })) }];
  const message = [`Skeptic checked what you built for this request and found it is not complete yet. Fix each problem below in the files themselves, then say in one line each what you changed and how you checked it. If a problem is wrong, say so and quote the request or the plan that shows it. Do not start anything new.`,
    `The request: "${cap(request?.text || '', 1500)}"`, 'Problems:', ...failed.map(c => `- ${c.id} ${titles[c.id] || ''}: ${c.reason}${c.evidence ? ` (“${cap(c.evidence, 200)}”)` : ''}`), r.note ? `Skeptic's note: ${r.note}` : ''].filter(Boolean).join('\n');
  sendBack({ agent: 'jade', input: { message, thread: input.thread, via: 'text', route: 'chat', auto: true, buildFix: true, round, requestAt: request?.at || '', objections: sent },
    trigger: 'build-loop', title: `Fixing the build (check ${round} of ${rounds})`, model: thread?.model || undefined });
  return { ...done, sentBack: true };
}
