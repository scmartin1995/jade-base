// All JSON routes. This file is re-imported whenever it changes, so route edits apply without a restart.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as config from './core/config.js';
import * as store from './core/store.js';
import * as memory from './core/memory.js';
import * as skills from './core/skills.js';
import * as jobs from './core/jobs.js';
import * as skeptic from './core/skeptic.js';
import * as review from './core/review.js';
import * as agents from './core/agents.js';
import * as engines from './core/engines.js';
import * as provider from './core/provider.js';
import * as models from './core/models.js';
import * as permissions from './core/permissions.js';
import * as warm from './core/warm.js';
import * as modules from './core/modules.js';
import * as router from './core/router.js';
import { staticTarget } from './core/static.js';
import * as theme from './core/theme.js';
import * as scheduler from './core/scheduler.js';
import * as native from './core/native.js';
import * as files from './core/files.js';
import * as outputs from './core/outputs.js';
import * as search from './core/search.js';
import * as voicemodel from './core/voicemodel.js';
import * as bridge from './core/bridge.js';
import { extractText } from './core/extract.js';
import { emit } from './core/bus.js';
import * as connection from './core/connection.js';
import { foldersOf, resolveHome } from './core/locations.js';

// api.js is re-imported on change; the "api" scope drops its old routes first, so nothing is registered twice.
const on = router.scope('api');

function publicConfig() {
  const c = config.get();
  return { ...c, configFile: config.configFile(), home: config.JADE_HOME };
}

/** Stream a file whose headers are already written. A file that cannot be read (taken away, no permission) ends this answer; it never ends the server. */
function sendFile(res, file) {
  const s = fs.createReadStream(file);
  s.on('error', () => { if (!res.headersSent) { res.writeHead(500); res.end(); } else res.destroy(); });
  res.on('close', () => s.destroy());
  s.pipe(res);
}

