// Dashboards: each project with how it is set up in Claude Code, and its dashboards. A dashboard is a saved specification (which
// sections, from which data) that a model chose from the project manager's answers. Opening it draws it with Jade's own code from
// fresh figures, so a refresh uses no model; only new answers, "Rebuild" and "Change it" ask the model.
import { runQuestionnaire } from '../questionnaire.js';
import { renderDashboard } from '../dashboard/view.js';

const BUILD_AGENT = 'dashboard-builder';
export const building = (state, pid, did) => (state?.jobs || []).some(j => j.agent === BUILD_AGENT && j.input?.project === pid && (!did || j.input?.dashboard === did) && (j.status === 'running' || j.status === 'queued'));

/** The set-up of one project's folders in plain words, with the button that copies the command for Claude Code. */
export function claudeBlock(ui, claude = []) {
  const { esc, icon } = ui;
  if (!claude.length) return '<div class="tiny muted">No folder is linked to this project yet, so there is nothing to show about Claude Code.</div>';
  return claude.map(f => `<div class="dash-setup"><div class="grow" style="min-width:0">
      <div class="small">${esc(f.summary || '')}</div><div class="tiny muted mono ellipsis">${esc(f.folder)}</div></div>
    ${f.exists ? `<button class="btn sm ghost" data-copy-cmd="${esc(f.command)}">${icon('copy', 13)}Copy the command to open Claude Code here</button>` : ''}</div>`).join('');
}

/** One dashboard in a list, with what can be done to it. */
export function dashboardRow(ui, project, d, { busy = false } = {}) {
  const { esc, icon } = ui;
  const older = d.kind === 'older';
  const built = d.builtAt ? `built ${ui.ago(d.builtAt)}` : 'not built yet';
  const meta = older ? '<span class="chip" style="height:20px">older dashboard</span><span>a page made before dashboards worked the new way; it no longer shows live figures</span>'
    : `<span>${busy ? 'Building…' : esc(built)}</span>${!d.exists && d.builtAt ? '<span>the file is missing</span>' : ''}`;
  const buttons = older
    ? `${d.exists ? `<button class="btn sm" data-preview-file="${esc(d.path)}" data-file-name="${esc(String(d.path).split(/[\\/]/).pop())}">${icon('external', 13)}Open file</button>` : ''}
      <button class="btn sm primary" data-act="${d.answers ? 'rebuild' : 'fresh'}" ${busy ? 'disabled' : ''}>${icon('spark', 13)}Rebuild in the new style</button>`
    : `<button class="btn sm" data-act="open" ${busy || !d.exists ? 'disabled' : ''}>${icon('external', 13)}Open</button>
      <button class="btn sm ghost" data-act="rebuild" ${busy ? 'disabled' : ''}>${icon('spark', 13)}Rebuild</button>
      <button class="btn sm ghost" data-act="answers" ${busy ? 'disabled' : ''}>${icon('edit', 13)}Change answers</button>`;
  return `<div class="item row dash-row" data-dash="${esc(d.id)}" data-project="${esc(project.id)}">
    <div class="main-col"><div class="title">${esc(d.name)}</div><div class="meta">${meta}</div></div>
    <div class="row wrap" style="gap:6px;justify-content:flex-end">${buttons}
      <button class="btn sm ghost icon" data-act="delete" aria-label="Delete ${esc(d.name)}">${icon('trash', 13)}</button></div></div>`;
}

/** Wire the copy buttons and the dashboard buttons inside `root`. `redo()` draws the list again. */
export function wire(root, ctx, projects, redo) {
  const { api, ui } = ctx;
  root.querySelectorAll('[data-copy-cmd]').forEach(b => { b.onclick = () => ui.copy(b.dataset.copyCmd); });
  root.querySelectorAll('[data-new]').forEach(b => { b.onclick = () => { location.hash = `#/dashboards?new=${encodeURIComponent(b.dataset.new)}`; }; });
  root.querySelectorAll('.dash-row [data-act]').forEach(b => {
    b.onclick = async () => {
      const row = b.closest('.dash-row'), pid = row.dataset.project, did = row.dataset.dash;
      const project = projects.find(p => p.id === pid), d = (project?.dashboards || []).find(x => x.id === did);
      const base = `/api/projects/${encodeURIComponent(pid)}/dashboards/${encodeURIComponent(did)}`;
      try {
        if (b.dataset.act === 'open') { location.hash = `#/dashboards?open=${encodeURIComponent(pid)}~${encodeURIComponent(did)}`; return; }
        if (b.dataset.act === 'fresh') { location.hash = `#/dashboards?new=${encodeURIComponent(pid)}`; return; }
        if (b.dataset.act === 'rebuild') { const r = await api('POST', base + '/rebuild'); ui.toast(`${r.job.title} started`, 'info', 2400); return redo(); }
        if (b.dataset.act === 'answers') { location.hash = `#/dashboards?edit=${encodeURIComponent(pid)}~${encodeURIComponent(did)}`; return; }
        if (b.dataset.act === 'delete' && await ui.confirmBox('Delete this dashboard?', `"${d.name}" will be removed. Your notes, actions and files stay.`, 'Delete', 'danger')) { await api('DELETE', base); return redo(); }
      } catch (e) { ui.toast(e.message, 'error'); }
    };
  });
}

