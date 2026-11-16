// Skeptic's home on the Agents page (#/agents/skeptic): what it checked in the last 30 days, per workflow, and
// its latest verdicts. Read from .state/skeptic/verdicts.jsonl; nothing lives here.
export default {
  title: 'Skeptic',
  refreshOn: ['jobs'],
  async render(root, ctx) {
    const { api, ui, state } = ctx;
    const { esc, icon } = ui;
    const [d, c] = await Promise.all([api('GET', '/api/skeptic'), api('GET', '/api/config').catch(() => state.boot?.config || {})]);
    const names = { chat: 'Chat replies', build: 'Builds' };
    const pct = (n, of) => (of ? `${Math.round((100 * n) / of)}%` : '—');
    // Builds always have a card, so the loop's own settings are here before the first check
    const flows = Object.entries({ ...d.workflows, build: d.workflows?.build || { checks: 0 } });
    const buildOn = c.build?.loop !== false, rounds = c.build?.rounds || 3;
    const verdict = v => ({ pass: 'passed', fix_output: 'sent back', blocked: 'blocked' }[v] || v);
    const card = ([id, w]) => `<article class="card stack" style="gap:8px">
      <div class="row"><h3 class="grow">${esc(names[id] || id)}</h3><span class="chip">${w.checks} check${w.checks === 1 ? '' : 's'}</span></div>
      <div class="row wrap small" style="gap:14px"><span><b>${pct(w.pass || 0, w.checks)}</b> passed</span><span><b>${pct(w.fix_output || 0, w.checks)}</b> sent back</span><span><b>${pct(w.blocked || 0, w.checks)}</b> blocked</span></div>
      ${id === 'chat' ? '<div class="tiny muted">Runs when you ask in a chat ("have Skeptic check it") or press Check on a reply.</div>' : ''}
      ${id === 'build' ? `<div class="tiny muted">Runs on its own after every chat reply that creates or changes files: anything missing from what you asked or the plan agreed in the chat goes back to Jade to fix, and the fix is checked again.</div>
        <div class="row" style="gap:10px;padding-top:4px"><span class="grow small" style="color:var(--fg-soft)">Check every build</span><label class="switch"><input type="checkbox" data-build-loop ${buildOn ? 'checked' : ''} aria-label="Skeptic checks every build"><span></span></label></div>
        <label class="row small" style="gap:10px"><span class="grow" style="color:var(--fg-soft)">Checks before it is your call</span><select data-build-rounds ${buildOn ? '' : 'disabled'}>${[1, 2, 3, 4, 5].map(n => `<option ${n === rounds ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
      <div class="tiny muted">Models: ${esc(Object.keys(w.models || {}).join(', ') || '—')}</div>
      ${d.criteria?.[id] ? `<div class="tiny muted">Criteria: <code>${esc(String(d.criteria[id]).replace(/^.*[\\/](agents|JadeBase)[\\/]/, '$1/'))}</code></div>` : ''}
    </article>`;
    root.innerHTML = `
      <div class="page-head"><div><div class="eyebrow"><a href="#/agents">Agents</a> / Skeptic</div><h1>Skeptic</h1>
        <p>Jade's verifier. It tries to prove another agent's work wrong, and must quote the source for every point it makes; code rejects any verdict whose evidence is not really there. It never sees the other agent's reasoning, and runs on a different model. When it disagrees, the agent must follow it or rebut it with a quote, for up to three rounds; after that, you decide.</p></div></div>
      <div class="grid auto" style="margin-bottom:18px">${flows.map(card).join('')}</div>
      ${(d.recent || []).length ? `<section class="card"><div class="card-head"><h2>${icon('check')}Latest verdicts</h2><span class="tiny muted">last 30 days</span></div>
        <div class="list">${d.recent.map(v => `<div class="item"><span class="status-dot ${v.verdict === 'pass' ? 'done' : v.verdict === 'blocked' ? 'error' : 'queued'}" style="margin-top:7px"></span><div class="main-col">
          <div class="title">${esc(names[v.workflow] || v.workflow)} · ${esc(verdict(v.verdict))}${(v.failed || []).length ? ` · failed ${esc(v.failed.join(', '))}` : ''}</div>
          <div class="meta"><span>${esc(ui.ago(v.at))}</span><span>${esc(v.model || '')}</span>${v.note ? `<span class="ellipsis" style="max-width:520px">${esc(v.note)}</span>` : ''}</div></div></div>`).join('')}</div></section>` : ''}`;
    const save = patch => api('POST', '/api/config', { build: patch }).then(() => { ui.toast('Saved', 'success', 1000); this.render(root, ctx); }).catch(err => ui.toast(err.message, 'error'));
    const loop = root.querySelector('[data-build-loop]'); if (loop) loop.onchange = () => save({ loop: loop.checked });
    const sel = root.querySelector('[data-build-rounds]'); if (sel) sel.onchange = () => save({ rounds: Number(sel.value) });
  },
};
