// Dreams: the nightly look at the week's work. Each idea has its evidence; you can dismiss it, or accept it after reading exactly
// what would be created. Nothing is made without that yes.
export default {
  title: 'Dreams',
  refreshOn: ['dreams', 'jobs', 'agents', 'skills'],
  async render(root, ctx) {
    const { api, ui, state, go } = ctx;
    const { esc, icon } = ui;
    const d = await api('GET', '/api/dreams');
    const { nights = [], settings: s = {}, kinds = [] } = d;
    const dreaming = d.running || state.jobs.find(j => j.agent === 'dreams' && (j.status === 'running' || j.status === 'queued'));
    const host = u => u.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0];
    const said = { accepted: 'Accepted', dismissed: 'Dismissed' };
    const reads = [
      'Jade\'s own chats, agent runs, notes, finished actions and recorded meetings',
      { off: '', projects: 'what you typed to Claude Code, and what Claude answered, in your Jade projects\' folders', all: 'what you typed to Claude Code, and what Claude answered, in every folder on this computer' }[s.claude] || '',
    ].filter(Boolean);
    const when = d.scheduleOn ? `Every night (${esc(d.schedule)})` : d.schedule && d.schedule !== 'off' ? 'It can run every night once Routines is switched on under Modules; until then' : 'On request';

    const idea = (n, i) => {
      const k = kinds.find(x => x.id === i.kind) || {};
      const srcs = (i.sources || []).filter(u => /^https?:\/\//i.test(u));
      return `<div class="item" style="${i.status !== 'new' ? 'opacity:.55' : ''}"><div class="main-col">
        <div class="title">${esc(i.title)}</div>${i.detail ? `<div class="small dim" style="margin-top:3px">${esc(i.detail)}</div>` : ''}
        ${i.evidence ? `<div class="tiny muted" style="margin-top:4px">Seen in: ${esc(i.evidence)}</div>` : ''}
        ${i.suggestion ? `<div class="small" style="color:var(--cyan);margin-top:4px">→ ${esc(i.suggestion)}</div>` : ''}
        ${srcs.length ? `<div class="tiny muted" style="margin-top:4px">From ${srcs.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(host(u))}</a>`).join(', ')}</div>` : ''}
        ${i.status === 'new'
          ? `<div class="row wrap" style="gap:6px;margin-top:8px"><button class="btn sm" data-accept data-date="${esc(n.date)}" data-id="${esc(i.id)}">${icon('check', 13)}${esc(k.accept || 'Accept')}</button><button class="btn sm ghost" data-dismiss data-date="${esc(n.date)}" data-id="${esc(i.id)}">Dismiss</button></div>`
          : `<div class="tiny muted" style="margin-top:4px">${esc(said[i.status] || i.status)}</div>`}
      </div></div>`;
    };
    const ideas = n => {
      const out = kinds.map(k => [k, (n.ideas || []).filter(i => i.kind === k.id)]).filter(([, l]) => l.length)
        .map(([k, l]) => `<div><div class="eyebrow" style="margin-bottom:8px">${icon(k.icon || 'spark', 12)} ${esc(k.title)}</div><div class="list">${l.map(i => idea(n, i)).join('')}</div></div>`).join('');
      return out || '<div class="empty">Nothing worth bringing that night.</div>';
    };

    root.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Reflection</div><h1>Dreams</h1>
          <p>${when} Jade reads the last ${esc(s.days || 7)} days of your work and brings back ideas, each with what it is based on: agents worth building, skills, things worth writing down, facts worth remembering${s.web ? ', and a few things from outside' : ''}. Nothing is created until you have read it and said yes.</p></div>
        <div class="tools"><button class="btn primary" data-dream ${dreaming ? 'disabled' : ''}>${dreaming ? `<span class="spin" style="display:grid">${icon('refresh', 16)}</span>Dreaming…` : `${icon('moon', 16)}Dream now`}</button></div>
      </div>
      <div class="card" style="margin-bottom:14px;padding:12px 14px"><div class="small">${icon('search', 14)} <b>What it reads:</b> ${reads.map(esc).join('; ')}. The text is sent to the model you chose for Jade's agents, and nowhere else. ${s.web ? 'Looking outside the work is on: it also searches the web, using general terms only, never your names, companies or files.' : 'It does not search the web.'} <a href="#/settings/dreams">Change this in Settings</a>.</div></div>
      ${nights.length ? `<div class="stack" style="gap:18px">${nights.slice(0, 14).map((n, idx) => `<section class="card">
        <div class="card-head"><h2 style="font:400 26px/1.1 var(--serif)">${esc(ui.fmtDate(n.date, { weekday: 'long', month: 'long', day: 'numeric' }))}</h2>${idx === 0 ? '<span class="chip on">latest</span>' : ''}</div>
        <p style="color:var(--fg-soft);font-size:15px;max-width:80ch">${esc(n.summary)}</p>
        <div class="grid g2" style="margin-top:16px;gap:20px;align-items:start">${ideas(n)}</div></section>`).join('')}</div>`
      : `<div class="card empty-big">${icon('moon', 44)}<h2>No dreams yet</h2><p>Press Dream now to see what Jade makes of your week so far.</p></div>`}`;

    const $ = q => root.querySelector(q);
    $('[data-dream]').onclick = () => api('POST', '/api/dreams/run').then(j => ctx.openJob(j.id)).catch(e => ui.toast(e.message, 'error'));
    root.querySelectorAll('[data-dismiss]').forEach(b => b.onclick = () => { const { date: dt, id } = b.dataset; api('POST', `/api/dreams/${encodeURIComponent(dt)}/idea/${encodeURIComponent(id)}/dismiss`).catch(e => ui.toast(e.message, 'error')); });
    // Accepting shows the whole of what would be made, and only a yes for that exact text makes it.
    root.querySelectorAll('[data-accept]').forEach(b => b.onclick = async () => {
      const { date: dt, id } = b.dataset;
      let p;
      try { p = await api('GET', `/api/dreams/${dt}/idea/${id}/preview`); } catch (e) { return ui.toast(e.message, 'error'); }
      if (p.problem) return ui.modal({ title: 'This one cannot be made as it is', body: `<p class="dim">${esc(p.problem)}</p>`, actions: [{ label: 'Close', kind: 'ghost', value: null }] });
      const yes = await ui.modal({
        title: p.what, wide: true,
        body: `<p class="small dim" style="margin:0 0 10px">This is exactly what will be created, in ${esc(p.where)}. Nothing is made until you press the button.</p>${(p.files || []).length > 1 ? `<p class="small" style="margin:0 0 6px">${p.files.length} files will be written: ${p.files.map(f => `<span class="mono tiny">${esc(f.path)}</span>`).join(', ')}. Nothing already there is overwritten.</p>` : ''}${(p.files || []).length > 1 ? p.files.map(f => `<div class="tiny mono muted" style="margin:6px 0 2px">${esc(f.path)}</div><pre data-draft-text style="white-space:pre-wrap;max-height:30vh;overflow:auto;margin:0;padding:12px;border:1px solid var(--line-hi);border-radius:10px">${esc(f.text)}</pre>`).join('') : `<pre data-draft-text style="white-space:pre-wrap;max-height:50vh;overflow:auto;margin:0;padding:12px;border:1px solid var(--line-hi);border-radius:10px">${esc(p.text)}</pre>`}`,
        actions: [{ label: 'Not now', kind: 'ghost', value: false }, { label: 'Yes, create it', kind: 'primary', icon: 'check', value: true }],
      });
      if (!yes) return;
      try { await api('POST', `/api/dreams/${dt}/idea/${id}/accept`, { token: p.token }); ui.toast('Done', 'success', 1800); } catch (e) { ui.toast(e.message, 'error'); }
    });
  },
};