/** One dashboard, drawn from its specification and fresh figures; with "Change it" and controls for its sections. */
export async function openDashboard(ctx, root, pid, did, back) {
  const { api, ui, state } = ctx;
  const { esc, icon } = ui;
  const base = `/api/projects/${encodeURIComponent(pid)}/dashboards/${encodeURIComponent(did)}`;
  let v;
  try { v = await api('GET', base + '/view'); }
  catch (e) { root.innerHTML = `<div class="page-head"><div><div class="eyebrow">Dashboards</div><h1>Dashboard</h1></div><a class="btn" href="#/dashboards">All dashboards</a></div><div class="card empty">${esc(e.message)}</div>`; return; }
  const working = building(state, pid, did);
  root.innerHTML = `<div class="page-head"><div><div class="eyebrow"><a href="#/dashboards" style="color:inherit">Dashboards</a> · ${esc(v.data.project.name)}</div><h1>${esc(v.dashboard.name)}</h1></div>
      <div class="row" style="gap:8px"><button class="btn" data-refresh>${icon('refresh', 14)}Refresh</button><a class="btn ghost" href="#/dashboards">All dashboards</a></div></div>
    ${working ? '<div class="card tiny muted" style="margin-bottom:14px">Jade is working on this dashboard. It will update when that is done.</div>' : ''}
    <div data-doc></div>
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('edit')}Change it</h2></div>
      <p class="small muted" style="margin:0 0 8px">Say what you would like different, in your own words. Jade keeps everything you do not mention.</p>
      <textarea data-change rows="3" maxlength="2000" placeholder="e.g. Add a chart of actions by owner, and drop the notes table" style="width:100%"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary" data-go ${working ? 'disabled' : ''}>${icon('spark', 14)}Change it</button></div>
      <div class="eyebrow" style="margin:16px 0 6px">Sections</div>
      <div class="list" data-sections>${v.spec.sections.map((sec, i) => `<div class="item row" data-i="${i}"><div class="main-col"><div class="title">${esc(sec.title)}</div><div class="meta"><span>${esc(v.schema.layouts[sec.layout]?.label || sec.layout)}</span></div></div>
        <div class="row" style="gap:4px"><button class="btn sm ghost icon" data-move="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
        <button class="btn sm ghost icon" data-move="1" aria-label="Move down" ${i === v.spec.sections.length - 1 ? 'disabled' : ''}>&darr;</button>
        <button class="btn sm ghost icon" data-remove aria-label="Remove this section" ${v.spec.sections.length === 1 ? 'disabled' : ''}>${icon('trash', 13)}</button></div></div>`).join('')}</div></section>`;
  root.querySelector('[data-doc]').appendChild(await renderDashboard(v.spec, v.data, v.schema));
  root.querySelector('[data-refresh]').onclick = () => openDashboard(ctx, root, pid, did, back);
  root.querySelector('[data-go]').onclick = async () => {
    const change = root.querySelector('[data-change]').value.trim();
    if (!change) return ui.toast('Say what you would like changed.', 'info', 2400);
    try { const r = await api('POST', base + '/change', { change }); ui.toast(`${r.job.title} started`, 'info', 2600); root.querySelector('[data-change]').value = ''; } catch (e) { ui.toast(e.message, 'error'); }
  };
  root.querySelectorAll('[data-sections] .item').forEach(row => {
    const i = Number(row.dataset.i);
    const post = async body => { try { await api('POST', base + '/sections', body); await openDashboard(ctx, root, pid, did, back); } catch (e) { ui.toast(e.message, 'error'); } };
    row.querySelectorAll('[data-move]').forEach(b => { b.onclick = () => post({ action: 'move', index: i, to: i + Number(b.dataset.move) }); });
    row.querySelector('[data-remove]').onclick = async () => { if (await ui.confirmBox('Remove this section?', `"${v.spec.sections[i].title}" will be taken off the dashboard. Your data stays.`, 'Remove', 'danger')) post({ action: 'remove', index: i }); };
  });
}

/** Leave the questionnaire: it is taken off the page first, because the list does not redraw while one is open (that guard keeps a background refresh from wiping answers). */
export function leaveAsk(host, back) { host.innerHTML = ''; back(); }

