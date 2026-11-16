import { createLatest, pageOf, hasMore, nextSize, showing } from '../paging.js';
// Chats: conversations with Jade. Threads on the left, the conversation on the right, a composer at the bottom.
// Replies stream in live; tool use and the actions Jade took show inside each reply.
const STARTERS = [
  ['What needs my attention today?', 'sun'],
  ['Which of my projects has the most open actions?', 'pulse'],
  ['Add an action: chase the vendor on Friday', 'checks'],
  ['What did we decide in my last meeting notes?', 'pen'],
];

export default {
  title: 'Chats',
  refreshOn: ['chats', 'chat-pending'],
  async render(root, ctx) {
    const { api, ui, state, go, params } = ctx;
    const mine = (this._latest ||= createLatest()).begin(), live = () => mine() && state.route === 'chat' && root.isConnected;   // a slow answer for an old search or page is dropped
    const { esc, icon } = ui;
    // The list of conversations and the open one's latest turns are asked for a page at a time: the server filters the list, and one
    // more than is shown tells whether there is more. "Show earlier messages" asks for 40 more turns.
    const cid = params[0];
    const isNew = !cid || cid === 'new';
    const listN = this._listN ||= 50, turnsN = 40 + ((this._earlier ||= {})[cid] || 0);
    const query = new URLSearchParams({ limit: String(listN), paged: '1', ...(this._q ? { q: this._q } : {}) });
    const [found, thread] = await Promise.all([api('GET', `/api/chats?${query}`),
      !isNew ? api('GET', `/api/chats/${encodeURIComponent(cid)}?limit=${turnsN}`).catch(() => null) : null]);
    if (!live()) return;
    const { items: threads, total: threadTotal } = pageOf(found), moreThreads = hasMore(threads.length, threadTotal);
    const earlierTurns = thread ? Math.max(0, (thread.total ?? thread.turns.length) - thread.turns.length) : 0;
    // a Skeptic check shows like a reply in progress
    const talking = j => ['jade', 'skeptic'].includes(j.agent) && j.input?.thread === cid && (j.status === 'running' || j.status === 'queued');
    const pending = state.jobs.find(j => talking(j) && j.id === state.pendingChat) || state.jobs.find(talking);
    const groups = {};
    for (const t of threads) {
      const d = ui.daysUntil(t.updatedAt.slice(0, 10));
      const g = d === 0 ? 'Today' : d === -1 ? 'Yesterday' : d > -7 ? 'This week' : 'Earlier';
      (groups[g] ||= []).push(t);
    }
    const name = state.boot.config.assistantName || 'Jade';
    // The work panel: this reply's sub-agents while it runs (else the latest reply's), and the files changed in the whole chat.
    // It opens by itself the first time sub-agent work starts in a reply; after that, the toggle is the user's.
    const past = ctx.panelPast(thread);
    if (pending?.agents?.length && !state.panelAuto.has(pending.id)) { state.panelAuto.add(pending.id); if (window.innerWidth > 1000) state.panel.open = true; }
    const panelRunning = !!pending?.agents?.some(a => a.status === 'running');
    const panelHtml = ui.sidePanel({ agents: pending?.agents?.length ? pending.agents : past.agents, files: ctx.panelFiles(past.files, pending?.touched), open: [...state.panel.cards], earlier: !pending?.agents?.length });
    // Model for this conversation: its saved choice, or for a new chat the one picked before sending.
    const choice = isNew ? (this._newChoice ||= { model: '', effort: '' }) : { model: thread?.model || '', effort: thread?.effort || '' };
    const draft = this._drafts?.[cid || 'new'] || '';
    const stripActions = s => s.replace(/```jade-actions[\s\S]*?(```|$)/, '').trim();

    const pics = t => ((t.images || []).length ? `<div class="msg-pics">${t.images.map(f => `<img src="/api/files/raw?path=${encodeURIComponent(f)}" alt="Pasted image" loading="lazy">`).join('')}</div>` : '')
      + (t.gone ? `<div class="msg-gone">${icon('check', 11)}${t.gone === 1 ? 'Picture' : `${t.gone} pictures`} deleted after being written up</div>` : '')
      + ((t.files || []).length ? `<div class="msg-files">${t.files.map(f => `<button type="button" class="file-chip" data-preview-file="${esc(f)}" data-file-name="${esc(f.split(/[\\/]/).pop())}" title="Open ${esc(f.split(/[\\/]/).pop())}">${icon('doc', 13)}<span>${esc(f.split(/[\\/]/).pop())}</span></button>`).join('')}</div>` : '');
    // "Check" on a reply asks Skeptic to check it; once checked, the button says what it found. Skeptic's own notes have none.
    const checkBtn = t => (t.skeptic === true || t.lessons || t.auto) ? ''
      : `<button class="btn sm ghost" data-check="${esc(t.at)}" title="Have Skeptic check this reply">${icon('check', 13)}${!t.skeptic?.verdict ? 'Check' : t.skeptic.verdict === 'pass' ? 'Skeptic: OK' : t.skeptic.verdict === 'blocked' ? 'Skeptic: could not check' : 'Skeptic: problems'}</button>`;
    // Skeptic's notes and the fix rounds of a build fold into one quiet line each; Jade's closing summary is the visible part.
    const stepRow = t => `<details class="msg-step"><summary>${icon(t.skeptic === true ? 'check' : 'refresh', 12)}<span>${esc(String(t.label || t.text || '').split('\n')[0].replace(/[*_`]/g, '').slice(0, 110))}</span><em>${esc(ui.ago(t.at))}</em></summary><div class="md">${ui.md(t.text)}</div></details>`;
    const turn = t => t.step ? stepRow(t) : t.role === 'user'
      ? `<div class="msg user">${pics(t)}${String(t.text || '').trim() ? `<div class="bubble user">${esc(t.text)}</div>` : ''}<div class="msg-meta">${t.via === 'voice' ? icon('mic', 11) + ' ' : ''}${esc(ui.ago(t.at))}</div></div>`
      : `<div class="msg jade"><span class="gem" aria-hidden="true"></span><div class="msg-body">
          <div class="md">${ui.md(t.text)}</div>
          ${t.applied?.length ? `<div class="applied">${t.applied.map(a => `<div>${icon('check', 13)}${esc(a)}</div>`).join('')}</div>` : ''}
          ${ui.touchedList(t.touched, { imagesDeleted: t.imagesDeleted })}
          <div class="msg-meta">${esc(ui.ago(t.at))}${t.engine ? ` · ${esc(modelLabel(t.model, false, state.boot.models?.choices))}` : ''}${t.tools ? ` · ${t.tools} tool call${t.tools === 1 ? '' : 's'}` : ''}${t.connectors?.length ? ` · used ${t.connectors.map(c => ({ gmail: 'Gmail', calendar: 'Calendar', drive: 'Drive', web: 'the web' }[c] || c)).join(', ')}` : ''}
            <button class="btn sm ghost icon" data-copy="${esc(t.at)}" title="Copy reply" aria-label="Copy reply">${icon('copy', 13)}</button>${checkBtn(t)}</div>
        </div></div>`;

    const spTop = root.querySelector('.sp-scroll')?.scrollTop || 0;
    root.innerHTML = `
      <div class="chat-shell ${cid ? 'detail-open' : ''} ${cid && state.panel.open ? 'panel-open' : ''}">
        <aside class="threads">
          <button class="btn primary" data-new style="width:100%">${icon('plus', 16)}New chat</button>
          <input type="search" id="tq" placeholder="Search conversations…" value="${esc(this._q || '')}" aria-label="Search conversations">
          <div class="thread-list">
            ${Object.entries(groups).map(([g, ts]) => `<div class="eyebrow" style="margin:14px 8px 6px">${g}</div>
              ${ts.map(t => `<a class="thread-item ${t.id === cid ? 'on' : ''}" href="#/chat/${esc(t.id)}"><span class="t-title">${esc(t.title)}</span><span class="t-prev">${esc(ui.plain(t.preview))}</span></a>`).join('')}`).join('')
              || `<div class="empty small">${this._q ? 'No matches.' : 'Your conversations will be listed here.'}</div>`}
            ${moreThreads ? `<button class="btn sm ghost" data-more-threads style="width:100%;margin-top:8px">Show more conversations</button><div class="tiny muted" style="margin-top:6px">${showing(threads.length, threadTotal)}</div>` : ''}
          </div>
        </aside>

        <section class="conversation">
          ${cid ? `<header class="conv-head">
              <a class="btn sm ghost icon back" href="#/chat" aria-label="All chats">${icon('arrow_left', 16)}</a>
              <h1 class="conv-title" title="Rename">${esc(thread?.title || 'New chat')}</h1>
              <button class="btn sm ghost icon sp-toggle ${state.panel.open ? 'on' : ''} ${panelRunning ? 'busy' : ''}" data-panel-toggle aria-pressed="${state.panel.open}" title="Sub-agents and changed files" aria-label="Show or hide the work panel">${icon('panel', 15)}</button>
              ${isNew ? '' : `<button class="btn sm ghost icon" data-rename aria-label="Rename">${icon('edit', 14)}</button>
              <button class="btn sm ghost icon danger" data-del aria-label="Delete conversation">${icon('trash', 14)}</button>`}
            </header>` : ''}
          <div class="messages" id="messages">
            ${earlierTurns ? `<button class="btn sm ghost" data-earlier style="justify-self:center;margin:6px 0 12px">Show earlier messages (${earlierTurns} more)</button>` : ''}
            ${thread?.turns?.length ? thread.turns.map(turn).join('') : `<div class="chat-hello">
                <div class="chat-face" data-face></div>
                <h1>What can I take off your plate${state.boot.config.name ? `, <em>${esc(state.boot.config.name.split(' ')[0])}</em>` : ''}?</h1>
                <p>${esc(name)} works from your projects, notes, actions and memory. Ask a question, or tell it to do something.</p>
                <div class="starters">${STARTERS.map(([t, ic]) => `<button class="starter" data-starter="${esc(t)}">${icon(ic, 16)}<span>${esc(t)}</span></button>`).join('')}</div>
              </div>`}
            ${pending ? `<div class="msg jade"><span class="gem working" aria-hidden="true"></span><div class="msg-body">
                <div class="md" data-stream="${esc(pending.id)}">${state.streams.get(pending.id) ? ui.md(stripActions(state.streams.get(pending.id))) : '<span class="typing"><i></i><i></i><i></i></span>'}</div>
                <div data-touched="${pending.id}">${ui.touchedList(pending.touched, { live: true })}</div>
                <div class="tool-line" data-tools="${pending.id}">${ctx.workLine ? ctx.workLine(pending) : ''}</div>
                <button class="btn sm ghost" data-stop="${pending.id}" style="justify-self:start">${icon('stop', 13)}Stop</button>
              </div></div>` : ''}
          </div>
          <form class="composer" id="composer">
            <div class="paste-tray" data-tray hidden></div>
            <textarea id="msg" rows="1" placeholder="Message ${esc(name)}…" aria-label="Message">${esc(draft)}</textarea>
            <div class="composer-bar">
              <div class="model-pick-wrap">
                <button type="button" class="model-pick" data-model-pick aria-haspopup="menu" aria-expanded="false" title="Choose the model and effort for this chat">
                  ${icon('cpu', 13)}<span>${esc(modelLabel(choice.model, true, state.boot.models?.choices))}${choice.effort ? ` · ${esc(choice.effort)}` : ''}</span><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
                </button>
              </div>
              <button type="button" class="btn sm ghost icon" data-attach title="Attach files" aria-label="Attach files">${icon('clip', 16)}</button>
              <input type="file" data-attach-input multiple hidden>
              <span class="tiny muted hide-sm">Enter to send · Shift+Enter for a new line · drop or paste files to attach</span><span class="grow"></span>
              ${ctx.enabled('voice') ? `<button type="button" class="mic" data-mic title="Talk" aria-label="Talk">${icon('mic', 18)}</button>` : ''}
              <button class="send" aria-label="Send" ${pending ? 'disabled' : ''}>${icon('send', 17)}</button>
            </div>
          </form>
        </section>
        ${cid ? `<aside class="side-panel" aria-label="Work panel">
          <header class="sp-head"><b>Work</b><button class="btn sm ghost icon" data-panel-toggle aria-label="Hide the panel">${icon('x', 14)}</button></header>
          <div class="sp-scroll" data-panel-body>${panelHtml}</div>
        </aside>` : ''}
      </div>`;

    const $ = s => root.querySelector(s);
    if ($('.sp-scroll')) { $('.sp-scroll').scrollTop = spTop; $('[data-panel-body]')._html = panelHtml; }
    const slot = $('[data-face]');
    if (slot) {
      this._face ||= ctx.face.mount(document.createElement('div'), { size: 170, caption: false });
      slot.appendChild(this._face.el);
      this._face.update();
    }
    // The message list follows new messages only when the user was already reading at the bottom (or just opened this chat);
    // reading something further up, a refresh leaves them where they were. Instant, not smooth, so nothing visibly jumps.
    const msgs = $('#messages');
    const was = this._scroll?.cid === cid ? this._scroll : null;
    if (this._keep && this._keep.cid === cid) { msgs.scrollTo({ top: msgs.scrollHeight - this._keep.fromBottom, behavior: 'instant' }); this._keep = null; }   // earlier messages were added above: stay on what was being read
    else if (thread?.turns?.length || pending) msgs.scrollTo({ top: !was || was.atBottom ? msgs.scrollHeight : was.top, behavior: 'instant' });
    const note = () => { this._scroll = { cid, top: msgs.scrollTop, atBottom: msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60 }; };
    msgs.addEventListener('scroll', note, { passive: true });
    note();
    if (thread?.title) document.title = `${name} · ${thread.title}`;
    const ta = $('#msg');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; };
    grow();
    ta.oninput = () => { (this._drafts ||= {})[cid || 'new'] = ta.value; grow(); };
    ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } };
    if (!('ontouchstart' in window)) setTimeout(() => ta.focus(), 50);
    // Attached files wait in a tray above the box until the message is sent: images as thumbnails, anything else as a named
    // chip. They come from the attach button, a paste or a drop. Kept per chat, so a re-render (a reply arriving elsewhere)
    // never loses them.
    const key = cid || 'new';
    const tray = $('[data-tray]');
    const held = () => ((this._pics ||= {})[key] ||= []);       // images: data: URLs
    const heldFiles = () => ((this._files ||= {})[key] ||= []); // other files: { name, size, data }
    const MAX_FILES = 10, MAX_FILE = 25 * 1024 * 1024, BLOCKED = /\.(exe|msi|bat|cmd|com|scr|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|dll|sys|reg|jar|app|sh)$/i;
    const paintTray = () => {
      const imgs = held(), docs = heldFiles();
      tray.hidden = !imgs.length && !docs.length;
      tray.innerHTML = imgs.map((d, i) => `<span class="paste-pic"><img src="${esc(d)}" alt="Pasted image ${i + 1}"><button type="button" data-unpaste="${i}" aria-label="Remove image" title="Remove">×</button></span>`).join('')
        + docs.map((f, i) => `<span class="file-chip held" title="${esc(f.name)}">${icon('doc', 13)}<span>${esc(f.name)}</span><small>${ui.fmtSize(f.size)}</small><button type="button" data-unfile="${i}" aria-label="Remove ${esc(f.name)}" title="Remove">×</button></span>`).join('');
      tray.querySelectorAll('[data-unpaste]').forEach(b => b.onclick = () => { held().splice(+b.dataset.unpaste, 1); paintTray(); });
      tray.querySelectorAll('[data-unfile]').forEach(b => b.onclick = () => { heldFiles().splice(+b.dataset.unfile, 1); paintTray(); });
    };
    const take = fileList => {
      for (const f of [...fileList]) {
        const image = /^image\/(png|jpeg|gif|webp)$/.test(f.type);
        if (image) {
          if (held().length >= 6) { ui.toast('Six images at most per message', 'info'); continue; }
          if (f.size > 8 * 1024 * 1024) { ui.toast(`${f.name || 'That image'} is over 8 MB`, 'error'); continue; }
        } else {
          if (BLOCKED.test(f.name)) { ui.toast(`${f.name} is a program or script, so it can't be attached`, 'error'); continue; }
          if (heldFiles().length >= MAX_FILES) { ui.toast(`${MAX_FILES} files at most per message`, 'info'); break; }
          if (f.size > MAX_FILE) { ui.toast(`${f.name} is over 25 MB`, 'error'); continue; }
          if (!f.size) { ui.toast(`${f.name} is empty`, 'error'); continue; }
        }
        const r = new FileReader();
        r.onload = () => { if (image) held().push(r.result); else heldFiles().push({ name: f.name, size: f.size, data: r.result }); paintTray(); };
        r.onerror = () => ui.toast(`${f.name} could not be read`, 'error');
        r.readAsDataURL(f);
      }
    };
    const picker = $('[data-attach-input]');
    $('[data-attach]').onclick = () => picker.click();
    picker.onchange = () => { take(picker.files); picker.value = ''; ta.focus(); };
    ta.addEventListener('paste', e => {
      const got = [...(e.clipboardData?.files || [])];
      if (!got.length) return; // plain text pastes as usual
      e.preventDefault();
      take(got);
    });
    const box = $('#composer');
    box.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); box.classList.add('dropping'); } });
    box.addEventListener('dragleave', () => box.classList.remove('dropping'));
    box.addEventListener('drop', e => { box.classList.remove('dropping'); if (e.dataTransfer?.files?.length) { e.preventDefault(); take(e.dataTransfer.files); } });
    paintTray();
    const send = (text, thread) => {
      const images = held().slice(), files = heldFiles().map(({ name, data }) => ({ name, data }));
      if ((!text.trim() && !images.length && !files.length) || pending) return;
      (this._drafts ||= {})[cid || 'new'] = '';
      this._pics[key] = []; this._files[key] = []; paintTray();
      // A new chat carries the picked model with its first message; an open one already has it saved.
      ctx.send(text, 'text', thread, { ...(isNew ? { model: choice.model, effort: choice.effort } : {}), images, files });
      if (isNew) this._newChoice = null;
    };
    // The model menu
    const pick = $('[data-model-pick]');
    pick.onclick = e => { e.stopPropagation(); this._menuOpen = !this._menuOpen; openMenu(); };
    const openMenu = () => {
      root.querySelector('.model-menu')?.remove();
      if (this._onDoc) { document.removeEventListener('click', this._onDoc); this._onDoc = null; }
      pick.setAttribute('aria-expanded', String(!!this._menuOpen));
      if (!this._menuOpen) return;
      const defModels = state.boot.config.models || {};
      // Only the models discovered from the provider (see models.js); never a list typed into the code.
      const models = (state.boot.models?.choices || []).map(m => [m.id, m.label, m.note]);
      const menu = document.createElement('div');
      menu.className = 'model-menu';
      menu.setAttribute('role', 'menu');
      menu.innerHTML = `
        <div class="mm-title">Model</div>
        <button type="button" role="menuitemradio" aria-checked="${!choice.model}" class="mm-item ${!choice.model ? 'on' : ''}" data-model=""><span>Default</span><em>${esc(defModels.claude || 'everyday model, found automatically')}</em></button>
        ${models.map(([v, l, note]) => `<button type="button" role="menuitemradio" aria-checked="${choice.model === v}" class="mm-item ${choice.model === v ? 'on' : ''}" data-model="${esc(v)}"><span>${esc(l)}</span><em>${esc(note)}</em></button>`).join('')}
        ${models.length ? '' : '<div class="mm-foot">No models were found. <a href="#/settings/engine">Run Diagnose in Settings</a></div>'}
        ${`<div class="mm-title">Effort</div>
        ${[['', 'auto', state.boot.config.chat?.effort ? `Settings: ${state.boot.config.chat.effort}` : "the model's default"], ...EFFORTS].map(([v, l, note]) => `<button type="button" role="menuitemradio" aria-checked="${(choice.effort || '') === v}" class="mm-item ${(choice.effort || '') === v ? 'on' : ''}" data-effort="${v}"><span>${esc(l)}</span><em>${esc(note || '')}</em></button>`).join('')}`}
        <div class="mm-foot">${isNew ? 'Applies to this new chat.' : 'Saved for this conversation.'} Change the default in Settings.</div>`;
      pick.parentElement.appendChild(menu);
      const apply = async patch => {
        Object.assign(choice, patch);
        if (isNew) Object.assign(this._newChoice, { model: choice.model, effort: choice.effort });
        else await api('PATCH', `/api/chats/${cid}`, { model: choice.model, effort: choice.effort || '' });
        this._menuOpen = false;
        this.render(root, ctx);
      };
      menu.querySelectorAll('[data-model]').forEach(b => b.onclick = () => apply({ model: b.dataset.model }));
      menu.querySelectorAll('[data-effort]').forEach(b => b.onclick = () => apply({ effort: b.dataset.effort }));
      this._onDoc = ev => {
        if (menu.contains(ev.target) || pick.contains(ev.target)) return;
        this._menuOpen = false; menu.remove(); pick.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', this._onDoc); this._onDoc = null;
      };
      setTimeout(() => this._onDoc && document.addEventListener('click', this._onDoc), 0);
    };
    openMenu();
    $('#composer').onsubmit = e => { e.preventDefault(); const t = ta.value; ta.value = ''; send(t, isNew ? 'new' : cid); };
    root.querySelectorAll('[data-starter]').forEach(b => b.onclick = () => send(b.dataset.starter, isNew ? 'new' : cid));
    $('[data-mic]')?.addEventListener('click', () => ctx.voice.pushToTalk());
    $('[data-stop]')?.addEventListener('click', e => api('POST', `/api/jobs/${e.currentTarget.dataset.stop}/cancel`));
    $('[data-new]').onclick = () => go('chat/new');
    $('[data-more-threads]')?.addEventListener('click', () => { this._listN = nextSize(this._listN, 50, threadTotal); this.render(root, ctx); });
    $('[data-earlier]')?.addEventListener('click', () => { this._keep = { cid, fromBottom: msgs.scrollHeight - msgs.scrollTop }; this._earlier[cid] = (this._earlier[cid] || 0) + 40; this.render(root, ctx); });
    root.querySelectorAll('[data-panel-toggle]').forEach(b => b.onclick = () => ctx.togglePanel());
    $('#tq').oninput = e => { this._q = e.target.value; this._listN = 50; clearTimeout(this._t); this._t = setTimeout(() => live() && this.render(root, ctx).then(() => { const i = root.querySelector('#tq'); if (!i || state.route !== 'chat') return; i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 180); };
    root.querySelectorAll('[data-check]').forEach(b => b.onclick = async () => {
      try { const j = await api('POST', `/api/chats/${cid}/check`, { at: b.dataset.check }); state.pendingChat = j.id; this.render(root, ctx); } catch (err) { ui.toast(err.message, 'error'); }
    });
    root.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => ui.copy(thread.turns.find(t => t.at === b.dataset.copy)?.text || ''));
    const rename = async () => {
      const r = await ui.modal({ title: 'Rename conversation', body: `<form class="form"><label class="field">Title<input name="title" value="${esc(thread?.title || '')}" autofocus></label></form>`,
        actions: [{ label: 'Cancel', kind: 'ghost', value: null }, { label: 'Save', kind: 'primary' }] });
      if (r?.title) await api('PATCH', `/api/chats/${cid}`, { title: r.title });
    };
    $('[data-rename]')?.addEventListener('click', rename);
    $('.conv-title')?.addEventListener('dblclick', rename);
    $('[data-del]')?.addEventListener('click', async () => {
      if (await ui.confirmBox('Delete conversation?', thread?.title || '', 'Delete', 'danger')) { await api('DELETE', `/api/chats/${cid}`); go('chat'); }
    });
  },
};

// Effort levels exactly as Claude Code's /effort names them. "auto" sends none, so the model's own default applies.
const EFFORTS = [['low', 'low', 'quick exchanges'], ['medium', 'medium', 'everyday work'], ['high', 'high', 'edge cases, verifying'], ['xhigh', 'xhigh', 'deeper, more tokens'], ['max', 'max', 'hard problems; may overthink']];
// The effort menu is shown for every model. Where a model has no effort setting the engine leaves the flag out by itself, so nothing here guesses from a name.
/** "Claude · Opus", or for a reply the model that actually answered ("claude-opus-5-5" -> "Opus 5.5"). */
function modelLabel(model, short = false, choices = []) {
  if (!model) return short ? 'Default model' : 'Claude';
  const m = /^claude-(\w+)-(\d+)-(\d+)/.exec(model);
  const pretty = m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : choices.find(c => c.id === model)?.label || model;
  return `Claude · ${pretty}`;
}
