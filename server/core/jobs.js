// Agent job queue (an idea from AIOS: one scheduler in front of the model so agents queue instead of piling up).
// Every run is a job with live output; the last 150 are kept in .state/jobs.json.
import path from 'node:path';
import * as config from './config.js';
import { emit } from './bus.js';
import { id, readJSON, writeText, debounce } from './util.js';
import * as engines from './engines.js';
import { redact, redactor } from './redact.js';
import { mayRun } from './mayrun.js';
import * as skillsMod from './skills.js';
import * as effortOf from './effort.js';
import * as agents from './agents.js';
import * as permissions from './permissions.js';
import * as checker from './checker.js';
import * as recent from './recent.js';
import * as chatreply from './chatreply.js';
import * as review from './review.js';
import * as subagents from './subagents.js';

// Agents that are loops run their own steps (each a locked-down engine run) instead of one prompt.
const LOOPS = new Map();
/** Add a kind of loop: an agent whose def names `loop: kind` runs fn({ input, signal, log }) instead of one prompt. */
export const register = (kind, fn) => { LOOPS.set(kind, fn); };
agents.useStarter(opts => enqueue(opts));   // a chat's run_agent action starts agents here (agents.js does not import this file)
register('skeptic-check', opts => review.checkTurn(opts));
permissions.setJobLookup(id => jobs.find(j => j.id === id) || jobs.find(j => j.status === 'running' && j.input?.thread === id));

const FILE = () => path.join(config.STATE, 'jobs.json');
const WRITES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']);
// The files this run has created or changed so far. A chat's records carry the conversation's id (its engine process outlives
// one message), any other run's carry its own; only those made since this run began count.
const touchedBy = (j, def, { final = false } = {}) => {
  const list = permissions.touches(def?.handler === 'chat' ? [j.id, j.input?.thread] : [j.id], j.startedAt).map(t => ({ ...t, name: path.basename(t.path) }));
  // A command (a script, sed, a redirect) can change files without going through Edit or Write, so Jade cannot know in advance. When
  // the run has ended, anything the folder watchers saw change while it ran is added: listed, but with no earlier version to restore.
  if (final && j.startedAt && ((j.tools || []).some(t => t.name === 'Bash') || j.subBash)) {
    const known = new Set(list.map(t => t.path.toLowerCase()));
    for (const f of recent.since(Date.parse(j.startedAt), Date.now())) {
      if (!known.has(f.path.toLowerCase())) list.push({ path: f.path, name: path.basename(f.path), isNew: false, byCommand: true });
    }
  }
  return list.slice(0, 40);
};
let jobs = [];
const controllers = new Map();
let running = 0;

export function init() {
  try { chatreply.startup(); } catch {}
  jobs = readJSON(FILE(), []).map(j => {
    if (j.status !== 'running' && j.status !== 'queued') return j;
    chatreply.interrupted(j);
    return { ...j, status: 'error', error: 'Interrupted by restart' };
  });
}

// what a run printed, its error and the details of its steps are shown and kept with any key hidden
const hide = (j, withOutput = true) => ({ ...j, ...(withOutput && j.output ? { output: redact(j.output) } : {}), ...(j.error ? { error: redact(j.error) } : {}),
  ...(j.tools?.length ? { tools: j.tools.map(t => ({ ...t, detail: redact(t.detail) })) } : {}) });
// The recent runs are kept in .state/jobs.json (compact). A finished run does not change, so what was written for it is kept and used again,
// instead of hiding keys in and writing out every run's text at each save.
const FINAL = ['done', 'error', 'cancelled'];
const saved = new WeakMap();   // run -> { sig, text } for a finished run
const runSig = j => [j.status, j.endedAt, (j.output || '').length, (j.tools || []).length, (j.touched || []).length, (j.agents || []).length, j.error || ''].join('|');
// The text of one run as it is written to jobs.json: every key hidden first, then cut to the last 20,000 characters, so a key the cut
// would have split is hidden whole and not half kept.
export const savedText = j => { const h = hide(j); return JSON.stringify(h.output ? { ...h, output: h.output.slice(-20000) } : h); };
const persist = debounce(() => {
  const parts = jobs.slice(0, 150).map(j => {
    const done = FINAL.includes(j.status) && j.endedAt, sig = done ? runSig(j) : '';
    if (done && saved.get(j)?.sig === sig) return saved.get(j).text;
    const text = savedText(j);
    if (done) saved.set(j, { sig, text });
    return text;
  });
  writeText(FILE(), `[${parts.join(',')}]`);
}, 800);
// What the page is told about a run. While it is going, the text so far is not repeated in every event (the page gets the new text as
// it is written, in job:text events, and the length here tells it whether it missed some); the finished run carries all of it.
const pub = j => { emit('job', event(j)); persist(); };
const strip = j => ({ ...hide(j), prompt: undefined });
const event = j => FINAL.includes(j.status) ? strip(j) : { ...strip({ ...j, output: '' }), output: undefined, outputLength: (j.output || '').length };