/** Ask the questions (new dashboard, or change the answers of one), save, and start the build. */
export async function ask(ctx, host, project, existing, back) {
  const { api, ui } = ctx;
  host.innerHTML = '<div class="tiny muted">Getting the questions ready…</div>';
  let questions;
  try { questions = (await api('GET', `/api/dashboards/questions?project=${encodeURIComponent(project.id)}`)).questions; }
  catch (e) { ui.toast(e.message, 'error'); return back(); }
  runQuestionnaire(host, {
    title: existing ? `Change answers · ${existing.name}` : `New dashboard · ${project.name}`,
    intro: 'A few questions, then Jade chooses what the dashboard shows. You can change the answers later and it will choose again.',
    questions, answers: existing?.answers || {}, api, doneLabel: existing ? 'Save and rebuild' : 'Build the dashboard',
    onCancel: () => leaveAsk(host, back),
    onDone: async answers => {
      const r = existing ? await api('PATCH', `/api/projects/${encodeURIComponent(project.id)}/dashboards/${encodeURIComponent(existing.id)}`, { answers })
        : await api('POST', `/api/projects/${encodeURIComponent(project.id)}/dashboards`, { answers });
      ui.toast(`${r.job.title} started · Esc to stop`, 'info', 2600);
      leaveAsk(host, back);
    },
  });
}

const view = {
  title: 'Dashboards',
  refreshOn: ['projects', 'jobs'],
  async render(root, ctx) {
    const { api, ui, state } = ctx;
    const { esc, icon } = ui;
    // a questionnaire is open on a "new" or "change answers" address: a background refresh must not wipe the answers.
    // A different address (the list, or an open dashboard) always draws, so the page and the address agree.
    if (root.querySelector('.qn') && (state.query?.get('new') || state.query?.get('edit'))) return;
    let projects;
    try { projects = await api('GET', '/api/dashboards'); }
    catch (e) {
      console.error('Dashboards could not be loaded:', e);
      root.innerHTML = `<div class="page-head"><div><div class="eyebrow">Dashboards</div><h1>Dashboards</h1></div></div><div class="card empty">Dashboards could not be loaded (${esc(e.message)}). This does not mean you have none. Try again in a moment.</div>`;
      return;
    }
    const q = state.query;
    const draw = () => ctx.go('dashboards');
    const newId = q?.get('new'), edit = (q?.get('edit') || '').split('~'), open = (q?.get('open') || '').split('~');
    if (open[0] && open[1]) return openDashboard(ctx, root, open[0], open[1], draw);
    const target = projects.find(p => p.id === (newId || edit[0]));
    const existing = target && !newId ? target.dashboards.find(d => d.id === edit[1]) : null;
    if (target && !newId && !existing) {   // an old link: never start a new dashboard from a "Change answers" page
      root.innerHTML = `<div class="page-head"><div><div class="eyebrow">Dashboards</div><h1>Change answers</h1></div><a class="btn" href="#/dashboards">All dashboards</a></div><div class="card empty">That dashboard is not there any more. It may have been deleted in another window.</div>`;
      return;
    }
    if (target) {
      root.innerHTML = `<div class="page-head"><div><div class="eyebrow">Dashboards</div><h1>${newId ? 'New dashboard' : 'Change answers'}</h1></div></div><div data-ask></div>`;
      return ask(ctx, root.querySelector('[data-ask]'), target, existing, draw);
    }
    root.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Dashboards</div><h1>Dashboards</h1>
        <p>For each project: how it is set up in Claude Code, and its dashboards. Jade works out the figures again every time you open a dashboard, which costs nothing; it only asks the model when you create a dashboard, change your answers, rebuild it or ask for a change.</p></div></div>
      ${projects.length ? projects.map(p => `<section class="card" style="margin-bottom:16px" data-proj="${esc(p.id)}">
        <div class="card-head"><h2>${icon('grid')}<a href="#/project/${esc(p.id)}" style="color:inherit;text-decoration:none">${esc(p.name)}</a></h2>
          <button class="btn sm primary" data-new="${esc(p.id)}">${icon('plus', 14)}New dashboard</button></div>
        <div class="eyebrow" style="margin:2px 0 6px">Set up in Claude Code</div>
        ${claudeBlock(ui, p.claude)}
        <div class="eyebrow" style="margin:14px 0 6px">Dashboards</div>
        <div class="list">${p.dashboards.map(d => dashboardRow(ui, p, d, { busy: building(state, p.id, d.id) })).join('') || '<div class="empty">No dashboards yet. Choose New dashboard and answer a few questions.</div>'}</div>
      </section>`).join('') : `<div class="card empty-big">${icon('grid', 40)}<h2>No projects yet</h2><p>Add a project first. Then its dashboards and Claude Code set-up show here.</p><a class="btn primary" href="#/projects">Go to projects</a></div>`}`;
    wire(root, ctx, projects, () => view.render(root, ctx));
  },
};
export default view;
