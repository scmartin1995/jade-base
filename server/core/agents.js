// Agents are Claude Code agent files (see agentfiles.js): yours in <claude home>/agents, a project's .claude/agents, installed plugins',
// and Jade's built-ins in app/agents (run from there until installed). Front matter declares what context the agent gets, which official
// connectors it may use and how Jade applies its answer (jade-handler). Files reload on every run, so editing an agent takes effect at once.
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import * as config from './config.js';
import * as store from './store.js';
import * as memory from './memory.js';
import * as skills from './skills.js';
import * as agentfiles from './agentfiles.js';
import * as claudehome from './claudehome.js';
import * as engines from './engines.js';
import * as chatreply from './chatreply.js';
import * as modules from './modules.js';
import { mayRun } from './mayrun.js';
import * as permissions from './permissions.js';
import { parseFrontmatter, extractJSON, truncate, debounce, watchTree, guardedWatch, writeText } from './util.js';
import { foldersOf } from './locations.js';
import { emit, bus } from './bus.js';

export const list = () => agentfiles.discover();

export function get(aid) { return list().find(a => a.id === aid); }

/** The skills an agent owns: the ones on its skills: line. Its installed copy (jade-<id>-<skill>) first, then the one shipped in the repo, then any skill of that name. */
export function ownedSkills(def) {
  return skills.forAgent(def.skills, def.builtin ? def.id : '', { trustedOnly: mayRun({ agent: def }, 'offer').readOnly }).filter(s => s.enabled !== false);
}

// Builders (kind: builder, e.g. the Worker) are not run as jobs: they are Claude Code sub-agents that a chat able to edit files
// hands build tasks to, several at once if it likes. Their edits go through the same run, so Jade's permission tool keeps the
// previous versions and Skeptic checks every file they change as part of the chat's build.
/** The builders as the JSON Claude Code's --agents option takes, each with the full path of every skill it uses. */
export function builderAgents() {
  const out = {};
  for (const a of list().filter(x => x.kind === 'builder')) {
    const found = ownedSkills(a);
    // a description written as a YAML block (">" or "|") is not read by parseFrontmatter, so it is left out rather than shown as ">"
    const said = s => (/^[>|][-+]?$/.test(s.description.trim()) ? '' : `: ${truncate(s.description, 200)}`);
    const lines = found.map(s => `- ${s.name}${said(s)}\n  file: ${path.join(s.dir, 'SKILL.md')}`);
    out[a.id] = { description: a.description, prompt: `${a.body.trim()}\n\n## Skills\n${lines.join('\n') || '(none of its skills are installed)'}` };
  }
  return out;
}

/** The builders written to a file for --agents, named by its content so a changed agent file reaches the next run. '' if none. */
export function builderAgentsFile() {
  const defs = builderAgents();
  if (!Object.keys(defs).length) return '';
  const text = JSON.stringify(defs);
  const dir = path.join(config.STATE, 'tmp'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `agents-${crypto.createHash('sha256').update(text).digest('hex')}.json`);
  if (!fs.existsSync(f)) writeText(f, text);   // written whole, then moved into place, so a run never reads half a file
  return f;
}

export function titleFor(def, input = {}) {
  if (input.project) { const p = store.getProject(input.project); if (p) return `${def.name} · ${p.name}`; }
  if (input.skill) return `Skill · ${input.skill}`;
  if (input.message) return truncate(input.message, 70);
  if (input.files?.length) return truncate(`Sent ${path.basename(input.files[0])}${input.files.length > 1 ? ` and ${input.files.length - 1} more` : ''}`, 70);
  if (input.images?.length) return input.images.length === 1 ? 'Sent an image' : `Sent ${input.images.length} images`;
  if (input.note) { const n = store.getNote(input.note); if (n) return `${def.name} · ${n.title}`; }
  return def.name;
}

// ---------------------------------------------------------------- context
function projectBrief(p) {
  return `- ${p.name} (id: ${p.id})${p.description ? ' · ' + truncate(p.description, 120) : ''}${(p.folders || []).length ? ' · folders: ' + p.folders.join(', ') : ''}`;
}

