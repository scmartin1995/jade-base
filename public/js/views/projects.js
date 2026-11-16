import { pageOf } from '../paging.js';
// Projects: a plain list of project cards (name, description, folders, open actions), and the form that creates or edits one.
export async function projectForm(ui, p = {}, api) {
  const { esc, icon } = ui;
  const folders = [...(p.folders || [])];
  const folderList = () => folders.length
    ? folders.map((f, i) => `<span class="chip on" style="height:28px">${icon('folder', 12)}<span class="mono">${esc(f)}</span><span class="x" data-rmf="${i}" role="button" aria-label="Remove ${esc(f)}">${icon('x', 12)}</span></span>`).join('')
    : '<span class="tiny muted">No folders yet.</span>';
  const r = await ui.modal({
    title: p.id ? 'Edit project' : 'New project',
    body: `<form class="form">
      <label class="field">Name<input name="name" value="${esc(p.name || '')}" required autofocus></label>
      <label class="field">What it is<textarea name="description" rows="3" style="min-height:80px">${esc(p.description || '')}</textarea></label>
      <label class="field">Owner<input name="owner" value="${esc(p.owner || '')}"></label>
      <div class="field" style="display:grid;gap:8px">Project folders <small>where this project's documents live. Jade reads them when you ask about this project.</small>
        <div class="row wrap" data-folders style="gap:6px">${folderList()}</div>
        <button type="button" class="btn sm" data-addf style="justify-self:start">${icon('folder', 14)}Add folder…</button></div>
      <label class="field">Tags <small>comma separated</small><input name="tags" value="${esc((p.tags || []).join(', '))}"></label>
    </form>`,
    actions: [{ label: 'Cancel', kind: 'ghost', value: null }, { label: p.id ? 'Save' : 'Create project', kind: 'primary', onClick: d => d.name?.trim() ? d : (ui.toast('Give it a name', 'error'), false) }],
    onMount: wrap => {
      const paint = () => {
        wrap.querySelector('[data-folders]').innerHTML = folderList();
        wrap.querySelectorAll('[data-rmf]').forEach(x => x.onclick = () => { folders.splice(+x.dataset.rmf, 1); paint(); });
      };
      paint();
      wrap.querySelector('[data-addf]').onclick = async () => {
        const f = await ui.chooseFolder(api, { title: `Choose a folder for ${p.name || 'this project'}` });
        if (f && !folders.includes(f)) { folders.push(f); paint(); }
      };
    },
  });
  if (!r) return null;
  const list = s => String(s || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);
  return { ...r, tags: list(r.tags), folders };
}

export default {
  title: 'Projects',
  refreshOn: ['projects', 'actions'],
  async render(root, ctx) {
    const { api, ui, go, state } = ctx;
    const { esc, icon } = ui;
    // every open action (paged=1 has no cap), so a project's count is the true count
    const [projects, openList] = await Promise.all([api('GET', '/api/projects'), api('GET', '/api/actions?status=open&paged=1&limit=1000000')]);
    const actions = pageOf(openList).items;
    const show = this._filter || 'active';
    const list = projects.filter(p => show === 'all' || (show === 'archived' ? p.archived : !p.archived));

    root.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Projects</div><h1>Projects</h1><p>Each project points at its folders. Notes, actions and files that belong to it are gathered on its page.</p></div>
        <div class="tools">
          <div class="tabs">${['active', 'archived', 'all'].map(f => `<button data-f="${f}" class="${show === f ? 'on' : ''}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
          <button class="btn primary" data-new>${icon('plus', 16)}New project</button>
        </div>
      </div>

      ${list.length ? `<div class="grid auto">${list.map(p => {
        const open = actions.filter(a => a.project === p.id && a.status !== 'done');
        const folders = p.folders || [];
        return `<article class="card hover proj-card" data-open="${esc(p.id)}" tabindex="0" aria-label="${esc(p.name)}">
          <div class="top">
            <div class="grow"><div class="row" style="gap:8px;margin-bottom:6px">${p.archived ? '<span class="chip">archived</span>' : ''}</div>
              <h3>${esc(p.name)}</h3></div>
          </div>
          <div class="summary">${esc(p.description || 'No description yet.')}</div>
          <div class="kv">
            <div><span>Folders</span><b title="${esc(folders.join(', '))}">${folders.length ? esc(folders.map(f => f.replace(/[\\/]+$/, '').split(/[\\/]/).pop()).join(', ')) : '—'}</b></div>
            <div><span>Actions</span><b>${open.length} open</b></div>
          </div>
        </article>`;
      }).join('')}</div>`
      : `<div class="card empty-big">${icon('grid', 40)}<h2>${show === 'archived' ? 'Nothing archived' : 'No projects yet'}</h2>
          <p>Add a project and point it at its folder. Jade keeps its notes and actions together and can answer questions about its files.</p>
          ${show !== 'archived' ? `<button class="btn primary" data-new>${icon('plus', 16)}Add your first project</button>` : ''}</div>`}`;

    const create = async () => { const d = await projectForm(ui, {}, api); if (d) { const p = await api('POST', '/api/projects', d); go('project/' + p.id); } };
    root.querySelectorAll('[data-new]').forEach(b => b.onclick = create);
    root.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { this._filter = b.dataset.f; this.render(root, ctx); });
    root.querySelectorAll('[data-open]').forEach(c => {
      c.onclick = e => { if (!e.target.closest('button')) go('project/' + c.dataset.open); };
      c.onkeydown = e => { if (e.key === 'Enter') go('project/' + c.dataset.open); };
    });
    if (state.query?.has('new')) { history.replaceState(null, '', '#/projects'); state.query = null; create(); }
  },
};