// ------------------------------------------------------------- boot & system
on('GET', '/api/boot', () => ({
  config: publicConfig(), modules: modules.list(), theme: theme.current(), engines: engines.detect(), models: models.offerable(),
  agents: agents.list().map(({ body, ...a }) => a), paths: store.paths(), platform: process.platform, version: '0.1.0', userHome: os.homedir(),
}));
on('GET', '/api/config', () => publicConfig());
// `setup` is not a setting to patch here: finishing set-up goes through POST /api/setup/done, which checks the connection first.
on('POST', '/api/config', ({ body }) => { const { setup: _skip, ...patch } = body || {}; config.save(patch); if (patch.memory) { memory.rebuild(); memory.watch(); } return publicConfig(); });
on('GET', '/api/engines', async ({ q }) => (q.get('refresh') === '1' ? engines.refresh() : engines.detect()));
// How Claude Code reaches Claude: subscription, Amazon Bedrock or a gateway. Kept in <JADE_HOME>/engine.env, never config.json.
on('GET', '/api/engine/provider', () => provider.describe());
on('POST', '/api/engine/provider', ({ body }) => { const d = provider.configure(body || {}); connection.clear(); warm.shutdown(); engines.refresh(); models.discover().catch(() => {}); return d; });
on('GET', '/api/engine/provider/import', () => provider.importClaudeSettings());
on('POST', '/api/engine/provider/import', () => { const d = provider.useClaudeSettings(); connection.clear(); warm.shutdown(); engines.refresh(); models.discover().catch(() => {}); return d; });
on('POST', '/api/engine/test', async () => { const r = await engines.test(); connection.record(!!r.ok); if (r.ok) models.discover().catch(() => {}); return r; });
on('POST', '/api/engine/diagnose', () => engines.diagnose());
// The models this endpoint offers (Claude Code's own list plus the endpoint's, when it has one).
on('GET', '/api/models', () => models.offerable());
on('POST', '/api/models/refresh', async () => { await models.discover(); return models.offerable(); });
// Permissions: Claude Code's permission tool asks here (and waits); the UI answers; the change log can restore files.
on('POST', '/api/permissions/ask', ({ body }) => permissions.decide(body || {}));
on('GET', '/api/permissions', () => ({ mode: permissions.mode(), modes: permissions.MODES, pending: permissions.pendingList(), zones: permissions.zones(), changes: permissions.changes(40) }));
on('POST', '/api/permissions/mode', ({ body }) => { if (!permissions.MODES[body?.mode]) throw new Error('Unknown mode'); config.save({ permissions: { mode: body.mode } }); warm.shutdown(); return { mode: permissions.mode() }; });
on('POST', '/api/permissions/:id', ({ p, body }) => permissions.answer(p.id, !!body?.allow, !!body?.remember));
on('GET', '/api/changes', () => permissions.changes(100));
on('POST', '/api/changes/:id/restore', ({ p }) => permissions.restore(p.id));
// Connectors: everything Claude Code has, each with a switch; adding one registers it with Claude Code for this user.
on('GET', '/api/connectors', () => engines.connectors());
on('POST', '/api/connectors/add', ({ body }) => engines.addMcp(body?.name, body?.url));
on('POST', '/api/connectors/remove', ({ body }) => engines.removeMcp(body?.name));
on('POST', '/api/connectors/:id', ({ p, body }) => { config.save({ connectors: { enabled: { [p.id]: !!body?.enabled } } }); return engines.connectors(); });
// The dock badges in one call (overdue actions).
on('GET', '/api/counts', () => {
  const today = new Date(); today.setHours(23, 59, 59, 999);
  return {
    actions: store.listActions().filter(a => a.status !== 'done' && a.due && new Date(a.due + 'T00:00:00') <= today).length,
  };
});
// A user module's view files (<JADE_HOME>/modules/<id>/views/*): scripts, styles, data and pictures only, and never outside that folder.
// Closed while the module is off, and a link inside the folder that leads out of it (or to a secret) is not a view file.
on('GET', '/modules/:id/views/*', ({ p, res }) => {
  const root = modules.viewsDir(p.id), ext = path.extname(p['*']).toLowerCase();
  const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const t = root && types[ext] && staticTarget('/' + p['*'], root);
  if (!t || t.status || !fs.existsSync(t.file) || !fs.statSync(t.file).isFile()) { res.writeHead(t?.status || 404); return res.end(); }
  modules.requireOn(p.id);
  // where the file really is must be inside the views folder, and never one of Jade's secrets
  let real, realRoot; try { real = fs.realpathSync(t.file); realRoot = fs.realpathSync(root); } catch { res.writeHead(404); return res.end(); }
  if (!(real === realRoot || real.startsWith(realRoot + path.sep)) || files.isSecret(t.file) || files.isSecret(real)) { res.writeHead(403); return res.end(); }
  res.writeHead(200, { 'content-type': types[ext], 'cache-control': 'no-cache' });
  sendFile(res, real);
}, { raw: true });
on('GET', '/api/modules', () => modules.list());
on('POST', '/api/modules/:id', ({ p, body }) => { modules.set(p.id, body.enabled); return modules.list(); });
on('GET', '/api/schedule', () => scheduler.tasks());
// The Routines page: everything that runs on a schedule or a button, in one place.
on('GET', '/api/routines', modules.only('routines', () => {
  const c = config.get();
  const tasks = scheduler.tasks();
  const recent = jobs.list();
  const last = f => { const j = recent.find(f); return j ? { id: j.id, status: j.status, at: j.endedAt || j.createdAt, error: j.error || '' } : null; };
  const sched = a => c.schedules?.[a.id] ?? a.schedule ?? '';
  const all = agents.list();
  const routine = a => ({ id: a.id, name: a.name, description: a.description, icon: a.icon, input: a.input, module: a.module, moduleOn: !a.module || modules.enabled(a.module),
    schedule: sched(a) || 'off', suggested: a.schedule || '', nextRun: scheduler.nextRun(sched(a)),
    // quiet runs (a loop with nothing new) leave the run list, so fall back to when the scheduler last fired it
    last: last(j => j.agent === a.id) || (tasks.find(t => t.key === 'agent:' + a.id)?.lastRun ? { at: tasks.find(t => t.key === 'agent:' + a.id).lastRun, status: 'done' } : null) });
  return {
    routines: all.filter(a => !a.hidden && !a.loop && a.kind !== 'verifier' && a.kind !== 'builder').map(routine),
    agents: all.filter(a => a.loop && a.kind !== 'verifier').map(routine),
    automations: skills.list().filter(s => s.automation).map(s => ({ name: s.name, description: s.description, schedule: s.automation, suggested: s.suggested,
      on: s.automationOn, perProject: s.perProject, nextRun: scheduler.nextRun(s.automation), last: last(j => j.agent === 'skill-runner' && j.input?.skill === s.name) })),
    system: [
      { key: 'memory', name: 'Memory reindex', desc: 'Re-reads your memory folders so search and chat see new and changed files.', minutes: Math.max(5, Number(c.memory?.reindexMinutes) || 15), on: true, lastRun: tasks.find(t => t.key === 'memory')?.lastRun || null },
    ],
  };
}));
on('POST', '/api/routines/system/:key', modules.only('routines', ({ p, body }) => {
  const minutes = Math.round(Number(body?.minutes));
  if (!(minutes >= 5 && minutes <= 24 * 60)) throw Object.assign(new Error('Pick between 5 minutes and 24 hours'), { status: 400 });
  if (p.key === 'memory') config.save({ memory: { reindexMinutes: minutes } });
  else throw Object.assign(new Error('Unknown job'), { status: 404 });
  emit('schedule', {});
  return { ok: true };
}));
on('POST', '/api/schedule/:id', ({ p, body }) => { config.save({ schedules: { [p.id]: body.schedule || 'off' } }); emit('schedule', {}); return scheduler.tasks(); });