function openActions(projectId) {
  const list = store.listActions().filter(a => a.status !== 'done' && (!projectId || a.project === projectId));
  if (!list.length) return '(none)';
  return list.slice(0, 40).map(a => `- [${a.id}] ${a.text}${a.owner ? ' · ' + a.owner : ''}${a.due ? ' · due ' + a.due : ''}${a.project ? ' · ' + a.project : ''}`).join('\n');
}

/** Add a context builder: agents whose context lists `name` get `## name` and fn({ input, usable }) in their prompt. */
export const addContext = (name, fn) => { builders[name] = fn; };
const builders = {
  profile: () => {
    const c = config.get();
    return `User: ${c.name || '(name not set)'} · role: ${c.role || 'project manager'}\nNow: ${new Date().toString()}\nComputer: ${os.platform()}\nYou are ${c.assistantName}, their assistant.`;
  },
  project: ({ input }) => {
    const p = store.getProject(input.project);
    if (!p) return '(project not found)';
    const { statusHistory, status, milestones, risks, ...rest } = p;   // old files may still carry these; they are not read
    const folders = (p.folders || []).length ? `\nProject folders you can read (look at recently changed files first): ${p.folders.join(', ')}` : '';
    return '```json\n' + JSON.stringify(rest, null, 2).slice(0, 12000) + '\n```' + folders;
  },
  projects: () => store.listProjects().filter(p => !p.archived).map(projectBrief).join('\n') || '(no projects yet)',
  'project-notes': ({ input }) => store.listNotes().filter(n => n.project === input.project).slice(0, 8)
    .map(n => `### ${n.title} (${n.updated.slice(0, 10)})\n${truncate(n.body, 1800)}`).join('\n\n') || '(no notes for this project)',
  notes: () => store.listNotes().slice(0, 10).map(n => `### ${n.title} (${n.updated.slice(0, 10)}${n.project ? ', ' + n.project : ''})\n${truncate(n.body, 900)}`).join('\n\n') || '(no notes)',
  note: ({ input }) => { const n = store.getNote(input.note); return n ? `# ${n.title}\nproject: ${n.project || '-'}\n\n${n.body}` : '(note not found)'; },
  'project-actions': ({ input }) => openActions(input.project),
  actions: () => openActions(),
  memory: ({ input }) => {
    const p = input.project && store.getProject(input.project);
    const q = [p?.name, p?.description, input.message, input.query, input.extra].filter(Boolean).join(' ') || 'priorities projects';
    return memory.contextFor(q, 6);
  },
  facts: () => store.readFacts().map(f => '- ' + f).join('\n') || '(nothing saved yet)',
  gmail: ({ usable }) => usable.includes('gmail')
    ? 'Use the Gmail connector tools to search the user\'s mail for what the request is about (read up to 25 threads; open the ones that look important).'
    : '(Gmail connector not available to this engine)',
  calendar: ({ usable }) => usable.includes('calendar') ? 'Use the Google Calendar connector to list events for today and tomorrow on the primary calendar.' : '(calendar connector not available; skip meetings)',
  chat: ({ input }) => chatreply.recent(input),
  'skills-list': () => skills.list().filter(s => mayRun({ skill: s }, 'offer').ok).map(s => `- ${s.name} [${s.kind}${s.automation ? ', automation: ' + s.automation : ''}] runs:${s.runs} — ${truncate(s.description, 160)}${s.dir ? `\n  file: ${path.join(s.dir, 'SKILL.md')}` : ''}`).join('\n') || '(no skills)',
  skill: ({ input }) => { const s = skills.get(input.skill); return s && !mayRun({ skill: s }, 'offer').ok ? '(skill not allowed yet)' : s ? `# ${s.name}\n${s.description}\n\n${s.body}` : '(skill not found)'; },
  agents: () => list().filter(a => !a.hidden && mayRun({ agent: a }, 'offer').ok && a.kind !== 'verifier' && a.kind !== 'builder').map(a => `- ${a.id}: ${a.description} (input: ${a.input})`).join('\n'),
  modules: () => modules.list().filter(m => m.enabled).map(m => `- ${m.id}: ${m.name}`).join('\n'),
};

