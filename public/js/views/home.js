import { pageOf } from '../paging.js';
// Home: Jade on its hex platform in the landscape, then the instrument panel, the projects, the next actions and recent agent work.
export default {
  title: 'Home',
  refreshOn: ['projects', 'actions', 'jobs', 'config'],
  async render(root, { api, ui, state, enabled, go, openSpot, openJob, face }) {
    const { esc, icon } = ui;
    const get = (on, path, fb) => on ? api('GET', path).catch(() => fb) : Promise.resolve(fb);
    const [projects, openList] = await Promise.all([
      get(enabled('projects'), '/api/projects', []), get(enabled('actions'), '/api/actions?status=open&paged=1&limit=1000000', { items: [] }),   // every open action: the counts are true counts
    ]);
    const actions = pageOf(openList).items;
    const cfg = state.boot.config;
    const now = new Date(), hr = now.getHours();
    const part = hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const phase = hr < 5 ? 'night watch' : hr < 9 ? 'first light' : hr < 12 ? 'morning' : hr < 14 ? 'midday' : hr < 17 ? 'afternoon' : hr < 20 ? 'dusk' : 'evening';
    const active = projects.filter(p => !p.archived);
    const open = actions.filter(a => a.status !== 'done');
    const overdue = open.filter(a => a.due && ui.daysUntil(a.due) < 0);
    const week = open.filter(a => a.due && ui.daysUntil(a.due) >= 0 && ui.daysUntil(a.due) <= 7);
    const running = state.jobs.filter(j => j.status === 'running' || j.status === 'queued');
    const agentWork = state.jobs.some(j => j.agent !== 'jade');
    const first = cfg.name ? cfg.name.split(' ')[0] : '';
    const lede = (active.length
      ? `${active.length} project${active.length > 1 ? 's' : ''} underway. ${open.length} open action${open.length === 1 ? '' : 's'}${overdue.length ? `, ${overdue.length} overdue` : ''}.`
      : 'A quiet start. Add your first project, or just ask me something.');
    const sorted = [...open].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (b.priority === 'high') - (a.priority === 'high'));
    root.innerHTML = `
      <section class="scene">
        ${ui.landscape(first || 'jade')}
        <div class="face-slot" data-face title="Ask Jade"></div>
        <div class="scene-copy">
          <div class="when">${esc(now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))} · ${esc(phase)}</div>
          <h1>${part}${first ? `, <em>${esc(first)}</em>` : ''}.</h1>
          <div class="lede">${esc(lede)}</div>
          <div class="ask-bar" role="button" tabindex="0" data-ask><span class="gem"></span><span class="t">What should we move forward today?</span><kbd>Ctrl K</kbd></div>
        </div>
      </section>

      <div style="height:26px"></div>

      <div class="bento">
        <div class="instruments c12" role="group" aria-label="Instruments">
          ${enabled('projects') ? `<a class="stat" href="#/projects"><div class="label">Projects</div><div class="value">${active.length}</div><div class="sub">${active.filter(p => open.some(a => a.project === p.id)).length} with open actions</div></a>` : ''}
          ${enabled('actions') ? `<a class="stat" href="#/actions"><div class="label">Overdue</div><div class="value" style="${overdue.length ? 'color:var(--red)' : ''}">${overdue.length}</div><div class="sub">${week.length} due this week</div></a>` : ''}
          ${enabled('agents') ? `<a class="stat" href="#/agents"><div class="label">Agents</div><div class="value" style="${running.length ? 'color:var(--cyan)' : ''}">${running.length}</div><div class="sub">${running.length ? 'working now' : 'all idle'}</div></a>` : ''}
        </div>

        ${enabled('projects') ? `<section class="card c12">
          <div class="card-head"><h2>${icon('grid')}Projects</h2>
            <a class="btn sm ghost" href="#/projects">All projects</a></div>
          ${active.length ? `<div class="list">${active.slice(0, 8).map(p => { const n = open.filter(a => a.project === p.id).length; return `<a class="item link" href="#/project/${encodeURIComponent(p.id)}" style="text-decoration:none"><div class="main-col"><div class="title">${esc(p.name)}</div><div class="meta"><span>${n ? `${n} open action${n === 1 ? '' : 's'}` : 'No open actions'}</span></div></div></a>`; }).join('')}</div>`
            : `<div class="empty-big" style="padding:34px 10px"><p>Your projects show here with their open actions.</p><a class="btn primary" href="#/projects?new">${icon('plus', 15)}Add a project</a></div>`}
        </section>` : ''}

        ${enabled('actions') ? `<section class="card ${enabled('agents') && agentWork ? 'c4' : 'c12'}">
          <div class="card-head"><h2>${icon('checks')}Next up</h2><a class="btn sm ghost" href="#/actions">All ${open.length}</a></div>
          <form class="row" data-quick style="margin-bottom:6px"><input name="text" placeholder="Add an action…" aria-label="New action"><button class="btn icon" aria-label="Add">${icon('plus', 16)}</button></form>
          <div class="list">${sorted.slice(0, 6).map(a => `<div class="item">
            <button class="check" data-done="${a.id}" aria-label="Complete">${icon('check', 12)}</button>
            <div class="main-col"><div class="title">${esc(a.text)}</div><div class="meta">${a.due ? `<span style="color:${ui.daysUntil(a.due) < 0 ? 'var(--red)' : 'inherit'}">${esc(ui.dueLabel(a.due))}</span>` : ''}${a.owner ? `<span>${esc(a.owner)}</span>` : ''}${a.project ? `<span>${esc(projects.find(p => p.id === a.project)?.name || a.project)}</span>` : ''}</div></div></div>`).join('') || '<div class="empty">Nothing open. Nice.</div>'}</div>
        </section>` : ''}

        ${enabled('agents') && agentWork ? `<section class="card c8">
          <div class="card-head"><h2>${icon('cpu')}Recent agent work</h2><a class="btn sm ghost" href="#/agents">Console</a></div>
          <div class="grid g2" style="gap:4px 24px">${state.jobs.filter(j => j.agent !== 'jade').slice(0, 6).map(j => `<div class="item link row" data-job="${j.id}" style="padding:8px 4px;border-top:1px dashed var(--line)"><span class="status-dot ${j.status}"></span>
            <div class="main-col"><div class="title ellipsis small">${esc(j.title)}</div><div class="meta"><span>${esc(j.engine)}</span><span>${ui.ago(j.createdAt)}</span></div></div></div>`).join('')}</div>
        </section>` : ''}
      </div>`;

    // Jade's face: one instance that survives re-renders, so the animation never restarts.
    this._face ||= face.mount(document.createElement('div'), { size: 400, platform: true });
    root.querySelector('[data-face]').appendChild(this._face.el);
    this._face.update();
    // Line the world up with the core: the grid's vanishing point under it, its platform just below the horizon.
    const scene = root.querySelector('.scene'), slot = root.querySelector('[data-face]');
    const place = () => {
      if (!scene.isConnected) return;
      const sr = scene.getBoundingClientRect(), fr = slot.getBoundingClientRect();
      const s = Math.max(sr.width / 1440, sr.height / 460), offX = (sr.width - 1440 * s) / 2, offY = sr.height - 460 * s;
      const fx = fr.left - sr.left + fr.width / 2;
      const vx = Math.max(.1, Math.min(.9, (fx - offX) / s / 1440));
      scene.querySelector('svg.land').outerHTML = ui.landscape(first || 'jade', { vx });
      if (getComputedStyle(slot).position === 'absolute') {
        const horizon = offY + 268 * s;
        const platformY = horizon + (sr.height - horizon) * .42;
        slot.style.top = Math.round(platformY - fr.width * .845) + 'px';
      }
    };
    requestAnimationFrame(place);
    window.removeEventListener('resize', this._onResize || (() => {}));
    this._onResize = () => { clearTimeout(this._rt); this._rt = setTimeout(place, 150); };
    window.addEventListener('resize', this._onResize);
    this._face.el.onclick = () => openSpot();
    this._face.el.tabIndex = 0;
    this._face.el.onkeydown = e => { if (e.key === 'Enter') openSpot(); };

    root.querySelectorAll('[data-go]').forEach(el => { el.onclick = () => go(el.dataset.go); el.onkeydown = e => { if (e.key === 'Enter') go(el.dataset.go); }; });
    root.querySelectorAll('[data-job]').forEach(el => el.onclick = () => openJob(el.dataset.job));
    const ask = root.querySelector('[data-ask]');
    ask.onclick = () => openSpot();
    ask.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSpot(); } };
    root.querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
      const a = open.find(x => x.id === b.dataset.done);
      const note = await ui.doneNote(a?.text || '');
      if (note === null) return;
      api('PATCH', `/api/actions/${b.dataset.done}`, { status: 'done', doneNote: note });
    });
    root.querySelector('[data-quick]')?.addEventListener('submit', async e => {
      e.preventDefault();
      const t = e.target.text.value.trim();
      if (!t) return;
      await api('POST', '/api/actions', { text: t });
      e.target.text.value = '';
    });
  },
};
