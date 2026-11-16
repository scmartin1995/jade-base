import { createLatest, pageOf, hasMore, nextSize, showing } from '../paging.js';
// Notes: markdown files in the data folder (or a project's Jade folder), linked to projects. Autosaves; Jade can extract action items.
export default {
  title: 'Notes',
  refreshOn: ['notes'],
  async render(root, ctx) {
    const { api, ui, go, runAgent, params, state } = ctx;
    // only the newest request may draw: a slow answer for an old search, or for a page the user has left, is dropped
    const mine = (this._latest ||= createLatest()).begin(), live = () => mine() && state.route === 'notes' && root.isConnected;
    const { esc, icon } = ui;
    const pf = this._project || '';
    // the server filters and pages the list (newest first); the server says how many there are in all
    const page = this._n ||= 50;
    const query = new URLSearchParams({ limit: String(page), paged: '1', ...(pf ? { project: pf } : {}), ...(this._q ? { q: this._q } : {}) });
    const [found, projects] = await Promise.all([api('GET', `/api/notes?${query}`), api('GET', '/api/projects')]);
    const sel = params[0] ? await api('GET', `/api/notes/${encodeURIComponent(params[0])}`).catch(() => null) : null;
    if (!live()) return;
    const { items: shown, total } = pageOf(found), more = hasMore(shown.length, total);
    const preview = this._preview && sel;

    root.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Capture</div><h1>Notes</h1><p>Plain markdown files, searchable by every agent. A note for a project is kept in that project's own Jade folder; the rest in Jade's data folder. Paste meeting notes, then pull out the actions.</p></div>
        <div class="tools"><button class="btn primary" data-new>${icon('plus', 16)}New note</button></div>
      </div>
      <div class="split ${sel ? 'detail-open' : ''}">
        <div class="card pane-list">
          <div class="stack" style="gap:8px;margin-bottom:8px">
            <input type="search" id="nq" placeholder="Search notes…" value="${esc(this._q || '')}" aria-label="Search notes">
            <select id="np" aria-label="Filter by project">${ui.projectOptions(projects, pf, 'All projects')}</select>
          </div>
          <div class="list">${shown.map(n => `<a class="item link" href="#/notes/${esc(n.id)}" style="text-decoration:none;display:block;${sel?.id === n.id ? 'background:color-mix(in srgb,var(--accent) 16%,transparent);padding-left:8px' : ''}">
            <div class="title ellipsis">${esc(n.title)}</div>
            <div class="tiny dim" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(n.preview.replace(/[#*_>`-]/g, ''))}</div>
            <div class="meta"><span>${ui.ago(n.updated)}</span>${n.project ? `<span>${esc(projects.find(p => p.id === n.project)?.name || n.project)}</span>` : ''}</div></a>`).join('') || '<div class="empty">No notes.</div>'}</div>
          ${more ? '<button class="btn sm ghost" data-more style="width:100%;margin-top:8px">Show more notes</button>' : ''}
          ${showing(shown.length, total) ? `<div class="tiny muted" style="margin-top:6px">${showing(shown.length, total)}</div>` : ''}
        </div>
        <div class="card pane-detail">
          ${sel ? `
            <div class="row wrap" style="margin-bottom:12px">
              <a class="btn sm ghost back" href="#/notes">${icon('arrow_left', 14)}Notes</a>
              <span class="tiny muted grow" id="save-state">Saved ${ui.ago(sel.updated)}</span>
              <button class="btn sm" data-preview>${icon(preview ? 'edit' : 'doc', 14)}${preview ? 'Edit' : 'Preview'}</button>
              ${ui.askBtn(ui.askPrompt('Note', sel.title, sel.body, 'Summarise this and tell me what needs follow-up.'))}<button class="btn sm" data-extract>${icon('checks', 14)}Extract actions</button>
              <button class="btn sm icon danger" data-del aria-label="Delete note">${icon('trash', 14)}</button>
            </div>
            <div class="form">
              <input id="nt" value="${esc(sel.title)}" aria-label="Title" style="font-size:20px;height:46px;font-weight:600">
              <div class="two"><select id="nproj" aria-label="Project">${ui.projectOptions(projects, sel.project)}</select><input id="ntags" value="${esc((sel.tags || []).join(', '))}" placeholder="tags, comma separated" aria-label="Tags"></div>
              ${preview ? `<article class="md" style="min-height:50vh">${ui.md(sel.body)}</article>` : `<textarea id="nb" style="min-height:56vh" placeholder="Write in markdown… paste meeting notes, decisions, ideas.">${esc(sel.body)}</textarea>`}
            </div>`
          : `<div class="empty-big">${icon('pen', 40)}<h2>Write it down</h2><p>Select a note, or start one. Jade reads your notes when you ask about a project.</p><button class="btn primary" data-new>${icon('plus', 16)}New note</button></div>`}
        </div>
      </div>`;

    const $ = s => root.querySelector(s);
    root.querySelectorAll('[data-new]').forEach(b => b.onclick = async () => { const n = await api('POST', '/api/notes', { title: 'Untitled note', project: pf, body: '' }); go('notes/' + n.id); });
    $('#nq').oninput = e => { this._q = e.target.value; this._n = 50; clearTimeout(this._t); this._t = setTimeout(() => { if (!live()) return; this.render(root, ctx).then(() => { const i = root.querySelector('#nq'); if (!i || state.route !== 'notes') return; i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 200); };
    $('#np').onchange = e => { this._project = e.target.value; this._n = 50; this.render(root, ctx); };
    $('[data-more]')?.addEventListener('click', () => { this._n = nextSize(this._n, 50, total); this.render(root, ctx); });
    if (!sel) return;
    let t;
    const save = () => {
      clearTimeout(t);
      $('#save-state').textContent = 'Saving…';
      t = setTimeout(async () => {
        const body = $('#nb') ? $('#nb').value : sel.body;
        await api('PUT', `/api/notes/${sel.id}`, { title: $('#nt').value, project: $('#nproj').value, tags: $('#ntags').value.split(',').map(s => s.trim()).filter(Boolean), body });
        sel.body = body;
        const st = root.querySelector('#save-state'); if (st) st.textContent = 'Saved';
      }, 600);
    };
    ['#nt', '#nb', '#ntags'].forEach(s => $(s)?.addEventListener('input', save));
    $('#nproj').onchange = save;
    $('[data-preview]').onclick = () => { this._preview = !this._preview; this.render(root, ctx); };
    $('[data-extract]').onclick = async () => { try { if ($('#nb')) { await api('PUT', `/api/notes/${sel.id}`, { body: $('#nb').value }); } await runAgent('note-actions', { note: sel.id }); } catch (err) { ui.toast(err.message, 'error'); } };
    $('[data-del]').onclick = async () => { if (await ui.confirmBox('Delete note?', sel.title, 'Delete', 'danger')) { await api('DELETE', `/api/notes/${sel.id}`); go('notes'); } };
  },
};