const ACTIONS_GUIDE = `
## Taking actions
If the request needs Jade to change something, end your reply with a fenced block exactly like this (omit it otherwise):
\`\`\`jade-actions
[{"type":"add_action","text":"...","project":"<project id or empty>","owner":"","due":"YYYY-MM-DD","priority":"high|normal|low"}]
\`\`\`
Allowed types and fields:
- add_action {text, project, owner, due, priority} · complete_action {id}
- add_note {title, body, project}
- create_project {name, description, owner}
- update_project {id, owner?, description?, tags?}
- remember {fact}  (long-term memory about the user, their work and preferences)
- run_agent {agent, project?}  (start a sub-agent; see the agents list)
- navigate {route}  (routes: home, projects, project/<id>, notes, actions, memory, skills, agents, modules, settings)
Never invent ids. Dates are YYYY-MM-DD.`;

// What a chat reply adds to a run (its sources, connectors, turn text, attached files) is in chatreply.js.
export { chatSources } from './chatreply.js';
const settingOn = path => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), config.get()) === true;
export function wantedConnectors(def, input) {
  // an agent file can tie its web search to a setting (jade-web: dreams.web): with the setting off it has no web tools at all
  if (!chatreply.is(def)) return def.webSetting && !settingOn(def.webSetting) ? def.connectors.filter(c => c !== 'web') : def.connectors;
  return chatreply.connectors(def, input);
}

/**
 * Build what an agent run needs. Returns { system, prompt, history, connectors, dirs, skills }.
 *  system  - stable per agent (who Jade is, the agent's instructions, the actions guide): goes in the system prompt, so a
 *            warm chat worker can keep running and the engine can cache it
 *  prompt  - this run's context sections, any matched skills and (for chat) the user's message
 *  history - the recent conversation as text; a fresh process needs it, a warm worker already has it
 */
// ---------------------------------------------------------------- the soul file
// Who Jade is and how it speaks is a text file, not code: agents/jade/soul.md is the shipped default; the first run copies it to
// <data folder>/soul.md, which is the user's to edit (by hand, or by asking Jade in chat). An emptied file falls back to the default.
export const soulFile = () => path.join(config.JADE_HOME, 'soul.md');
const shippedSoul = () => path.join(config.APP_ROOT, 'agents', 'jade', 'soul.md');
/** Create the user's soul file from the shipped one when it is missing. Never overwrites. */
export function ensureSoul() {
  try { if (!fs.existsSync(soulFile())) { fs.mkdirSync(config.JADE_HOME, { recursive: true }); fs.copyFileSync(shippedSoul(), soulFile()); } } catch { /* read-only folder: the shipped copy is used */ }
}
function soulText(c) {
  let t = '';
  for (const f of [soulFile(), shippedSoul()]) { try { t = fs.readFileSync(f, 'utf8').trim(); } catch { t = ''; } if (t) break; }
  return t.replace(/\{\{\s*assistant\s*\}\}/g, c.assistantName).replace(/\{\{\s*role\s*\}\}/g, c.role || 'project manager');
}

