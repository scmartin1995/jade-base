// What a Claude session (through bridge/jade-bridge.mjs) needs from Jade that the ordinary routes do not already give:
// a one-call status, a hand-off brief written to a file, a question put to Jade, and a routine started by id.
// Nothing here sends mail, deletes anything or edits a user's file.
import fs from 'node:fs';
import path from 'node:path';
import * as config from './config.js';
import * as store from './store.js';
import * as jobs from './jobs.js';
import * as agents from './agents.js';
import * as modules from './modules.js';
import { mayRun } from './mayrun.js';
import { slug, truncate, ensureDir, today } from './util.js';
import { foldersOf } from './locations.js';

export const MAX_TEXT = 100000;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const text = v => String(v ?? '').trim();

/** The open items a project or the whole organiser holds. Shared with the client's no-server fallback by shape, not by code. */
export function status() {
  const open = store.listActions().filter(a => a.status !== 'done').length;
  return {
    platform: process.platform,
    counts: { actionsOpen: open },
  };
}

const stamp = (d = new Date()) => { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; };

/** Write a brief file for a Claude session: the task, the project's folders, the open actions, and what "done" means. */
export function handoff({ action, project, text: free } = {}) {
  const act = action ? store.listActions().find(a => a.id === text(action)) : null;
  if (action && !act) throw bad('No action ' + text(action), 404);
  const pid = act?.project || text(project);
  const proj = pid ? store.getProject(pid) : null;
  if (pid && !proj) throw bad('No project ' + pid, 404);
  const task = text(free) || act?.text || (proj ? `Work through what is open on ${proj.name}.` : '');
  if (!task) throw bad('Give an action, a project or some text');
  if (task.length > MAX_TEXT) throw bad('That text is too long', 413);
  const openList = store.listActions().filter(a => a.status !== 'done' && (!proj || a.project === proj.id) && a.id !== act?.id).slice(0, 25);
  const line = a => `- [${a.id}] ${a.text}${a.due ? ` (due ${a.due})` : ''}${a.priority && a.priority !== 'normal' ? ` [${a.priority}]` : ''}`;
  const folders = foldersOf(proj);
  const md = [
    `# Hand-off from Jade`, '',
    `Written ${new Date().toISOString()}. Jade is the organiser; the work happens in this Claude session.`, '',
    `## The task`, task, '',
    ...(act ? [`This task is action \`${act.id}\`${act.due ? `, due ${act.due}` : ''}.`, ''] : []),
    `## Project`, proj ? `${proj.name}` : '(no project named)', '',
    `## Project folders`, ...(folders.length ? folders.map(f => `- ${f}`) : ['- (none recorded)']), '',
    `## Open actions${proj ? ' on this project' : ''}`, ...(openList.length ? openList.map(line) : ['- (none)']), '',
    `## What done looks like`,
    '- The deliverable is saved where the project keeps its documents, and you say where.',
    '- You have checked it against the task above (open it, run it, or re-read it) and fix what falls short.',
    '- You tell the user in plain words what you did, what you did not check, and what they need to decide.',
    act ? `- Then mark action \`${act.id}\` done in Jade with a one-line note (tool \`jade_action_done\`).` : '- Then record anything left open in Jade (tool `jade_note_add`).',
    '',
  ].join('\n');
  const dir = ensureDir(path.join(config.JADE_HOME, 'handoffs'));
  const base = `${stamp()}-${slug(task).slice(0, 40)}`;
  let file = path.join(dir, base + '.md');
  for (let n = 2; ; n++) {
    try { fs.writeFileSync(file, md, { flag: 'wx' }); break; } catch (e) { if (e.code !== 'EEXIST') throw e; file = path.join(dir, `${base}-${n}.md`); }
  }
  return { path: file, prompt: `Read ${file} and carry out the task described there.` };
}

const GUARD = '(Asked from a Claude session. Answer the question only: do not create, change or delete any file and do not send anything.)\n';

/** Put a question to Jade in a new conversation; the answer arrives as the job's result. */
export function ask({ text: q } = {}) {
  const message = text(q);
  if (!message) throw bad('Say something first');
  if (message.length > MAX_TEXT) throw bad('That text is too long', 413);
  const thread = store.newThread('From Claude: ' + truncate(message, 40)).id;
  store.appendTurn(thread, { role: 'user', text: message, via: 'bridge' });
  const j = jobs.enqueue({ agent: 'jade', input: { message: GUARD + message, thread, via: 'text', route: 'bridge', askOnly: true }, trigger: 'chat', title: truncate(message, 70) });
  return { jobId: j.id, thread };
}

/** Start a routine Jade already has (not a hidden helper, a builder, a checker or an agent that runs from its own page). A per-project routine needs a project. */
export function run({ id, project } = {}) {
  // routines are the Routines module's: with it off there is nothing to list or start (the same 403 its page and routes give)
  modules.requireOn('routines');
  const def = agents.get(text(id));
  const may = def && mayRun({ agent: def }, 'bridge');
  const ok = def && !def.hidden && !def.loop && def.kind !== 'verifier' && def.kind !== 'builder' && may.reason !== 'module';
  if (!ok) throw bad('No routine ' + text(id), 404);
  if (may.reason === 'allow') throw bad(may.message, may.status);
  let input = {};
  if (def.input === 'project') {
    if (!text(project)) throw bad(`${def.name} needs a project`);
    if (!store.getProject(text(project))) throw bad('No project ' + text(project), 404);
    input = { project: text(project) };
  } else if (def.input && def.input !== 'none') throw bad(`${def.name} needs ${def.input}; start it from Jade`);
  const j = jobs.enqueue({ agent: def.id, input, trigger: 'manual' });
  return { jobId: j.id, title: j.title };
}

/** A note from a Claude session. Unlike POST /api/notes it never overwrites: a second note with the same title gets a -2. */
export function note({ text: body, project } = {}) {
  const t = text(body);
  if (!t) throw bad('Say what the note is');
  if (t.length > MAX_TEXT) throw bad('That text is too long', 413);
  const pid = text(project);
  if (pid && !store.getProject(pid)) throw bad('No project ' + pid, 404);
  const title = truncate(t.split('\n')[0].replace(/\s+/g, ' '), 60);
  const base = `${today()}-${slug(title)}`;
  let nid = base;
  for (let n = 2; store.getNote(nid); n++) nid = `${base}-${n}`;
  const saved = store.saveNote({ id: nid, title, body: t, project: pid, tags: ['from-claude'] });
  return { id: saved.id };
}