// ------------------------------------------------------------- projects
on('GET', '/api/projects', () => store.listProjects());
on('POST', '/api/projects', ({ body }) => store.saveProject({ ...body, id: undefined }));
on('GET', '/api/projects/:id', ({ p }) => {
  const project = store.getProject(p.id);
  if (!project) throw Object.assign(new Error('Not found'), { status: 404 });
  // the project page shows the newest notes (title and date) and the open actions with the latest few finished ones
  const acts = store.listActions().filter(a => a.project === project.id);
  return { project, notes: store.listNoteSummaries({ project: project.id, limit: 30 }).items, actions: [...acts.filter(a => a.status !== 'done'), ...acts.filter(a => a.status === 'done').slice(0, 3)],
    jobs: jobs.list().filter(j => j.input?.project === project.id).slice(0, 10) };
});
on('PATCH', '/api/projects/:id', ({ p, body }) => store.patchProject(p.id, body));
on('DELETE', '/api/projects/:id', ({ p }) => { store.deleteProject(p.id); return { ok: true }; });

// ------------------------------------------------------------- actions
// Without a filter: every action (the bridge and the home page read this). With status, project, owner, q, limit or offset: that page of them, soonest due first.
const whole = (v, d, max) => Math.max(0, Math.min(max, Math.floor(Number(v)) || d));
// With paged=1 the answer is { items, total } (total = all that match, whatever the page) and limit has no cap, so a page can always ask for the rest.
const pagedOf = (q, all) => { const off = whole(q.get('offset'), 0, 1e6), lim = whole(q.get('limit'), 200, 1e6); return { items: all.slice(off, off + lim), total: all.length }; };
on('GET', '/api/actions', ({ q }) => q.has('paged')
  ? pagedOf(q, store.queryActions({ status: q.get('status') || 'all', project: q.get('project') || '', owner: q.get('owner') || '', q: q.get('q') || '', limit: Infinity }))
  : ['status', 'project', 'owner', 'q', 'limit', 'offset'].some(k => q.has(k))
  ? store.queryActions({ status: q.get('status') || 'all', project: q.get('project') || '', owner: q.get('owner') || '', q: q.get('q') || '', limit: whole(q.get('limit'), 1000, 1000), offset: whole(q.get('offset'), 0, 1e6) })
  : store.listActions());
on('GET', '/api/actions/owners', () => store.actionOwners());
on('POST', '/api/actions', ({ body }) => store.addAction(body));
on('PATCH', '/api/actions/:id', ({ p, body }) => store.updateAction(p.id, body));
on('DELETE', '/api/actions/:id', ({ p }) => { store.deleteAction(p.id); return { ok: true }; });

// ------------------------------------------------------------- notes
// A page of notes without their text (id, title, project, tags, dates and the first 220 characters), newest first: limit (up to 500, default 200), offset, project, q.
on('GET', '/api/notes', ({ q }) => {
  const paged = q.has('paged'), r = store.listNoteSummaries({ project: q.get('project') || '', q: q.get('q') || '', limit: whole(q.get('limit'), 200, paged ? 1e6 : 500), offset: whole(q.get('offset'), 0, 1e6) });
  return paged ? r : r.items;   // paged=1: { items, total }, no cap on limit
});
on('GET', '/api/notes/:id', ({ p }) => store.getNote(p.id));
on('POST', '/api/notes', ({ body }) => store.saveNote({ ...body, id: undefined }));
on('PUT', '/api/notes/:id', ({ p, body }) => store.saveNote({ ...body, id: p.id }));
on('DELETE', '/api/notes/:id', ({ p }) => { store.deleteNote(p.id); return { ok: true }; });

