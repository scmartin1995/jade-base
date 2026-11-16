// Agents: every Claude Code agent Jade can see (yours, your projects', plugins', and Jade's built-ins), grouped by where it lives, with
// the install banner for the built-ins. #/agents/<id> is one agent: what it is for, its prompt, tools, owned skills, model and runs.
// Skeptic's numbers show on checked agents; #/agents/skeptic/checks is Skeptic's full evidence page.
export default {
  title: 'Agents',
  refreshOn: ['jobs', 'agents', 'schedule', 'config'],
  async render(root, ctx) {
    if (ctx.params[0] === 'skeptic' && ctx.params[1] === 'checks') return (await import('./skeptic.js')).default.render(root, ctx);
    const { api, ui, state, runAgent } = ctx;
    const { esc, icon } = ui;
    const [agents, schedule, projects, sk, inst] = await Promise.all([api('GET', '/api/agents'), api('GET', '/api/schedule'), api('GET', '/api/projects'),
      api('GET', '/api/skeptic').catch(() => null), api('GET', '/api/agents/install').catch(() => null)]);
    const one = ctx.params[0] ? agents.find(a => a.id === ctx.params[0]) : null;
    const detail = one ? await api('GET', `/api/agents/${encodeURIComponent(one.id)}/detail`).catch(() => ({ owned: [], editable: false })) : null;
    const visible = one ? [one] : agents;
    const runs = state.jobs.filter(j => (one ? j.agent === one.id : visible.some(a => a.id === j.agent && a.handler !== 'chat' && !a.hidden)));
    const sel = this._sel && state.jobs.find(j => j.id === this._sel);
    const full = sel && !state.streams.has(sel.id) && sel.status !== 'running' ? await api('GET', `/api/jobs/${sel.id}`) : null;
    if (full) state.streams.set(sel.id, full.output || '');
    const dur = j => j.endedAt && j.startedAt ? Math.round((Date.parse(j.endedAt) - Date.parse(j.startedAt)) / 1000) + 's' : j.status === 'running' ? 'running' : '';
    const runPane = sel => `
          <div class="row wrap" style="margin-bottom:12px"><button class="btn sm ghost back" data-back>${icon('arrow_left', 14)}Runs</button><span class="status-dot ${esc(sel.status)}"></span><h3 class="grow">${esc(sel.title)}</h3>
            ${sel.status === 'running' || sel.status === 'queued' ? `<button class="btn sm danger" data-cancel>${icon('stop', 13)}Stop</button>` : `<button class="btn sm" data-rerun>${icon('refresh', 13)}Run again</button>`}</div>
          <div class="row wrap tiny muted" style="gap:12px;margin-bottom:10px"><span>${esc(sel.agentName)}</span><span>engine: ${esc(sel.engine)}</span><span>${esc(sel.trigger)}</span><span>${esc(new Date(sel.createdAt).toLocaleString())}</span><span>${dur(sel)}</span></div>
          ${sel.error ? `<div class="card" style="border-color:color-mix(in srgb,var(--red) 50%,transparent);margin-bottom:10px;padding:12px 14px;color:var(--bright_red, var(--red))">${esc(sel.error)}<div style="margin-top:8px">${ui.askBtn(ui.askPrompt(`Failed agent run (${sel.agentName})`, sel.title, sel.error, 'Why might this have failed, and how do I fix it?'), { label: 'Ask Jade why' })}</div></div>` : ''}
          ${sel.result && Object.keys(sel.result).length ? `<div class="tiny mono dim" style="margin-bottom:10px">result: ${esc(JSON.stringify(sel.result).slice(0, 300))}</div>` : ''}
          ${(sel.tools || []).length ? `<details style="margin-bottom:10px"><summary class="tiny muted" style="cursor:pointer">${sel.tools.length} tool calls</summary><div style="margin-top:6px">${sel.tools.map(t => `<div class="tool-line">${icon('spark', 11)}<b>${esc(t.name)}</b> ${esc(t.detail || '')}</div>`).join('')}</div></details>` : ''}
          <div class="output" data-stream="${esc(sel.id)}">${esc(state.streams.get(sel.id) || (sel.status === 'queued' ? 'Queued…' : sel.status === 'running' ? 'Thinking…' : '(no output)'))}</div>`;
    const sch = id => schedule.find(t => t.key === 'agent:' + id);
    // the numbers that say how each agent is doing, on its card
    const pct = (n, of) => (of ? Math.round((100 * n) / of) + '%' : '—');
    const stats = a => {
      if (a.id === 'skeptic' && sk) {
        const w = Object.values(sk.workflows || {}), checks = w.reduce((n, x) => n + x.checks, 0), pass = w.reduce((n, x) => n + (x.pass || 0), 0);
        const back = w.reduce((n, x) => n + (x.fix_output || 0), 0), blocked = w.reduce((n, x) => n + (x.blocked || 0), 0);
        return checks ? `<div class="row wrap small" style="gap:12px"><span><b>${checks}</b> checks</span><span><b>${pct(pass, checks)}</b> passed</span><span><b>${pct(back, checks)}</b> sent back</span><span><b>${pct(blocked, checks)}</b> blocked</span></div><div class="tiny muted">last 30 days, for ${w.length} workflow${w.length === 1 ? '' : 's'}</div>` : '<div class="tiny muted">No checks yet.</div>';
      }
      if (a.kind === 'builder') {
        // a builder is never a run of its own: Jade hands it tasks inside a chat's run, so count those hand-offs
        const recent = state.jobs.filter(j => Date.now() - Date.parse(j.createdAt) < 30 * 864e5)
          .flatMap(j => (j.tools || []).filter(t => ['Agent', 'Task'].includes(t.name) && String(t.detail || '').startsWith(a.id + ':')).map(() => j.id));
        const builds = new Set(recent).size;
        return `<div class="row wrap" style="gap:6px">${(a.skills || []).map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>`
          + (recent.length ? `<div class="row wrap small" style="gap:12px"><span><b>${recent.length}</b> tasks handed over</span><span>in <b>${builds}</b> build${builds === 1 ? '' : 's'}</span></div><div class="tiny muted">last 30 days, in the runs Jade still has</div>` : '<div class="tiny muted">No tasks handed over yet.</div>');
      }
      return '';
    };

    const groupName = g => g === 'yours' ? 'Yours (Claude Code\'s agents folder)' : g === 'built-in' ? 'Jade\'s built-in agents' : g.startsWith('project:') ? `Project: ${g.slice(8)}` : g.startsWith('plugin:') ? `Plugin: ${g.slice(7)}` : g;
    // An agent from a project folder or a plugin: what its file asks for, in plain words, and whether the PM has allowed it.
    const asksList = a => {
      const k = a.asks || {}, out = [];
      if (k.edits) out.push('to create and change files');
      if ((k.tools || []).some(t => /^bash$/i.test(t))) out.push('to run commands (Bash)');
      if (k.schedule) out.push(`to run by itself: ${k.schedule}`);
      if ((k.connectors || []).length) out.push(`to use ${k.connectors.join(', ')}`);
      if ((k.skills || []).length) out.push(`to use its skills: ${k.skills.join(', ')}`);
      if (k.handler || k.loop) out.push(`to be run by Jade (${k.loop || k.handler})`);
      if ((k.context || []).length) out.push(`to be given your ${k.context.join(', ')} (Jade's own notes, memory and the like)`);
      if (k.kind) out.push(`to act as a ${k.kind}`);
      if (k.input) out.push(`to take ${k.input} as its input`);
      if (k.hidden) out.push('to be hidden from this list');
      if (k.module) out.push(`to belong to the ${k.module} module`);
      if (k.web) out.push(`to use web search while ${k.web} is on`);
      if (k.checked) out.push('to have Skeptic check its work');
      if (k.id) out.push(`to be known to Jade as "${k.id}"`);
      if (k.effort) out.push(`to set how hard the model thinks (${k.effort})`);
      return out;
    };
    const sourceOf = a => (a.group?.startsWith('project:') ? `the project folder of ${a.group.slice(8)}` : a.group?.startsWith('plugin:') ? `the plugin ${a.group.slice(7)}` : 'another folder');
    const allowBox = a => {
      if (a.trusted) return '';
      const asks = asksList(a);
      return `<section class="card stack" style="margin-bottom:18px;gap:8px" data-allow-box>
          <h3>${a.allowed ? 'You have allowed this agent to work on its own' : a.allowChanged ? 'Changed since you allowed it' : 'This agent is not allowed to work on its own yet'}</h3>
          ${a.allowChanged ? '<div class="small" style="color:var(--amber, #e0a040)">This file, or a skill it uses, is different from when you allowed it, so the allowance no longer counts. Read what it asks for below and allow it again if you still want to.</div>' : ''}
          <div class="small">This file comes from ${esc(sourceOf(a))}, not from you or Jade: <span class="tiny mono muted">${esc(a.file)}</span></div>
          <div class="small">It asks ${asks.length ? esc(asks.join('; ')) : 'for nothing beyond reading'}.</div>
          <div class="small dim">${a.allowed ? 'It can change files, run commands, run on a schedule, use its skills, and be started from a Claude session. Take the allowance back at any time.'
            : 'Until you allow it, a run you start yourself can only read: it cannot change files or run commands, it does not run on a schedule, its skills are not used, and a Claude session cannot start it.'}</div>
          <div class="row" style="gap:8px">${a.allowed ? `<button class="btn sm" data-disallow="${esc(a.id)}">Take the allowance back</button>` : `<button class="btn sm primary" data-allow="${esc(a.id)}">${icon('check', 13)}Allow this agent to work on its own</button>`}</div>
        </section>`;
    };
    const rank = g => (g === 'yours' ? 0 : g.startsWith('project:') ? 1 : g.startsWith('plugin:') ? 2 : 3);
    const groups = [...new Set(agents.map(a => a.group))].sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
    const canRun = a => a.runnable && !a.hidden && !['verifier', 'builder'].includes(a.kind) && a.handler !== 'chat';
    const card = a => {
      const t = sch(a.id);
      return `<article class="card stack" style="gap:8px">
          <div class="row"><span style="color:var(--cyan)">${icon(a.icon || 'spark', 18)}</span><h3 class="grow">${esc(a.name)}</h3>${a.builtin ? '<span class="badge">Jade</span>' : ''}${a.installed ? '<span class="badge">installed</span>' : ''}${a.hidden ? '<span class="chip">internal</span>' : ''}${a.trusted ? '' : a.allowed ? '<span class="badge">allowed</span>' : '<span class="chip">read-only until allowed</span>'}</div>
          <div class="small dim">${esc(a.description)}</div>
          ${stats(a)}
          ${a.kind === 'verifier' && (a.skills || []).length ? `<div class="tiny muted">Builds are checked against these skills</div><div class="row wrap" style="gap:6px">${a.skills.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
          <div class="row" style="gap:8px;margin-top:auto">
            <span class="grow tiny muted">${!a.trusted && !a.allowed ? 'Runs when you start it, to read only · open it to allow more' : a.runnable ? (a.kind === 'verifier' ? 'Runs when another agent, or you, asks it to check something' : a.kind === 'builder' ? 'Jade hands it build tasks in a chat' : a.hidden ? 'Used by Jade itself' : t?.schedule && t.schedule !== 'off' ? `Runs ${esc(t.schedule)} · <a href="#/routines">change</a>` : 'Runs when you start it · <a href="#/routines">set a time</a>') : 'To read only. Claude Code is what runs it.'}</span>
            <a class="btn sm" href="#/agents/${encodeURIComponent(a.id)}">${icon('doc', 13)}Open</a>${canRun(a) ? `<button class="btn sm primary" data-run="${esc(a.id)}">${icon('play', 13)}Run</button>` : ''}
          </div>
        </article>`;
    };
    const banner = () => {
      if (!inst) return '';
      const msg = { 'not-installed': 'Jade\'s built-in agents run from the app. Install them into Claude Code so Claude Code can use them too.', installed: 'Jade\'s built-in agents are installed in Claude Code.',
        updates: 'A newer version of some built-in agents is available. Files you have not changed are updated; none of yours is overwritten.', changed: 'You changed some installed agents. Jade keeps your versions.' }[inst.state];
      const ch = inst.changed.length ? `<div class="tiny muted" style="margin-top:6px">Changed by you: ${inst.changed.map(c => `${esc(c.path.split(/[\\/]/).slice(-2).join('/'))}${c.newer ? ' (newer version available)' : ''}`).join(', ')}</div>` : '';
      return `<div class="card" style="margin-bottom:14px;padding:12px 14px"><div class="row wrap" style="gap:10px"><span class="chip ${inst.state === 'installed' ? 'on' : ''}">${esc(inst.label)}</span><span class="grow small dim">${msg}<span class="tiny muted"> Into ${esc(inst.claudeHome)}</span></span>
        ${inst.state === 'installed' ? '' : `<button class="btn sm primary" data-install>${inst.state === 'not-installed' ? 'Install' : 'Update'}</button>`}
        ${inst.changed.some(c => c.newer) ? '<button class="btn sm" data-beside>Put the new version beside mine</button>' : ''}</div>${ch}</div>`;
    };
    const detailHtml = a => {
      const own = detail.owned || [];
      const numbers = (a.checked || a.id === 'skeptic') && sk ? `<div class="stack" style="gap:6px"><h3>Skeptic's checks</h3>${stats({ ...a, id: 'skeptic' })}<a class="small" href="#/agents/skeptic/checks">Skeptic's evidence</a></div>` : '';
      return `<div class="page-head"><div><div class="eyebrow"><a href="#/agents">Agents</a> / ${esc(a.name)}</div><h1>${esc(a.name)}</h1><p>${esc(a.description)}</p></div>
          <div class="row" style="gap:8px">${detail.editable ? `<button class="btn sm" data-edit>${icon('doc', 13)}Edit${a.origin === 'built-in' ? ' (installs a copy first)' : ''}</button>` : ''}${canRun(a) ? `<button class="btn sm primary" data-run="${esc(a.id)}">${icon('play', 13)}Run</button>` : ''}</div></div>
        ${allowBox(a)}
        <div class="grid auto" style="margin-bottom:18px">
          <article class="card stack" style="gap:6px"><h3>Where it lives</h3><div class="small">${esc(groupName(a.group))}${a.builtin ? ' · built in to Jade' : ''}</div><div class="tiny mono muted">${esc(a.file)}</div>
            <div class="tiny muted">${a.runnable ? 'Jade can run this agent.' : 'To read only. Jade has no instructions for starting it, so Claude Code is what runs it.'}</div></article>
          <article class="card stack" style="gap:6px"><h3>Tools</h3><div class="row wrap" style="gap:6px">${(a.tools || []).map(t => `<span class="chip">${esc(t)}</span>`).join('') || (a.loop === 'meeting' ? '<span class="small muted">None: Jade switches every tool off for it</span>' : '<span class="small muted">All the tools Claude Code has (none limited)</span>')}</div>
            <h3 style="margin-top:6px">Model</h3><div class="small">${a.model ? esc(a.model) : '<span class="muted">Not chosen: the model in Settings is used</span>'}</div></article>
          <article class="card stack" style="gap:6px"><h3>Skills it owns</h3>${own.map(s => `<div class="small"><b>${esc(s.name)}</b><div class="tiny muted">${esc(s.description)}</div><div class="tiny mono muted">${esc(s.file)}</div></div>`).join('') || '<span class="small muted">None</span>'}
            ${(a.skills || []).length > own.length ? `<div class="tiny muted">Named but not found: ${esc((a.skills || []).filter(n => !own.some(o => o.name === n || o.name.endsWith('-' + n))).join(', '))}</div>` : ''}</article>
          ${numbers ? `<article class="card stack">${numbers}</article>` : ''}
        </div>
        <section class="card" style="margin-bottom:18px"><div class="card-head"><h2>${icon('doc')}Prompt</h2></div><pre class="output" style="white-space:pre-wrap;max-height:420px;overflow:auto">${esc(a.prompt || '(empty)')}</pre></section>`;
    };

    // The Runs list and the run beside it; the same in the one-agent page and the all-agents page. `none` is the empty-list text.
    const runsSplit = none => `<div class="split ${sel ? 'detail-open' : ''}">
        <div class="card pane-list"><div class="card-head"><h2>${icon('cpu')}Runs</h2><span class="tiny muted">${runs.length}</span></div>
          <div class="list">${runs.slice(0, 80).map(j => `<div class="item link" data-job="${esc(j.id)}" style="${sel?.id === j.id ? 'background:color-mix(in srgb,var(--accent) 16%,transparent);padding-left:8px' : ''}">
            <span class="status-dot ${esc(j.status)}" style="margin-top:7px"></span><div class="main-col"><div class="title ellipsis">${esc(j.title)}</div>
            <div class="meta"><span>${esc(j.engine)}</span><span>${esc(j.trigger)}</span><span>${ui.ago(j.createdAt)}</span><span>${dur(j)}</span></div></div></div>`).join('') || `<div class="empty">${none}</div>`}</div></div>
        <div class="card pane-detail">${sel ? runPane(sel) : `<div class="empty-big">${icon('cpu', 40)}<h2>Pick a run</h2><p>Every agent run is kept with its output and the files and connectors it used.</p></div>`}</div>
      </div>`;

    root.innerHTML = one ? `${detailHtml(one)}
      ${runsSplit('No runs through Jade yet.')}` : `
      <div class="page-head">
        <div><div class="eyebrow">Under the hood</div><h1>Agents</h1><p>Every Claude Code agent Jade can see: yours, your projects' and your plugins', and Jade's built-in ones. An agent Claude Code creates shows up here by itself. Skeptic checks other agents' work and shows its evidence. Things that run a single prompt on a schedule or a button are on <a href="#/routines">Routines</a>.</p></div>
      </div>
      ${banner()}
      ${groups.map(g => `<h2 style="margin:6px 0 10px">${esc(groupName(g))}</h2><div class="grid auto" style="margin-bottom:18px">${agents.filter(a => a.group === g).map(card).join('')}</div>`).join('')}
      ${runsSplit('No runs yet.')}`;

    const $ = s => root.querySelector(s);
    root.querySelectorAll('[data-allow]').forEach(b => b.onclick = async () => {
      const a = agents.find(x => x.id === b.dataset.allow), asks = asksList(a);
      const ok = await ui.confirmBox(`Allow ${a.name} to work on its own?`, `This agent comes from ${sourceOf(a)}. It asks ${asks.length ? asks.join('; ') : 'for nothing beyond reading'}. If you allow it, it can do those things, and Jade's usual asking before anything risky still applies. You can take the allowance back at any time.`, 'Yes, allow it');
      if (!ok) return;
      try { await api('POST', `/api/agents/${encodeURIComponent(a.id)}/allow`); ui.toast(`${a.name} is allowed`, 'success', 1600); this.render(root, ctx); } catch (err) { ui.toast(err.message, 'error'); }
    });
    root.querySelectorAll('[data-disallow]').forEach(b => b.onclick = async () => {
      try { await api('POST', `/api/agents/${encodeURIComponent(b.dataset.disallow)}/disallow`); ui.toast('Allowance taken back', 'success', 1600); this.render(root, ctx); } catch (err) { ui.toast(err.message, 'error'); }
    });
    $('[data-install]')?.addEventListener('click', async () => {
      try { const r = await api('POST', '/api/agents/install', {}); ui.toast(`Installed ${r.written.length + r.updated.length} file${r.written.length + r.updated.length === 1 ? '' : 's'}${r.kept.length ? `, kept ${r.kept.length} you changed` : ''}`, 'success'); this.render(root, ctx); } catch (err) { ui.toast(err.message, 'error'); }
    });
    $('[data-beside]')?.addEventListener('click', async () => {
      try { const r = await api('POST', '/api/agents/install', { writeNew: true }); ui.toast(`Wrote ${r.beside.length} new version${r.beside.length === 1 ? '' : 's'} beside yours`, 'success'); this.render(root, ctx); } catch (err) { ui.toast(err.message, 'error'); }
    });
    $('[data-edit]')?.addEventListener('click', async () => {
      // a built-in agent has no file of yours yet: saving writes one into Claude Code's folder, so ask before that first happens
      if (one.origin === 'built-in') {
        const where = inst?.claudeHome ? `${inst.claudeHome}/agents` : "Claude Code's agents folder";
        const ok = await ui.confirmBox(`Change ${one.name}?`, `${one.name} comes with Jade. To change it, Jade will save your own copy in Claude Code's agents folder (${where}). Claude Code will use your copy from then on, and the original stays in the app. Go ahead?`, 'Yes, make my copy');
        if (!ok) return;
      }
      const r = await ui.modal({ title: `Edit ${one.name}`, wide: true, body: `<form class="form"><label class="field">What it is for<textarea name="description" rows="3">${esc(one.description)}</textarea></label>
        <label class="field">Tools (comma separated; empty means all)<input name="tools" value="${esc((one.tools || []).join(', '))}"></label>
        <label class="field">Prompt<textarea name="prompt" rows="16">${esc(one.prompt || '')}</textarea></label>
        ${one.model ? `<label class="row small" style="gap:8px"><input type="checkbox" name="clearModel"> Stop pinning the model (${esc(one.model)}); use the one in Settings</label>` : ''}
        ${one.origin === 'built-in' ? '<div class="tiny muted">Saving installs a copy into Claude Code\'s agents folder and changes that copy.</div>' : ''}</form>`,
        actions: [{ label: 'Cancel', kind: 'ghost', value: null }, { label: 'Save', kind: 'primary' }] });
      if (!r) return;
      try { await api('POST', `/api/agents/${encodeURIComponent(one.id)}/save`, { description: r.description, tools: r.tools, prompt: r.prompt, clearModel: !!r.clearModel }); ui.toast('Saved to the agent\'s file', 'success', 1400); this.render(root, ctx); } catch (err) { ui.toast(err.message, 'error'); }
    });
    root.querySelectorAll('[data-job]').forEach(el => el.onclick = () => { this._sel = el.dataset.job; this.render(root, ctx); });
    $('[data-back]')?.addEventListener('click', () => { this._sel = null; this.render(root, ctx); });
    $('[data-cancel]')?.addEventListener('click', () => api('POST', `/api/jobs/${sel.id}/cancel`).catch(err => ui.toast(err.message, 'error')));
    $('[data-rerun]')?.addEventListener('click', async () => { try { const j = await api('POST', `/api/jobs/${sel.id}/rerun`); this._sel = j.id; } catch (err) { ui.toast(err.message, 'error'); } });
    root.querySelectorAll('[data-sched]').forEach(s => s.onchange = () => api('POST', `/api/schedule/${s.dataset.sched}`, { schedule: s.value }).then(() => ui.toast('Schedule saved', 'success', 1400)).catch(err => ui.toast(err.message, 'error')));
    root.querySelectorAll('[data-run]').forEach(b => b.onclick = async () => {
      const a = agents.find(x => x.id === b.dataset.run);
      let input = {};
      if (a.input === 'project') {
        if (!projects.length) return ui.toast('Add a project first', 'error');
        const r = await ui.modal({ title: a.name, body: `<form class="form"><label class="field">Project<select name="project">${ui.projectOptions(projects, projects[0].id, 'Choose…')}</select></label></form>`, actions: [{ label: 'Cancel', kind: 'ghost', value: null }, { label: 'Run', kind: 'primary' }] });
        if (!r?.project) return;
        input = r;
      } else if (a.input === 'note') { return ui.toast('Run this from a note (Extract actions)', 'info'); }
      try { const j = await runAgent(a.id, input); this._sel = j.id; this.render(root, ctx); } catch (err) { ui.toast(err.message, 'error'); }
    });
  },
};
