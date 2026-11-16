// One project: description, folders, files, notes and actions. Modules add cards below (dashboards, meetings).
import { projectForm } from './projects.js';
import { sourceHtml } from '../actionsource.js';

// Panels that modules add to a project page. A manifest declares projectPanels: [{ id, title, view: 'file.js', order }]; each enabled
// module's panels are drawn after the page's own cards. The view is a built-in (/js/views/) or a user module's (/modules/<id>/views/)
// whose default export has render(root, ctx, project).
const VIEW_FILE = /^[\w][\w.-]*\.js$/;
export function projectPanels(modules = []) {
  const out = [];
  for (const m of modules) {
    if (!m?.enabled || !Array.isArray(m.projectPanels)) continue;
    for (const x of m.projectPanels) {
      if (!x || typeof x.id !== 'string' || typeof x.view !== 'string' || !VIEW_FILE.test(x.view)) continue;
      const base = m.source === 'user' ? `/modules/${encodeURIComponent(m.id)}/views/` : '/js/views/';
      out.push({ key: `${m.id}/${x.id}`, module: m.id, id: x.id, title: String(x.title || m.name || x.id), url: base + x.view, order: Number.isFinite(x.order) ? x.order : 500, moduleOrder: m.order ?? 500 });
    }
  }
  return out.sort((a, b) => (a.order - b.order) || (a.moduleOrder - b.moduleOrder) || a.key.localeCompare(b.key));
}
/** Fill `host` with one card per panel. A panel that fails to load says so and the others still show. */
export async function renderPanels(host, ctx, project, load = u => import(u)) {
  const { esc } = ctx.ui;
  const list = projectPanels(ctx.state?.boot?.modules);
  host.innerHTML = list.map(x => `<section class="card" data-panel="${esc(x.key)}"><div class="card-head"><h2>${esc(x.title)}</h2></div><div data-panel-body="${esc(x.key)}"></div></section>`).join('');
  for (const x of list) {
    const body = host.querySelector(`[data-panel-body="${x.key.replace(/["\\]/g, '')}"]`);
    if (!body) continue;
    try {
      const view = (await load(x.url)).default;
      if (typeof view?.render !== 'function') throw new Error('it has nothing to show');
      await view.render(body, ctx, project);
    } catch (e) { body.innerHTML = `<div class="tiny muted">${esc(x.title)} could not be shown (${esc(e.message || e)}).</div>`; }
  }
}