// ------------------------------------------------------------- memory
on('GET', '/api/memory/search', ({ q }) => memory.search(q.get('q') || '', Number(q.get('k')) || 12));
// One search across documents (by content), files (by name), and chats, ranked together.
on('GET', '/api/search', async ({ q }) => search.searchAsync(q.get('q') || '', { limit: Math.min(60, Number(q.get('limit')) || 20), kinds: (q.get('kinds') || '').split(',').filter(Boolean) }));
on('GET', '/api/memory/stats', () => memory.stats());
// Without ?limit: the newest files as a plain list (capped). With ?limit=&offset=: one page as { files, total, offset, more } so the page can ask for more.
on('GET', '/api/memory/files', ({ q }) => {
  const pf = store.listProjects().filter(p => !p.archived && foldersOf(p).length).map(p => ({ name: p.name, folders: foldersOf(p) }));
  if (!q.has('limit')) return memory.listFiles(pf);
  const limit = Math.min(1e6, Math.max(1, Number(q.get('limit')) || 2000)), offset = Math.max(0, Number(q.get('offset')) || 0), total = memory.listedCount();
  return { files: memory.listFiles(pf, { limit, offset }), total, offset, more: offset + limit < total, indexing: memory.indexing() };
});
// ------------------------------------------------------------- files and deliverables (any type, by name)
on('GET', '/api/files', async ({ q }) => files.searchAsync(q.get('q') || '', { project: q.get('project') || '', kind: q.get('kind') || '', limit: Math.min(200, Number(q.get('limit')) || 50), madeOnly: q.get('made') === '1' }));
// The file ring shows outputs only (final deliverables). The rules live in core/outputs.js; a correction is kept in .state/output-overrides.json.
on('GET', '/api/outputs', async ({ q }) => ({ outputs: (await outputs.listOutputsAsync({ limit: Number(q.get('limit')) || 200, project: q.get('project') || '' })).map(o => ({ path: o.path, name: o.name, title: o.title, project: o.project, area: o.area, modified: o.modified, kind: o.kind, bundle: o.bundle, loose: o.loose })) }));
// The same list in the shape the ring draws (it also carries the group and the flags); the browser never classifies anything itself.
on('GET', '/api/outputs/ring', async () => { const all = await outputs.listOutputsAsync({ limit: 5000 }); return { total: all.total, outputs: all.map(o => ({ file: o.path, title: o.title, group: o.group, area: o.area, project: o.project, mtime: o.mtime, loose: o.loose, bundle: o.bundle, bundleFiles: o.bundleFiles, overridden: o.flags.includes('overridden') })) }; });
on('POST', '/api/outputs/override', ({ body }) => { const r = outputs.setOverride(body?.path, body?.as); return { ok: true, path: r.path, as: r.as }; });
// Text of a document (Word, PowerPoint, Excel, PDF, Markdown…) for the in-app preview.
on('GET', '/api/files/text', ({ q }) => {
  const p = resolveHome(q.get('path') || ''); // saved paths are "~\…"
  if (!files.allowed(p) || !fs.existsSync(p)) throw Object.assign(new Error('That file is not in a folder Jade can reach'), { status: 403 });
  const text = extractText(p);
  if (text === null) throw Object.assign(new Error('No readable text in this file'), { status: 415 });
  return { path: p, text };
});
on('POST', '/api/fs/open', async ({ body }) => { await files.open(String(body.path || '')); return { ok: true }; });
on('POST', '/api/fs/reveal', async ({ body }) => {
  // One line per click in .state/reveal.log, written here before anything can fail, so a dead click can be traced.
  const note = m => { try { fs.appendFileSync(path.join(config.STATE, 'reveal.log'), `${new Date().toISOString()} server: ${m}\n`); } catch {} };
  note(`asked for ${String(body.path || '(no path)')}`);
  try { await files.reveal(String(body.path || '')); note('helper started'); return { ok: true }; }
  catch (e) { note(`refused: ${e.message}`); throw e; }
});
on('GET', '/api/memory/facts', () => store.readFacts());
on('POST', '/api/memory/facts', ({ body }) => { store.remember(body.fact); return store.readFacts(); });
on('DELETE', '/api/memory/facts', ({ body }) => { store.forget(body.fact); return store.readFacts(); });
on('GET', '/api/memory/file', ({ q }) => {
  const file = path.resolve(q.get('path') || '');
  const inside = (f, root) => f === root || f.startsWith(root + path.sep);
  // a link inside a memory folder that leads out of it is not in the folder
  const ok = memory.roots().some(root => inside(file, root)) && (() => { try { const rp = fs.realpathSync(file); return memory.roots().some(root => { let rr = root; try { rr = fs.realpathSync(root); } catch {} return inside(rp, rr); }); } catch { return false; } })();
  if (!ok || !fs.existsSync(file) || files.isSecret(file)) throw Object.assign(new Error('Not in a memory folder'), { status: 403 });
  return { path: file, text: fs.readFileSync(file, 'utf8').slice(0, 200000) };
});