export function list() { return jobs.map(j => ({ ...hide(j, false), prompt: undefined, output: undefined, outputLength: (j.output || '').length })); }
// outputLength: the length of the text in this answer, counted as the job:text events count (from, at), so a page can join the two. The answer can be ahead of
// the events (the events hold back a short tail), never behind; the finished run's text is the truth.
export function get(jid) {
  const j = jobs.find(x => x.id === jid), r = j && strip(j);
  return r && { ...r, outputLength: (r.output || '').length };
}

// An automated agent (one Jade or the PM wrote, not a chat and not a loop that makes its own calls) uses the model chosen for
// automated agents in Settings (agents.model), or by its own file's `model:` key (checker.worker decides both), unless the run names one. Blank: the model Jade would pick anyway.
const agentsModel = def => (def.trusted && def.handler !== 'chat' && !def.loop ? checker.worker(def.id).model : '');

/** enqueue({ agent, input, trigger, title, model }) -> job */
export function enqueue({ agent, input = {}, trigger = 'manual', title, model }) {
  const def = agents.get(agent);
  if (!def) throw new Error('Unknown agent: ' + agent);
  // May it run, started this way? (module on, allowed, not changed since, runnable: see mayrun.js). A skill the skill runner is asked to use is checked too.
  const may = mayRun({ agent: def }, trigger);
  if (!may.ok) throw new Error(may.message);
  if (agent === 'skill-runner' && input?.skill) { const sk = skillsMod.list().find(x => x.name === input.skill); const s = sk && mayRun({ skill: sk }, trigger); if (s && !s.ok) throw new Error(s.message); }
  const j = { id: id('j'), agent, agentName: def.name, title: title || agents.titleFor(def, input), input, trigger,
    engine: 'claude', model: model || agentsModel(def), status: 'queued', output: '', tools: [], createdAt: new Date().toISOString() };
  jobs.unshift(j);
  if (jobs.length > 300) jobs.length = 300;
  pub(j);
  setImmediate(pump);
  return strip(j);
}

/** A new run of an earlier job, with the same agent, input, title and model. Chats are resent from the chat itself. */
export function rerun(jid) {
  const old = jobs.find(x => x.id === jid);
  if (!old) throw Object.assign(new Error('That run is no longer in the list'), { status: 404 });
  if (old.status === 'running' || old.status === 'queued') throw Object.assign(new Error('That run is still going'), { status: 409 });
  if (old.agent === 'jade') throw Object.assign(new Error('Send the message again from the chat'), { status: 400 });
  return enqueue({ agent: old.agent, input: old.input || {}, trigger: 'rerun', title: old.title, model: old.model || undefined });
}

/** Run and wait for the result (used by the chat endpoint). */
export function enqueueAndWait(opts) {
  const j = enqueue(opts);
  return new Promise(resolve => {
    const check = () => {
      const cur = jobs.find(x => x.id === j.id);
      if (!cur || ['done', 'error', 'cancelled'].includes(cur.status)) { clearInterval(t); resolve(cur); }
    };
    const t = setInterval(check, 300);
  });
}

export function cancel(jid) {
  const j = jobs.find(x => x.id === jid);
  if (!j) return;
  if (j.status === 'queued') { j.status = 'cancelled'; pub(j); }
  controllers.get(jid)?.abort();
}

// Chats start at once (a person is waiting); agents share the configured number of slots.
const isChat = j => chatreply.is(agents.get(j.agent));
function pump() {
  const limit = Math.max(1, Number(config.get().concurrency) || 2);
  for (const j of [...jobs].reverse()) if (j.status === 'queued' && isChat(j)) start(j);
  while (jobs.filter(j => j.status === 'running' && !isChat(j)).length < limit) {
    const next = [...jobs].reverse().find(j => j.status === 'queued');
    if (!next) return;
    start(next);
  }
}

// The launcher (jade.js) holds a code-change restart while anything is running, so a reply is never cut off half way.
const tellLauncher = () => { try { process.send?.({ running }); } catch {} };