export default {
  title: 'Project',
  refreshOn: ['projects', 'actions', 'notes', 'jobs', 'meetings'],
  async render(root, ctx) {
    const { api, ui, go, params, state } = ctx;
    const { esc, icon } = ui;
    let data;
    try { data = await api('GET', `/api/projects/${encodeURIComponent(params[0])}`); }
    catch { root.innerHTML = `<div class="empty-big"><h2>Project not found</h2><a class="btn" href="#/projects">Back to projects</a></div>`; return; }
    const { project: p, notes, actions } = data;
    const meetings = await api('GET', `/api/meetings?project=${encodeURIComponent(p.id)}`).catch(() => []);   // an action from a meeting links back to it
    const pfiles = (p.folders || []).length ? await api('GET', `/api/files?project=${encodeURIComponent(p.id)}&limit=8`).catch(() => []) : [];
    const open = actions.filter(a => a.status !== 'done');
    root.innerHTML = `
      <div class="page-head">
        <div class="grow">
          <a href="#/projects" class="small dim row" style="gap:6px;margin-bottom:8px;width:max-content">${icon('arrow_left', 14)}Projects</a>
          <div class="row wrap" style="gap:10px;margin-bottom:6px">${p.archived ? '<span class="chip">archived</span>' : ''}${p.owner ? `<span class="tiny muted">owner: ${esc(p.owner)}</span>` : ''}</div>
          <h1>${esc(p.name)}</h1>
          <p>${esc(p.description || '')}</p>
          ${p.storageNotice ? `<p class="tiny muted">${esc(p.storageNotice)}</p>` : ''}
        </div>
        <div class="tools">
          <button class="btn icon" data-edit title="Edit" aria-label="Edit project">${icon('edit', 16)}</button>
          ${ui.askBtn(ui.askPrompt('Project', p.name, p.description || '', 'Give me your read on where this stands and the one thing to do next.'), { small: false, ghost: false })}
          <button class="btn icon" data-more title="More" aria-label="More">${icon('more', 16)}</button>
        </div>
      </div>

      <div class="grid g2" style="align-items:start">
        <div class="stack" style="gap:16px">
          <section class="card">
            <div class="card-head"><h2>${icon('checks')}Actions</h2><a class="btn sm ghost" href="#/actions">All</a></div>
            <form class="row" data-quick style="margin-bottom:6px"><input name="text" placeholder="Add an action for ${esc(p.name)}…" aria-label="New action"><input type="date" name="due" style="width:150px" aria-label="Due date"><button class="btn icon" aria-label="Add">${icon('plus', 16)}</button></form>
            <div class="list">${[...open, ...actions.filter(a => a.status === 'done').slice(0, 3)].map(a => `<div class="item ${a.status === 'done' ? 'done' : ''}">
              <button class="check ${a.status === 'done' ? 'done' : ''}" data-done="${a.id}" data-state="${a.status}" aria-label="Toggle">${icon('check', 13)}</button>
              <div class="main-col"><div class="title">${esc(a.text)}</div><div class="meta">${a.due ? `<span style="color:${a.status !== 'done' && ui.daysUntil(a.due) < 0 ? 'var(--red)' : 'inherit'}">${esc(ui.dueLabel(a.due))}</span>` : ''}${a.owner ? `<span>${esc(a.owner)}</span>` : ''}${sourceHtml(esc, a, meetings)}</div>${a.status === 'done' && a.doneNote ? `<div class="done-note">${icon('pen', 11)}${esc(a.doneNote)}</div>` : ''}</div></div>`).join('') || '<div class="empty">No actions.</div>'}</div>
          </section>

          <section class="card">
            <div class="card-head"><h2>${icon('pen')}Notes</h2><button class="btn sm" data-note>${icon('plus', 14)}New note</button></div>
            <div class="list">${notes.slice(0, 6).map(n => `<a class="item link" href="#/notes/${esc(n.id)}" style="text-decoration:none"><div class="main-col"><div class="title">${esc(n.title)}</div><div class="meta"><span>${ui.ago(n.updated)}</span></div></div></a>`).join('') || '<div class="empty">No notes linked to this project.</div>'}</div>
          </section>

        </div>

        <div class="stack" style="gap:16px">
          <section class="card">
            <div class="card-head"><h2>${icon('folder')}Files & deliverables</h2><a class="btn sm ghost" href="#/memory/files?project=${esc(p.id)}">All files</a></div>
            ${(p.folders || []).length ? `<input type="search" data-filefilter placeholder="Find a file in this project…" aria-label="Find a file" style="margin-bottom:8px">
              <div class="list" data-filelist>${pfiles.map(f => ui.fileRow(f, { showProject: false })).join('') || '<div class="empty">No files in the linked folders yet.</div>'}</div>
              <div class="tiny muted mono" style="margin-top:8px">${p.folders.map(esc).join(' · ')}</div>`
            : '<div class="tiny muted">No folders linked yet. Edit the project and add the folder where its documents live; files and deliverables then show up here, in the file ring and in Ask.</div>'}
            ${data.jobs.length ? `<div class="eyebrow" style="margin:14px 0 6px">Recent agent runs</div>${data.jobs.slice(0, 5).map(j => `<div class="row small" style="padding:4px 0;cursor:pointer" data-job="${j.id}"><span class="status-dot ${j.status}"></span><span class="grow ellipsis">${esc(j.agentName)}</span><span class="tiny muted">${ui.ago(j.createdAt)}</span></div>`).join('')}` : ''}
          </section>
        </div>
      </div>
      ${projectPanels(state.boot?.modules).length ? '<div class="stack" style="gap:16px;margin-top:16px" data-panels></div>' : ''}`;
    const panels = root.querySelector('[data-panels]');
    if (panels) renderPanels(panels, ctx, p);

    const $ = s => root.querySelector(s);
    $('[data-edit]').onclick = async () => { const d = await projectForm(ui, p, api); if (d) await api('PATCH', `/api/projects/${p.id}`, d); };
    $('[data-more]').onclick = async () => {
      const r = await ui.modal({ title: p.name, body: '<p class="dim">Archived projects are hidden from the list. Deleting removes the project file; notes and actions stay.</p>',
        actions: [{ label: p.archived ? 'Unarchive' : 'Archive', icon: 'archive', value: 'archive' }, { label: 'Delete project', kind: 'danger', icon: 'trash', value: 'delete' }] });
      if (r === 'archive') await api('PATCH', `/api/projects/${p.id}`, { archived: !p.archived });
      if (r === 'delete' && await ui.confirmBox('Delete project?', `This deletes ${p.name}. Its notes and actions are kept.`, 'Delete', 'danger')) { await api('DELETE', `/api/projects/${p.id}`); go('projects'); }
    };
    $('[data-quick]').onsubmit = async e => {
      e.preventDefault();
      const t = e.target.text.value.trim();
      if (!t) return;
      await api('POST', '/api/actions', { text: t, project: p.id, due: e.target.due.value });
      e.target.reset();
    };
    root.querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
      if (b.dataset.state === 'done') return api('PATCH', `/api/actions/${b.dataset.done}`, { status: 'open' });
      const note = await ui.doneNote(actions.find(x => x.id === b.dataset.done)?.text || '');
      if (note !== null) api('PATCH', `/api/actions/${b.dataset.done}`, { status: 'done', doneNote: note });
    });
    $('[data-note]').onclick = async () => { const n = await api('POST', '/api/notes', { title: `${p.name} · ${ui.fmtDate(ui.todayStr())}`, project: p.id, body: '' }); go('notes/' + n.id); };
    root.querySelectorAll('[data-job]').forEach(el => el.onclick = () => ctx.openJob(el.dataset.job));
    const ff = $('[data-filefilter]');
    if (ff) ff.oninput = () => { clearTimeout(this._fft); this._fft = setTimeout(async () => {
      const list = await api('GET', `/api/files?project=${encodeURIComponent(p.id)}&q=${encodeURIComponent(ff.value.trim())}&limit=12`).catch(() => []);
      const box = $('[data-filelist]'); if (box) box.innerHTML = list.map(f => ui.fileRow(f, { showProject: false })).join('') || '<div class="empty">No files match.</div>';
    }, 180); };
  },
};
