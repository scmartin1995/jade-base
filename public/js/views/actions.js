// Action items from every source (manual, notes, chat, agents), grouped by when they're due.
import { createLatest, pageOf, hasMore, nextSize } from '../paging.js';
import { sourceHtml } from '../actionsource.js';
export default {
  title: 'Action items',
  refreshOn: ['actions', 'projects'],
  async render(root, ctx) {
    const { api, ui, state } = ctx;
    const mine = (this._latest ||= createLatest()).begin(), live = () => mine() && state.route === 'actions' && root.isConnected;   // a slow answer for an old search or page is dropped
    const { esc, icon } = ui;
    const f = this._f ||= { status: 'open', project: '', owner: '', q: '' };
    // the server filters and orders the list (soonest due first) and sends one page; the server says how many there are in all
    const page = this._n ||= 100;
    const query = new URLSearchParams({ status: f.status, limit: String(page), paged: '1', ...(f.project ? { project: f.project } : {}), ...(f.owner ? { owner: f.owner } : {}), ...(f.q ? { q: f.q } : {}) });
    const [found, owners, projects, meetings] = await Promise.all([api('GET', `/api/actions?${query}`), api('GET', '/api/actions/owners'), api('GET', '/api/projects'), api('GET', '/api/meetings').catch(() => [])]);   // meetings: so an action from one links back to it
    if (!live()) return;
    const { items: actions, total } = pageOf(found), more = hasMore(actions.length, total);
    const shown = actions;
    const bucket = a => {
      if (a.status === 'done') return 'Done';
      const n = ui.daysUntil(a.due);
      if (n === null) return 'No date';
      if (n < 0) return 'Overdue'; if (n === 0) return 'Today'; if (n <= 7) return 'This week'; return 'Later';
    };
    const order = ['Overdue', 'Today', 'This week', 'Later', 'No date', 'Done'];
    const groups = {};
    for (const a of shown.sort((x, y) => (x.due || '9999').localeCompare(y.due || '9999'))) (groups[bucket(a)] ||= []).push(a);
    const pname = id => projects.find(p => p.id === id)?.name || id;

    root.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Follow-through</div><h1>Action items</h1><p>Everything you or anyone owes, from notes, chat and agents. One list. An action for a project is kept in that project's own Jade folder; the rest in Jade's data folder.</p></div>
      </div>
      <section class="card" style="margin-bottom:16px">
        <form class="row wrap" data-add style="gap:8px">
          <input name="text" class="grow" style="min-width:220px;flex:3" placeholder="Add an action… e.g. Send RAID log to Priya" aria-label="Action">
          <select name="project" style="flex:1;min-width:150px" aria-label="Project">${ui.projectOptions(projects, f.project)}</select>
          <input name="owner" placeholder="Owner" style="flex:1;min-width:110px" aria-label="Owner">
          <input type="date" name="due" style="flex:1;min-width:140px" aria-label="Due">
          <select name="priority" style="flex:0 0 120px" aria-label="Priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select>
          <button class="btn primary">${icon('plus', 16)}Add</button>
        </form>
      </section>
      <div class="row wrap" style="margin-bottom:16px;gap:8px">
        <div class="tabs">${['open', 'done', 'all'].map(s => `<button data-s="${s}" class="${f.status === s ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
        <select data-fp style="width:auto;min-width:160px" aria-label="Filter by project">${ui.projectOptions(projects, f.project, 'All projects')}</select>
        <select data-fo style="width:auto;min-width:140px" aria-label="Filter by owner"><option value="">Anyone</option>${owners.map(o => `<option ${o === f.owner ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
        <input type="search" data-fq placeholder="Filter…" value="${esc(f.q)}" style="width:200px" aria-label="Filter text">
        <span class="tiny muted">${more ? `Showing ${shown.length} of ${total}` : `${shown.length} shown`}</span>
      </div>
      ${shown.length ? `<div class="grid g2" style="align-items:start">${order.filter(k => groups[k]).map(k => `<section class="card">
        <div class="card-head"><h3 style="color:${k === 'Overdue' ? 'var(--red)' : k === 'Today' ? 'var(--cyan)' : 'var(--fg-bright)'}">${esc(k)}</h3><span class="chip">${groups[k].length}</span></div>
        <div class="list">${groups[k].map(a => `<div class="item ${a.status === 'done' ? 'done' : ''}">
          <button class="check ${a.status === 'done' ? 'done' : ''}" data-toggle="${a.id}" data-state="${a.status}" aria-label="Toggle done">${icon('check', 13)}</button>
          <div class="main-col"><div class="title">${a.priority === 'high' ? '<span class="prio high" style="margin-right:6px">high</span>' : ''}${esc(a.text)}</div>
            <div class="meta">${a.due ? `<span>${esc(ui.dueLabel(a.due))}</span>` : ''}${a.owner ? `<span>${icon('users', 11)} ${esc(a.owner)}</span>` : ''}${a.project ? `<a href="#/project/${esc(a.project)}">${esc(pname(a.project))}</a>` : ''}${sourceHtml(esc, a, meetings)}</div>${a.status === 'done' && a.doneNote ? `<div class="done-note">${icon('pen', 11)}${esc(a.doneNote)}</div>` : ''}</div>
          ${ui.askBtn(ui.askPrompt('Action item', a.text, [a.owner ? 'Owner: ' + a.owner : '', a.due ? 'Due: ' + a.due : '', a.project ? 'Project: ' + pname(a.project) : ''].filter(Boolean).join('\n'), 'How should I get this done? Draft anything I need.'), { iconOnly: true })}<button class="btn sm ghost icon" data-edit="${a.id}" aria-label="Edit">${icon('edit', 14)}</button>
          <button class="btn sm ghost icon danger" data-del="${a.id}" aria-label="Delete">${icon('trash', 14)}</button></div>`).join('')}</div></section>`).join('')}</div>`
      : `<div class="card empty-big">${icon('checks', 40)}<h2>${f.status === 'done' ? 'Nothing finished yet' : 'All clear'}</h2><p>Add actions above, ask Jade (“remind me to chase the vendor Friday”), or extract them from meeting notes.</p></div>`}
      ${more ? '<div style="margin-top:12px"><button class="btn ghost" data-more>Show more actions</button></div>' : ''}`;

    const $ = s => root.querySelector(s);
    $('[data-add]').onsubmit = async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      if (!d.text.trim()) return;
      await api('POST', '/api/actions', d);
      e.target.reset();
      e.target.text.focus();
    };
    $('[data-more]')?.addEventListener('click', () => { this._n = nextSize(this._n, 100, total); this.render(root, ctx); });
    root.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { f.status = b.dataset.s; this._n = 100; this.render(root, ctx); });
    $('[data-fp]').onchange = e => { f.project = e.target.value; this._n = 100; this.render(root, ctx); };
    $('[data-fo]').onchange = e => { f.owner = e.target.value; this._n = 100; this.render(root, ctx); };
    $('[data-fq]').oninput = e => { f.q = e.target.value; this._n = 100; clearTimeout(this._t); this._t = setTimeout(() => live() && this.render(root, ctx).then(() => { const i = root.querySelector('[data-fq]'); if (!i || state.route !== 'actions') return; i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 200); };
    root.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      if (b.dataset.state === 'done') return api('PATCH', `/api/actions/${b.dataset.toggle}`, { status: 'open' });
      const note = await ui.doneNote(actions.find(x => x.id === b.dataset.toggle)?.text || '');
      if (note !== null) api('PATCH', `/api/actions/${b.dataset.toggle}`, { status: 'done', doneNote: note });
    });
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => api('DELETE', `/api/actions/${b.dataset.del}`));
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
      const a = actions.find(x => x.id === b.dataset.edit);
      const r = await ui.modal({ title: 'Edit action', body: `<form class="form"><label class="field">Action<input name="text" value="${esc(a.text)}" autofocus></label>
        <div class="two"><label class="field">Owner<input name="owner" value="${esc(a.owner)}"></label><label class="field">Due<input type="date" name="due" value="${esc(a.due)}"></label></div>
        <div class="two"><label class="field">Project<select name="project">${ui.projectOptions(projects, a.project)}</select></label>
        <label class="field">Priority<select name="priority">${['high', 'normal', 'low'].map(p => `<option ${p === a.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label></div></form>`,
        actions: [{ label: 'Cancel', kind: 'ghost', value: null }, { label: 'Save', kind: 'primary' }] });
      if (r) await api('PATCH', `/api/actions/${a.id}`, r);
    });
  },
};