export async function prepare(def, input = {}) {
  if (def.runnable === false) throw new Error(`Jade does not know how to run ${def.name}: its file has no jade-handler or jade-loop`);
  const c = config.get();
  const engine = engines.pick();
  const usable = engine === 'claude'
    ? wantedConnectors(def, input).filter(n => engines.allowed(n) && (n === 'web' || engines.hasConnector(n)))
    : [];
  const sections = [];
  let history = '';
  // A chat gets the sources a background agent would use, when the message calls for them (the calendar hint),
  // added only when the message is about it, to keep chats lean.
  const chat = chatreply.is(def);
  const context = chat ? [...def.context, ...chatreply.chatSources(String(input.message || ''))] : def.context;
  for (const name of context) {
    const b = builders[name];
    if (!b) continue;
    let text;
    try { text = await b({ input, usable }); } catch (e) { text = `(unavailable: ${e.message})`; }   // a builder may be async (Dreams reads files)
    if (text === '' && !chat) continue;   // a section with nothing to say is left out, heading and all
    if (name === 'chat' && chat) history = `## recent conversation\n${text}`;
    else sections.push(`## ${name}\n${text}`);
  }
  const body = def.body.replace(/\{\{\s*input\.(\w+)\s*\}\}/g, (_, k) => String(input[k] ?? '')).replace(/\{\{\s*assistant\s*\}\}/g, c.assistantName);
  // A skill the agent names is its own and always goes in; nothing from the shared pool is added by word overlap except in chat.
  const owned = ownedSkills(def);
  const matched = [...owned, ...(chat ? skills.match(`${def.name} ${def.description} ${input.message || ''} ${input.extra || ''}`, 2).filter(s => !owned.some(o => o.name === s.name)) : [])];
  const usesActions = ['chat', 'skill'].includes(def.handler) && !input.askOnly;   // a question from a Claude session (bridge) is answered, never acted on
  const edits = !!def.edits && !input.askOnly && engine === 'claude' && permissions.mode() !== 'read';
  const system = [
    soulText(c),
    chat ? chatreply.soulNote(soulFile()) : '',
    edits
      ? `You can create and edit files like Claude Code (Edit, Write, Bash), anywhere under the user's home folder (${os.homedir()}). Put deliverables where the user says; by default in the project's own folder, or in ${config.outputDir()} when a project has no folder${config.outputIsCustom() ? ' (this is the user\'s own folder, not Jade\'s: put new files in a sub-folder, not loose at its top level)' : ''}; scratch work goes in ${path.join(config.JADE_HOME, 'work')}, and anything worth keeping from it is saved to its proper place before you finish. Jade keeps the previous version of anything you change and asks the user before anything irreversible (deleting their files or deliverables, destructive commands, sending through a connector), so never ask for confirmation yourself: act, and if an action is declined do not retry it, say what you would have done. Jade's own records (actions, notes, projects, memory) still change only through the jade-actions block. When you change or create files, finish by saying in one line each what you changed and where (the chat lists the files too). Pictures the user pastes into a chat are deleted automatically after you have written what they show into a file, so put everything worth keeping from a picture into that file (text, figures, names), and never link to the picture itself unless the user asks to keep it.`
      : 'Never send, delete or modify anything outside of the jade-actions block.',
    body.trim(),
    usesActions ? ACTIONS_GUIDE : '',
  ].filter(Boolean).join('\n\n');
  const turn = chat ? chatreply.turn(input, usable) : '';
  const skillBlock = skills.promptBlock(matched);
  const prompt = ['# Context', sections.join('\n\n'), skillBlock, turn].filter(Boolean).join('\n\n');
  for (const s of matched) skills.recordRun(s.name);
  const dirs = [...memory.roots()];
  // The attachments folder is always readable in a chat, not only on the message that has an attachment: the chat's engine
  // process is kept warm between messages and restarted whenever its folders change, so adding it only for a message with
  // an image or file restarted the process (and cut off a reply still being written) every time one was sent.
  if (chat || (input.images || []).length || (input.files || []).length) dirs.push(store.dirs.attachments);
  if (input.project) dirs.push(...foldersOf(store.getProject(input.project)));
  // With edits on, Claude Code's working directories are everywhere Jade may edit (home and any added root), so Edit and
  // Write reach project deliverables wherever they live; what is allowed is still decided by the permission policy.
  if (edits) dirs.push(permissions.workDir(), config.outputDir(), ...permissions.roots());
  // A run that can edit files can hand build tasks to the builders (the Worker); one that cannot has no use for them.
  const subagents = edits ? builderAgentsFile() : '';
  // an agent can ask for no file reading (jade-read: none), and one tied to a web setting says plainly that web is off while it is off
  const noRead = !!def.noRead, denyWeb = !!def.webSetting && !settingOn(def.webSetting);
  return { system, prompt, history, connectors: usable, dirs: noRead ? [] : [...new Set(dirs)], skills: matched.map(s => s.name), edits, subagents, sections, skillBlock, turn, noRead, denyWeb };
}

