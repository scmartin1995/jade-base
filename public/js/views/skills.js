// Skills: SKILL.md playbooks agents follow. Any skill that has a schedule can run as an automation.
export default {
  title: 'Skills',
  refreshOn: ['skills', 'schedule', 'jobs'],
  async render(root, ctx) {
    const { api, ui } = ctx;
    const { esc, icon } = ui;
    const [skills, projects, agents] = await Promise.all([api('GET', '/api/skills'), api('GET', '/api/projects'), api('GET', '/api/agents').catch(() => [])]);
    const groups = {
      active: skills.filter(s => ['user', 'builtin'].includes(s.kind)),
      claude: skills.filter(s => ['claude', 'project', 'plugin'].includes(s.kind)),
    };
    const tab = this._tab || (groups.active.length ? 'active' : 'claude');   // open on the tab that has something in it
    const ro = s => !['user', 'builtin'].includes(s.kind); // Claude Code, project and plugin skills are edited where they live
    // "used by": agents whose skills: line names the skill, by its name, its folder name, or the folder Jade installed for that agent (jade-<agent>-<skill>)
    const usedBy = s => { const f = s.dir.split('/').pop(); return agents.filter(a => (a.skills || []).some(n => n === s.name || n === f || f === `jade-${a.id}-${n}` || s.name === `jade-${a.id}-${n}`)).map(a => a.name || a.id); };
    const projName = id => projects.find(p => p.id === id)?.name || id;
    const label = s => s.kind === 'user' ? 'yours' : s.kind === 'builtin' ? 'built-in' : s.kind === 'project' ? 'project: ' + projName(s.origin.slice(8)) : s.kind === 'plugin' ? 'plugin: ' + s.origin.slice(7) : 'Claude Code';
    // On the Claude Code tab, cards are grouped by where they come from
    const order = s => ['claude', 'project', 'plugin'].indexOf(s.kind);
    const automations = groups.active.filter(s => s.automation);
    const list = tab === 'claude' ? [...groups.claude].sort((a, b) => order(a) - order(b) || a.origin.localeCompare(b.origin)) : groups[tab];

    root.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Learning</div><h1>Skills</h1><p>Playbooks in the same <code>SKILL.md</code> format Claude Code uses. Agents pick the relevant ones automatically. Any skill with a schedule can run as an automation.</p></div>
        <div class="tools"><button class="btn primary" data-new>${icon('plus', 16)}New skill</button></div>
      </div>

      ${automations.length ? `<div class="tiny muted" style="margin-bottom:12px">${automations.length} skill${automations.length === 1 ? '' : 's'} can run on a schedule. Turn them on and set when on <a href="#/routines">Routines</a>.</div>` : ''}

      <div class="row wrap" style="margin-bottom:14px"><div class="tabs">
        <button data-tab="active" class="${tab === 'active' ? 'on' : ''}">Active (${groups.active.length})</button>
        <button data-tab="claude" class="${tab === 'claude' ? 'on' : ''}">From Claude Code (${groups.claude.length})</button></div></div>

      ${list.length ? `<div class="grid auto">${list.map(s => `<article class="card skill-card stack" style="gap:10px">
        <div class="row" style="gap:8px"><span class="badge ${esc(s.kind)}" title="${esc(s.origin)}">${esc(label(s))}</span>${s.automation ? `<span class="badge auto" title="${esc(s.automation)}">auto · ${esc(s.automation)}</span>` : ''}<span class="grow"></span>
          <label class="switch" title="Agents may use this skill"><input type="checkbox" data-enable="${esc(s.name)}" ${s.enabled ? 'checked' : ''} aria-label="Enable ${esc(s.name)}"><span></span></label></div>
        <h3>${esc(s.name)}</h3>
        <div class="small dim">${esc(s.description)}</div>
        <div class="body-peek mono">${esc(ui.plain(s.body.replace(/^#.*$/m, '')).slice(0, 300))}</div>
        ${(u => u.length ? `<div class="tiny muted">used by ${esc(u.join(', '))}</div>` : s.ownedBy ? `<div class="tiny muted">used by ${esc(s.ownedBy)}</div>` : '')(usedBy(s))}
        <div class="tiny muted">${s.runs ? `used ${s.runs}×${s.lastRun ? ', last ' + ui.ago(s.lastRun) : ''}` : usedBy(s).length || s.ownedBy ? 'used by its agent whenever that agent runs' : 'not used yet'}</div>
        <div class="row wrap" style="gap:6px;margin-top:auto">
          ${s.needsAllowance ? `<button class="btn sm primary" data-skill-allow="${esc(s.name)}" title="Until you allow it, chat will not match it and it cannot be run">${icon('check', 13)}${s.allowChanged ? 'Changed since you allowed it: allow again' : 'Allow this skill'}</button>`
            : `<button class="btn sm" data-run="${esc(s.name)}">${icon('play', 14)}Run</button>`}
          ${!s.needsAllowance && (s.kind === 'project' || s.kind === 'plugin') ? `<button class="btn sm ghost" data-skill-disallow="${esc(s.name)}">Take the allowance back</button>` : ''}
          <button class="btn sm ghost" data-view="${esc(s.name)}">${icon('doc', 14)}View</button>
          ${ro(s) ? `<button class="btn sm ghost" data-open="${esc(s.name)}" title="Read-only here: edit it where it lives">${icon('external', 14)}Open folder</button>` : `<button class="btn sm ghost" data-claude="${esc(s.name)}" title="Copy into ~/.claude/skills">${icon('external', 14)}To Claude Code</button>`}
          ${s.kind === 'user' ? `<button class="btn sm ghost icon danger" data-del="${esc(s.name)}" aria-label="Delete">${icon('trash', 14)}</button>` : ''}
        </div></article>`).join('')}</div>`
      : `<div class="card empty-big">${icon('bolt', 40)}<h2>${tab === 'claude' ? 'No Claude Code skills found' : 'No skills'}</h2>
         <p>${tab === 'claude' ? 'Skills from ~/.claude/skills, your projects\' .claude/skills and installed plugins appear here, read-only, and agents can use them.' : 'Create one.'}</p></div>`}`;

    const $ = s => root.querySelector(s);
    const byName = n => skills.find(s => s.name === n);
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this._tab = b.dataset.tab; this.render(root, ctx); });
    root.querySelectorAll('[data-auto]').forEach(c => c.onchange = () => api('POST', `/api/skills/${c.dataset.auto}/prefs`, { automation: c.checked }).then(() => ui.toast(c.checked ? `${c.dataset.auto} will run ${byName(c.dataset.auto).automation}` : 'Automation off', 'success')));
    root.querySelectorAll('[data-enable]').forEach(c => c.onchange = () => api('POST', `/api/skills/${c.dataset.enable}/prefs`, { enabled: c.checked }));
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (await ui.confirmBox('Delete skill?', b.dataset.del, 'Delete', 'danger')) api('DELETE', `/api/skills/${b.dataset.del}`); });
    root.querySelectorAll('[data-claude]').forEach(b => b.onclick = async () => {
      if (!await ui.confirmBox('Add to Claude Code?', `Copies ${b.dataset.claude} into ~/.claude/skills so Claude Code can use it everywhere.`, 'Copy')) return;
      try { const r = await api('POST', `/api/skills/${b.dataset.claude}/claude`); ui.toast('Copied to ' + r.path, 'success'); } catch (e) { ui.toast(e.message, 'error'); }
    });
    root.querySelectorAll('[data-skill-allow]').forEach(b => b.onclick = async () => {
      const s = byName(b.dataset.skillAllow);
      if (!await ui.confirmBox(`Allow the skill ${s.name}?`, `This skill comes from ${s.kind === 'plugin' ? 'a plugin' : 'a project folder'} (${s.dir}), not from you or Jade. Once allowed, chat can pick it by its words and it can be run, with the same rights as your own skills (it can edit files, use connectors and search the web, as Jade's permission settings allow). Read it first. If its files change later, you will be asked again.`, 'Yes, allow it')) return;
      try { await api('POST', `/api/skills/${encodeURIComponent(s.name)}/allow`); ui.toast(`${s.name} is allowed`, 'success', 1600); this.render(root, ctx); } catch (e) { ui.toast(e.message, 'error'); }
    });
    root.querySelectorAll('[data-skill-disallow]').forEach(b => b.onclick = async () => {
      try { await api('POST', `/api/skills/${encodeURIComponent(b.dataset.skillDisallow)}/disallow`); ui.toast('Allowance taken back', 'success', 1600); this.render(root, ctx); } catch (e) { ui.toast(e.message, 'error'); }
    });
    root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => api('POST', `/api/skills/${encodeURIComponent(b.dataset.open)}/open-folder`).catch(e => ui.toast(e.message, 'error')));
    root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { const s = byName(b.dataset.view); ui.modal({ title: s.name, wide: true, body: `<p class="dim">${esc(s.description)}</p><div class="tiny muted mono" style="margin-bottom:12px">${esc(s.dir)}</div><article class="md">${ui.md(s.body)}</article>` }); });
    root.querySelectorAll('[data-run]').forEach(b => b.onclick = async () => {
      const s = byName(b.dataset.run);
      const r = await ui.modal({ title: `Run ${s.name}`, body: `<form class="form"><label class="field">Project <small>${s.perProject ? 'this skill works per project' : 'optional'}</small><select name="project">${ui.projectOptions(projects, s.perProject ? projects[0]?.id : '', 'None')}</select></label>
        <label class="field">Extra instructions <small>optional</small><input name="extra"></label></form>`, actions: [{ label: 'Cancel', kind: 'ghost', value: null }, { label: 'Run', kind: 'primary', icon: 'play' }] });
      if (!r) return;
      const j = await api('POST', `/api/skills/${s.name}/run`, r);
      ctx.openJob(j.id);
    });
    $('[data-new]').onclick = async () => {
      const r = await ui.modal({ title: 'New skill', wide: true, body: `<form class="form">
        <div class="two"><label class="field">Name <small>kebab-case</small><input name="name" placeholder="vendor-follow-up" autofocus></label>
        <label class="field">Automation <small>optional, e.g. "weekdays 16:30", "fri 15:00", "every 2h"</small><input name="automation"></label></div>
        <label class="field">When to use it<input name="description" placeholder="Chase vendors who owe deliverables this week"></label>
        <label class="field"><span class="row"><input type="checkbox" name="perProject" style="width:auto;height:auto"> Run once per project</span></label>
        <label class="field">Instructions <small>markdown: the steps an agent should follow</small><textarea name="body" style="min-height:240px;font-family:var(--mono);font-size:13px"># Vendor follow-up\n\n1. …</textarea></label></form>`,
        actions: [{ label: 'Cancel', kind: 'ghost', value: null }, { label: 'Save skill', kind: 'primary', onClick: d => d.name && d.description ? d : (ui.toast('Name and description are required', 'error'), false) }] });
      if (r) { await api('POST', '/api/skills', { ...r, perProject: r.perProject === 'on' }); this._tab = 'active'; }
    };
  },
};