// ------------------------------------------------------------- the computer's own folder dialog
on('POST', '/api/fs/choose', ({ body }) => native.chooseFolder({ title: body?.title, start: body?.start }));

// ------------------------------------------------------------- folder browser (for pointing Jade at folders)
// Lists sub-folder names only (no file contents) so the UI can offer a real folder picker on any OS.
on('GET', '/api/fs/dirs', ({ q }) => {
  const home = os.homedir();
  const raw = q.get('path') || '~';
  const dir = resolveHome(raw);
  if (files.isSecret(dir)) throw Object.assign(new Error('Jade keeps its own private files there; they are not listed.'), { status: 403 });
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw Object.assign(new Error('Not a folder: ' + raw), { status: 404 });
  const hidden = q.get('hidden') === '1';
  let dirs = [];
  try {
    dirs = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => (e.isDirectory() || (e.isSymbolicLink() && (() => { try { return fs.statSync(path.join(dir, e.name)).isDirectory(); } catch { return false; } })()))
        && (hidden || !e.name.startsWith('.')) && !['node_modules', '$RECYCLE.BIN', 'System Volume Information'].includes(e.name) && !files.isSecret(path.join(dir, e.name)))
      .map(e => ({ name: e.name, path: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } catch (e) { throw Object.assign(new Error('Cannot open this folder: ' + e.code), { status: 403 }); }
  let noteCount = 0;
  try { noteCount = fs.readdirSync(dir).filter(f => config.get().memory.extensions.includes(path.extname(f).toLowerCase())).length; } catch {}
  const tilde = p => p === home ? '~' : p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
  const shortcuts = [['Home', home], ['Documents', path.join(home, 'Documents')], ['Desktop', path.join(home, 'Desktop')],
    ['OneDrive', path.join(home, 'OneDrive')], ['Dropbox', path.join(home, 'Dropbox')], ['Google Drive', path.join(home, 'Google Drive')],
    ['Jade data', config.JADE_HOME]]
    .filter(([, p]) => fs.existsSync(p)).map(([name, p]) => ({ name, path: p, display: tilde(p) }));
  const parent = path.dirname(dir);
  return { path: dir, display: tilde(dir), parent: parent !== dir ? parent : null, dirs: dirs.slice(0, 500), more: dirs.length > 500, notes: noteCount, shortcuts, sep: path.sep };
});

// ------------------------------------------------------------- skills
on('GET', '/api/skills', () => skills.list().map(s => ({ ...s, body: s.body.slice(0, 20000) })));
on('POST', '/api/skills', ({ body }) => ({ name: skills.save(body) }));
on('POST', '/api/skills/:name/prefs', ({ p, body }) => { skills.setPrefs(p.name, body); emit('schedule', {}); return { ok: true }; });
on('POST', '/api/skills/:name/claude', ({ p }) => ({ path: skills.installToClaude(p.name) }));
on('POST', '/api/skills/:name/run', ({ p, body }) => jobs.enqueue({ agent: 'skill-runner', input: { skill: p.name, project: body?.project || '', extra: body?.extra || '' } }));
on('DELETE', '/api/skills/:name', ({ p }) => { skills.remove(p.name); return { ok: true }; });

// ------------------------------------------------------------- agents & jobs
on('GET', '/api/agents', () => agents.list().map(({ body, ...a }) => ({ ...a, prompt: body })));
on('POST', '/api/agents/:id/run', ({ p, body }) => jobs.enqueue({ agent: p.id, input: body?.input || {} }));
on('GET', '/api/jobs', () => jobs.list());
on('GET', '/api/jobs/:id', ({ p }) => jobs.get(p.id));
on('POST', '/api/jobs/:id/cancel', ({ p }) => { jobs.cancel(p.id); return { ok: true }; });
// Run a finished, failed or interrupted job again: the same agent, input (a dashboard tweak keeps its wording), engine and model.
on('POST', '/api/jobs/:id/rerun', ({ p }) => jobs.rerun(p.id));

// ------------------------------------------------------------- chat (the "Ask Jade" bar and voice)
// limit (up to 500, default 200), offset and q (words in the title or last words) page the list.
on('GET', '/api/chats', ({ q }) => q.has('paged')
  ? pagedOf(q, store.listThreads({ q: q.get('q') || '' }))   // paged=1: { items, total }, no cap on limit
  : store.listThreads({ limit: whole(q.get('limit'), 200, 500), offset: whole(q.get('offset'), 0, 1e6), q: q.get('q') || '' }));
on('POST', '/api/chats', ({ body }) => store.newThread(body?.title || ''));
on('GET', '/api/chats/:id', ({ p, q }) => {
  const t = store.getThread(p.id);
  if (!t) throw Object.assign(new Error('Not found'), { status: 404 });
  // ?limit=N: only the last N turns (total says how many there are); without it, the whole conversation
  return q.has('limit') ? { ...t, turns: t.turns.slice(-whole(q.get('limit'), 40, 200)), total: t.turns.length } : t;
});
on('PATCH', '/api/chats/:id', ({ p, body }) => store.updateThread(p.id, { title: body.title, model: body.model, effort: body.effort }));
on('DELETE', '/api/chats/:id', ({ p }) => { store.deleteThread(p.id); return { ok: true }; });
// "Check with Skeptic" on one reply
on('POST', '/api/chats/:id/check', ({ p, body }) => jobs.enqueue({ agent: 'skeptic', input: { thread: p.id, at: body?.at || '' }, trigger: 'chat', title: 'Skeptic check' }));
// Skeptic's page: what it checked, per workflow, and how often the user overruled a pass
on('GET', '/api/skeptic', () => {
  const all = skeptic.history({ days: 30 });
  const by = {};
  for (const v of all) {
    const w = (by[v.workflow] ||= { checks: 0, pass: 0, fix_output: 0, blocked: 0, models: {} });
    w.checks++; w[v.verdict] = (w[v.verdict] || 0) + 1; if (v.model) w.models[v.model] = (w.models[v.model] || 0) + 1;
  }
  return { workflows: by, recent: all.slice(-40).reverse(), criteria: { chat: review.criteriaPath(), build: review.buildCriteriaPath() } };
});
/** body: { message, thread?: id | "recent", via?, route?, model?, effort? } -> the job, plus the thread id it went to */
on('POST', '/api/chat', ({ body }) => {
  const pasted = Array.isArray(body.images) ? body.images.slice(0, 6) : [];
  const attached = Array.isArray(body.files) ? body.files.slice(0, 10) : [];
  // The message is kept exactly as typed. An image or file sent with no words stays wordless: nothing is put in the user's
  // mouth (the chat shows only what they sent), and the engine is told separately that they sent it without a question.
  const message = String(body.message || '').trim();
  if (!message && !pasted.length && !attached.length) throw Object.assign(new Error('Say something first'), { status: 400 });
  // The same spoken request arriving twice within a few seconds (two windows, an echo) is one request.
  if (body.via === 'voice') {
    const dupe = jobs.list().find(j => j.agent === 'jade' && j.trigger === 'voice' && j.input?.message?.toLowerCase() === message.toLowerCase() && Date.now() - Date.parse(j.createdAt) < 8000);
    if (dupe) return { ...dupe, thread: dupe.input.thread, duplicate: true };
  }
  const thread = store.resolveThread(body.thread);
  // An explicit model choice is remembered on the conversation; otherwise the conversation's own choice applies.
  if (body.model !== undefined || body.effort !== undefined) store.updateThread(thread, { model: body.model, effort: body.effort });
  const prefs = store.getThread(thread) || {};
  // Pasted images become files in the data folder; the turn keeps their paths, and the engine is told to open them.
  const images = pasted.map(d => store.saveImage(thread, d));
  // Other attached files are saved the same way, under their own names, and named in the turn so the engine reads them.
  const files = attached.map(f => store.saveAttachment(thread, f));
  const extra = { ...(images.length ? { images } : {}), ...(files.length ? { files } : {}) };
  store.appendTurn(thread, { role: 'user', text: message, via: body.via || 'text', ...extra });
  // "okay, have Skeptic check it": Skeptic checks Jade's last reply here instead of Jade answering
  if (review.asksForSkeptic(message) && !images.length && !files.length) return { ...jobs.enqueue({ agent: 'skeptic', input: { thread }, trigger: 'chat', title: 'Skeptic check' }), thread };
  const j = jobs.enqueue({ agent: 'jade', input: { message, route: body.route || '', thread, via: body.via || 'text', ...extra }, trigger: body.via || 'chat', model: prefs.model || undefined });
  return { ...j, thread };
});

// ------------------------------------------------------------- bridge (a Claude session reading and updating Jade; see bridge/README.md)
// Off until the user switches it on (Settings > Claude bridge): these routes answer 403 before that.
const bridgeOn = fn => router.guard(() => { if (!config.get().bridge?.enabled) throw Object.assign(new Error('The Claude bridge is switched off. Turn it on in Settings first.'), { status: 403 }); }, fn);
on('GET', '/api/bridge/status', bridgeOn(() => bridge.status()));
on('POST', '/api/bridge/handoff', bridgeOn(({ body }) => bridge.handoff(body || {})));
on('POST', '/api/bridge/ask', bridgeOn(({ body }) => bridge.ask(body || {})));
on('POST', '/api/bridge/run', bridgeOn(({ body }) => bridge.run(body || {})));
on('POST', '/api/bridge/note', bridgeOn(({ body }) => bridge.note(body || {})));

// ------------------------------------------------------------- voice models (offline wake word, downloaded once)
on('GET', '/api/voice/model-status', modules.only('voice', () => voicemodel.status()));
// a speech model is downloaded from the internet, so only once the user has switched Voice on
on('POST', '/api/voice/model', modules.only('voice', ({ body }) => voicemodel.download(body?.size || 'small')));

// ------------------------------------------------------------- dispatcher
export async function handle(req, res, url, body) {
  const hit = router.match(req.method, url.pathname, false);
  if (hit) return await hit.fn({ p: hit.p, q: url.searchParams, body, req, res });
  // The file itself, for previews (HTML in a sandboxed frame, PDFs, images). Only files in folders Jade can reach.
  if (url.pathname === '/api/files/raw') {
    // Saved paths are kept as "~\…" (a project's dashboard, for one), so expand ~ first; resolving it as it was made it a
    // folder named "~" under Jade's own directory, outside every allowed root, and the preview frame showed the 403 JSON.
    const p = resolveHome(url.searchParams.get('path') || '');
    if (!files.allowed(p) || !fs.existsSync(p) || !fs.statSync(p).isFile()) throw Object.assign(new Error('Not available'), { status: 403 });
    try { fs.accessSync(p, fs.constants.R_OK); } catch { throw Object.assign(new Error('Jade is not allowed to read that file'), { status: 403 }); }
    const types = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.json': 'application/json' };
    res.writeHead(200, { 'content-type': types[path.extname(p).toLowerCase()] || 'application/octet-stream', 'content-length': fs.statSync(p).size, 'cache-control': 'no-store',
      // previewed HTML runs in a sandboxed frame with an opaque origin and may not touch Jade or the network
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox allow-scripts; default-src 'none'; img-src data: blob: 'self'; style-src 'unsafe-inline' 'self'; font-src data: 'self'; script-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'self'" });
    sendFile(res, p);
    return undefined;
  }
  if (url.pathname === '/api/voice/model.tar.gz') {
    modules.requireOn('voice');
    const f = voicemodel.file(url.searchParams.get('size') || 'small');
    if (!fs.existsSync(f)) throw Object.assign(new Error('Model not downloaded'), { status: 404 });
    res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': fs.statSync(f).size, 'cache-control': 'max-age=31536000' });
    sendFile(res, f);
    return undefined;
  }
  throw Object.assign(new Error('No route ' + req.method + ' ' + url.pathname), { status: 404 });
}