// ---------------------------------------------------------------- applying answers
// How run_agent starts an agent: the job queue gives its enqueue (jobs.js sets it when it loads), so this file does not import the queue.
let start = null;
export const useStarter = fn => { start = fn; };
export function applyActions(list, origin = 'jade') {
  const applied = [];
  let navigate = null;
  for (const a of Array.isArray(list) ? list.slice(0, 25) : []) {
    try {
      switch (a.type) {
        case 'add_action': store.addAction({ ...a, source: origin }); applied.push(`Added action: ${a.text}`); break;
        case 'complete_action': store.updateAction(a.id, { status: 'done' }); applied.push(`Completed action ${a.id}`); break;
        case 'add_note': { const n = store.saveNote({ title: a.title, body: a.body, project: a.project }); applied.push(`Saved note: ${n.title}`); break; }
        case 'create_project': { const p = store.saveProject({ name: a.name, description: a.description || '', owner: a.owner || '' }); applied.push(`Created project ${p.name}`); break; }
        case 'update_project': {
          const patch = {};
          for (const k of ['owner', 'description', 'tags']) if (a[k] !== undefined) patch[k] = a[k];
          store.patchProject(a.id, patch); applied.push(`Updated project ${a.id}`); break;
        }
        case 'remember': store.remember(a.fact); applied.push(`Remembered: ${a.fact}`); break;
        case 'run_agent': {
          const target = get(a.agent), may = target && mayRun({ agent: target }, origin);
          if (may && !may.ok) throw new Error(may.message);
          if (!start) throw new Error('no queue to start it in');
          const j = start({ agent: a.agent, input: a.project ? { project: a.project } : {}, trigger: origin }); applied.push(`Started ${j.title}`); break;
        }
        case 'navigate': navigate = a.route; break;
      }
    } catch (e) { applied.push(`Could not ${a.type}: ${e.message}`); }
  }
  return { applied, navigate };
}

function splitActions(text) {
  const m = /```jade-actions\s*([\s\S]*?)```/i.exec(text || '');
  if (!m) return { reply: (text || '').trim(), actions: [] };
  let actions = [];
  try { actions = JSON.parse(m[1]); } catch {}
  return { reply: text.replace(m[0], '').trim(), actions };
}

/** Add a handler: an agent whose def says `handler: name` has its finished run passed to fn(def, input, text, job). */
export const addHandler = (name, fn) => { handlers[name] = fn; };
const handlers = {
  markdown: () => ({}),

  chat: (def, input, text, job) => {
    const { reply, actions } = splitActions(text);
    const res = applyActions(input.askOnly ? [] : actions, 'jade');
    chatreply.record(input, job, reply, res);
    return { reply, thread: input.thread, ...res };
  },

  actions: (def, input, text) => {
    const j = extractJSON(text);
    const list = Array.isArray(j) ? j : j?.actions || [];
    let n = 0;
    for (const a of list) { if (a?.text) { store.addAction({ ...a, project: a.project || input.project || store.getNote(input.note || '')?.project || '', source: def.id }); n++; } }
    return { added: n };
  },

  skill: (def, input, text) => {
    const { reply, actions } = splitActions(text);
    const res = applyActions(actions, 'skill:' + input.skill);
    skills.recordRun(input.skill);
    emit('skills', {});
    return { reply, ...res };
  },
};

export async function finish(def, input, text, job) {
  const h = handlers[def.handler] || handlers.markdown;
  return h(def, input, text, job);
}

/**
 * Edit an agent from the page: description, prompt, tools, or clearing the model. A 'yours' agent's own file is written; a built-in is
 * first installed to Claude Code's folder and that copy is edited. Project and plugin agents belong to someone else and are read-only.
 */
