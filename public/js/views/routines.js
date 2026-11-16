// Routines: everything that runs on a schedule or a button, in one place. Single-prompt routines (an agent run for each project, say),
// skill automations, the agents' schedules (the agents themselves are on the Agents page) and Jade's own upkeep.
const PRESETS = ['off', 'every 15m', 'every 30m', 'every 1h', 'every 2h', 'daily 09:00', 'weekdays 09:00', 'mon 09:00'];
// the schedule forms the scheduler understands (server/core/scheduler.js parse)
const VALID = /^(off|every\s+\d+\s*(m|min|h|hr|d)|(daily|weekdays|weekends|[a-z,\s]+?)\s+\d{1,2}:\d{2})$/i;

export default {
  title: 'Routines',
  refreshOn: ['schedule', 'jobs', 'skills', 'config', 'agents'],
  async render(root, ctx) {
    const { api, ui, runAgent } = ctx;
    const { esc, icon } = ui;
    const [d, projects] = await Promise.all([api('GET', '/api/routines'), api('GET', '/api/projects')]);
    const when = s => (s ? ui.ago(s) : '');
    const next = s => (s ? new Date(s).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '');
    // a run still in the run list opens its output; an older or quiet one (nothing new) only says when
    const lastRun = l => !l ? '<span class="tiny muted" style="flex:0 0 120px;text-align:right">never run</span>'
      : !l.id ? `<span class="tiny muted" style="flex:0 0 120px;text-align:right">ran ${esc(when(l.at))}</span>`
      : `<button class="btn sm ghost" style="flex:0 0 120px" data-job="${esc(l.id)}" title="${esc(l.error || 'Open the output')}"><span class="status-dot ${esc(l.status)}"></span>${esc(l.status === 'done' ? 'ran' : l.status)} ${esc(when(l.at))}</button>`;
    const picker = (attr, id, cur, suggested) => `<select ${attr}="${esc(id)}" style="height:30px;font-size:12px;width:170px;flex:0 0 170px" aria-label="Schedule">
      ${[...new Set([cur, suggested, ...PRESETS].filter(Boolean))].map(s => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('')}<option value="__custom">Custom…</option></select>`;
    const row = (r, kind) => `<div class="item" style="align-items:center;gap:12px">
      <span style="color:var(--cyan)">${icon(r.icon || 'clock', 16)}</span>
      <div class="main-col" style="flex:1;min-width:0"><div class="title">${esc(r.name)}${r.moduleOn === false ? ' <span class="tiny muted">(its module is off)</span>' : ''}</div><div class="meta"><span>${esc(r.description || '')}</span></div></div>
      ${picker('data-sched', r.id, r.schedule, r.suggested)}
      <span class="tiny muted" style="flex:0 0 140px;text-align:right">${r.nextRun ? `next ${esc(next(r.nextRun))}` : ''}</span>
      ${lastRun(r.last)}
      ${kind === 'agent' ? `<a class="btn sm ghost" href="#/agents/${esc(r.id)}">${icon('doc', 13)}Open</a>` : `<button class="btn sm" data-run="${esc(r.id)}">${icon('play', 13)}Run</button>`}
    </div>`;
    const auto = s => `<div class="item" style="align-items:center;gap:12px">
      <label class="switch" title="Run automatically"><input type="checkbox" data-auto="${esc(s.name)}" ${s.on ? 'checked' : ''} aria-label="Automate ${esc(s.name)}"><span></span></label>
      <div class="main-col" style="flex:1;min-width:0"><div class="title">${esc(s.name)}${s.perProject ? ' <span class="tiny muted">· once per project</span>' : ''}</div><div class="meta"><span>${esc(s.description || '')}</span></div></div>
      ${picker('data-skill', s.name, s.schedule, s.suggested)}
      <span class="tiny muted" style="flex:0 0 140px;text-align:right">${s.on && s.nextRun ? `next ${esc(next(s.nextRun))}` : ''}</span>
      ${lastRun(s.last)}
      <button class="btn sm" data-skillrun="${esc(s.name)}">${icon('play', 13)}Run</button>
    </div>`;
    const sys = s => `<div class="item" style="align-items:center;gap:12px">
      <span style="color:var(--cyan)">${icon('refresh', 16)}</span>
      <div class="main-col" style="flex:1;min-width:0"><div class="title">${esc(s.name)}${s.on ? '' : ' <span class="tiny muted">(its module is off)</span>'}</div><div class="meta"><span>${esc(s.desc)}</span></div></div>
      <label class="row small" style="gap:6px">every <input type="number" min="5" max="1440" step="5" value="${s.minutes}" data-sys="${esc(s.key)}" style="width:76px;height:30px"> min</label>
      <span class="tiny muted" style="min-width:120px">${s.lastRun ? `last ${esc(when(s.lastRun))}` : ''}</span>
    </div>`;
    const section = (title, sub, body) => `<section class="card" style="margin-bottom:16px"><div class="card-head"><h2>${title}</h2><span class="tiny muted">${sub}</span></div><div class="list">${body}</div></section>`;

    root.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Under the hood</div><h1>Routines</h1>
        <p>Everything that runs on a schedule or a button. If the computer was asleep at the time, a missed run happens when Jade next sees it (up to 12 hours late; "every" schedules run on wake). The agents are on <a href="#/agents">Agents</a>; skill playbooks are on <a href="#/skills">Skills</a>.</p></div></div>
      ${section(`${icon('clock')}Routines`, 'one prompt each, with a fixed output', d.routines.map(r => row(r, 'routine')).join(''))}
      ${d.agents.length ? section(`${icon('cpu')}Agent schedules`, 'when the agents run', d.agents.map(r => row(r, 'agent')).join('')) : ''}
      ${section(`${icon('bolt')}Skill automations`, 'skills that can run on their own', d.automations.length ? d.automations.map(auto).join('') : '<div class="empty">No skill has a schedule yet. Give a skill an "automation" in its SKILL.md.</div>')}
      ${section(`${icon('refresh')}Jade's upkeep`, 'background work, no model', d.system.map(sys).join(''))}`;

    const save = (url, body, ok) => api('POST', url, body).then(() => ui.toast(ok, 'success', 1400)).catch(err => ui.toast(err.message, 'error'));
    // a schedule choice, with "Custom…" asking for any form the scheduler understands
    const choose = async sel => {
      if (sel.value !== '__custom') return sel.value;
      const r = await ui.modal({ title: 'Custom schedule', body: '<form class="form"><label class="field">When <small>e.g. "every 45m", "weekdays 09:15", "mon,thu 16:00", "daily 18:30" or "off"</small><input name="s" autofocus></label></form>', actions: [{ label: 'Cancel', kind: 'ghost', value: false }, { label: 'Save', kind: 'primary' }] });
      const s = String(r?.s || '').trim().toLowerCase();
      if (!s) { this.render(root, ctx); return null; }
      if (!VALID.test(s)) { ui.toast(`"${s}" is not a schedule Jade understands`, 'error', 5000); this.render(root, ctx); return null; }
      return s;
    };
    root.querySelectorAll('[data-sched]').forEach(s => s.onchange = async () => { const v = await choose(s); if (v) save(`/api/schedule/${s.dataset.sched}`, { schedule: v }, 'Schedule saved'); });
    root.querySelectorAll('[data-skill]').forEach(s => s.onchange = async () => { const v = await choose(s); if (v) save(`/api/skills/${s.dataset.skill}/prefs`, v === 'off' ? { automation: false } : { schedule: v }, 'Schedule saved'); });
    root.querySelectorAll('[data-auto]').forEach(c => c.onchange = () => save(`/api/skills/${c.dataset.auto}/prefs`, { automation: c.checked }, c.checked ? 'Automation on' : 'Automation off'));
    root.querySelectorAll('[data-sys]').forEach(i => i.onchange = () => save(`/api/routines/system/${i.dataset.sys}`, { minutes: Number(i.value) }, 'Saved'));
    root.querySelectorAll('[data-job]').forEach(b => b.onclick = () => ctx.openJob(b.dataset.job));
    root.querySelectorAll('[data-skillrun]').forEach(b => b.onclick = () => api('POST', `/api/skills/${b.dataset.skillrun}/run`, {}).then(j => ctx.openJob(j.id)).catch(err => ui.toast(err.message, 'error')));
    root.querySelectorAll('[data-run]').forEach(b => b.onclick = async () => {
      const r = d.routines.find(x => x.id === b.dataset.run);
      let input = {};
      if (r.input === 'project') {
        if (!projects.length) return ui.toast('Add a project first', 'error');
        const m = await ui.modal({ title: r.name, body: `<form class="form"><label class="field">Project<select name="project">${ui.projectOptions(projects, projects[0].id, 'Choose…')}</select></label></form>`, actions: [{ label: 'Cancel', kind: 'ghost', value: false }, { label: 'Run', kind: 'primary' }] });
        if (!m?.project) return;
        input = { project: m.project };
      } else if (r.input === 'note') return ui.toast('Run this from a note (Extract actions)', 'info');
      try { const j = await runAgent(r.id, input); ctx.openJob(j.id); } catch (err) { ui.toast(err.message, 'error'); }
    });
  },
};