async function start(j) {
  running++; tellLauncher();
  j.status = 'running'; j.startedAt = new Date().toISOString();
  const ac = new AbortController();
  controllers.set(j.id, ac);
  pub(j);
  let flushT = null, pending = '', released = 0;   // released: how much text has gone out (the page counts the same way, in from/at)
  // Text is released to the page, the stream and the live list only once any key in it can no longer be split by the next piece.
  const hider = redactor();
  const take = t => { j.output += t; pending += hider.push(t); if (!flushT) flushT = setTimeout(flush, 120); };
  // from/at: where this piece starts and ends in the released text, so a page that missed some (or got some twice) can tell
  const flush = (final = false) => { flushT = null; if (final) pending += hider.end(); if (pending) { const from = released; released += pending.length; emit('job:text', { id: j.id, text: pending, from, at: released }); pending = ''; } };
  try {
    const def = agents.get(j.agent);
    if (def.loop && LOOPS.has(def.loop)) {
      j.engine = 'claude';
      const log = take;
      j.result = await LOOPS.get(def.loop)({ input: j.input || {}, signal: ac.signal, log });
      flush(true);
      j.status = 'done';
      // a scheduled run that found nothing new leaves the run list after a minute, so a 15-minute schedule does not push out
      // every other run (the list keeps 150)
      if (j.result?.quiet && j.trigger === 'schedule') { j.quiet = true; setTimeout(() => { jobs = jobs.filter(x => x !== j); persist(); }, 60e3).unref?.(); }
      return;
    }
    j.engine = engines.pick(j.engine) || j.engine;
    const prep = await agents.prepare(def, j.input);
    j.connectors = prep.connectors;
    pub(j);
    const onText = take;
    const onTool = (name, detail, opt) => {
      // a tool a sub-agent used is not a step of this reply (the step count, "N tool calls"), but its writes still count as changes
      if (opt?.sub) { if (name === 'Bash') j.subBash = true; }
      else { j.tools.push({ name, detail, at: Date.now() }); pub(j); }
      // a file being written shows up in the chat as it is written, once Jade's permission tool has let the edit through
      if (WRITES.has(name)) setTimeout(() => { const t = touchedBy(j, def); if (t.length !== (j.touched || []).length) { j.touched = t; pub(j); } }, 700);
    };
    // Sub-agent work in this run (the Agent tool), for the chat's side panel: each hand-off with its steps and result.
    j.agents = [];
    let agentPub = null;
    const onAgent = ev => { subagents.apply(j.agents, ev); if (!agentPub) agentPub = setTimeout(() => { agentPub = null; pub(j); }, 250); };
    // Chats keep a warm Claude process per conversation (chatreply); everything else runs in a fresh process.
    const chat = chatreply.is(def);
    const effort = chat ? chatreply.effort(j) : (effortOf.forAgent(def) || undefined);   // automated work: agents.effort, or the agent file's jade-effort
    const settings = { connectors: prep.connectors, dirs: prep.dirs, model: j.model || '', system: prep.system, effort, edits: !!prep.edits, thread: j.input.thread || '', subagents: prep.subagents || '' };
    j.edits = !!prep.edits;
    const res = (chat && await chatreply.warmTurn(j, settings, prep, { onText, onTool, onAgent, signal: ac.signal }))
      || await engines.run({ noRead: prep.noRead, denyWeb: prep.denyWeb, model: j.model, effort, edits: !!prep.edits, job: j.id, subagents: prep.subagents || '', prompt: [prep.history, prep.prompt].filter(Boolean).join('\n\n'), system: prep.system, connectors: prep.connectors, dirs: prep.dirs, signal: ac.signal, onText, onTool, onAgent });
    j.warm = !!res.warm;
    flush(true);
    j.output = res.text || j.output;   // kept as it came (the handler reads it); anything shown or saved goes through redact in strip()
    j.engine = res.engine;
    j.model = res.model || j.model;
    // The files this run created or edited through Edit and Write (the ones Jade's permission tool sees), for the chat and the
    // activity list to show, with the kept earlier version each can be put back from. A chat's records carry the thread id.
    j.touched = touchedBy(j, def, { final: true });
    j.agents = subagents.slim(subagents.finish(j.agents || [], true));
    j.result = await agents.finish(def, j.input, j.output, j);
    j.status = 'done';
    if (chat) {
      const build = chatreply.afterReply(j);
      if (build) enqueue(build);
    }
  } catch (e) {
    flush(true);
    j.agents = subagents.slim(subagents.finish(j.agents || [], false));
    j.status = ac.signal.aborted ? 'cancelled' : 'error';
    j.error = redact(String(e.message || e));
    if (j.status !== 'done') { try { j.touched = touchedBy(j, agents.get(j.agent), { final: true }); } catch {} }   // what the reply changed up to now, not the list from up to 0.7 s ago
    chatreply.ended(j, e);
  } finally {
    j.endedAt = new Date().toISOString();
    permissions.forgetJob(j.id); permissions.forgetJob(j.input?.thread || '');
    controllers.delete(j.id);
    running--; tellLauncher();
    pub(j);
    setImmediate(pump);
  }
}