export function save(id, patch) {
  const def = get(id);
  if (!def) throw new Error('No such agent');
  if (def.extends) throw new Error('This file only adds to a built-in agent; edit that file directly');
  let file = def.file;
  if (def.origin === 'built-in') {
    agentfiles.install({ ids: [id] });
    file = path.join(claudehome.agentsDir(), `jade-${id}.md`);
    if (!fs.existsSync(file)) throw new Error('Could not install a copy to edit');
  } else if (def.origin !== 'yours') throw new Error('This agent belongs to a project or a plugin; copy it to your agents to change it');
  agentfiles.editFile(file, patch);
  emit('agents', {}); emit('data', { kind: 'agents' });
  return get(id);
}

// ---------------------------------------------------------------- watching Claude Code's folders
// When Claude Code (or you) creates an agent, the page updates without a restart. Watches your agents folder, each project's
// .claude/agents and the plugin list; started by the agents module, re-armed when a folder appears or the project list changes.
let stops = [];
/**
 * Watch for a folder that does not exist yet (a project's .claude/agents or .claude/skills): the nearest folder above it that does exist,
 * not above `root`, is watched for the next folder on the way; `onChange` runs when that name appears or goes. Returns a stop function.
 */
function watchUntilThere(dir, root, onChange) {
  let up = path.dirname(dir), next = path.basename(dir);
  while (!fs.existsSync(up)) { if (path.resolve(up) === path.resolve(root) || up === path.dirname(up)) return () => {}; next = path.basename(up); up = path.dirname(up); }
  try { const w = guardedWatch(up, null, (ev, f) => { if (!f || String(f) === next) onChange(); }, { onClose: why => { const t = setTimeout(onChange, why === 'storm' ? 10000 : 0); t.unref?.(); } }); w.on('error', () => { try { w.close(); } catch {} }); w.unref?.(); return () => w.close(); }   // a watch that fails (Windows: EPERM when the folder is removed) must not crash the server
   catch { return () => {}; }
}
const changed = debounce(() => { emit('agents', {}); emit('data', { kind: 'agents' }); }, 250);
/** Start watching; returns a function that stops it. */
export function watch() {
  const arm = () => {
    stops.splice(0).forEach(s => s());
    const home = claudehome.home();
    for (const { dir, legacy, root } of agentfiles.sources()) {
      if (legacy) continue;   // the data folder's own agents/ is watched by index.js
      // a project that has no .claude/agents yet: wait for it (and re-arm to watch the folder itself once it is there)
      if (!fs.existsSync(dir) && root) stops.push(watchUntilThere(dir, root, () => { rearm(); changed(); }));
      else stops.push(watchTree(dir, changed));
    }
    // each project's skills folder the same way (the others, and those that exist at start, are also watched once by index.js)
    for (const { dir, root } of skills.projectSkillDirs()) {
      const fire = () => emit('skills', {});
      stops.push(fs.existsSync(dir) ? watchTree(dir, debounce(fire, 300)) : watchUntilThere(dir, root, () => { rearm(); fire(); }));
    }
    stops.push(watchTree(path.join(home, 'plugins'), f => { if (/installed_plugins\.json$|[\\/]agents[\\/]/.test(f)) changed(); }, { maxDirs: 200 }));
    try { const w = guardedWatch(home, null, (ev, f) => { if (['agents', 'plugins'].includes(String(f))) { rearm(); changed(); } }, { onClose: why => { const t = setTimeout(rearm, why === 'storm' ? 10000 : 2000); t.unref?.(); } }); w.on('error', () => { try { w.close(); } catch {} }); w.unref?.(); stops.push(() => w.close()); } catch { /* no claude home yet */ }
  };
  const rearm = debounce(arm, 300);
  arm();
  const onEvent = e => { if (e.type === 'data' && e.payload?.kind === 'projects') rearm(); };
  bus.on('event', onEvent);
  return () => { bus.off('event', onEvent); stops.splice(0).forEach(x => x()); };
}
