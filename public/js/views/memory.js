// Memory: the file ring, a Files search across everything Jade can reach (any type: deliverables, documents, Jade's own
// notes), full-text Search of what Jade has read, the folders Jade reads, and long-term facts.
import { mountRing } from '../filering.js';
import { showing } from '../paging.js';

export default {
  title: 'Memory',
  refreshOn: ['memory', 'config', 'notes'],
  async render(root, ctx) {
    const { api, ui, state, params } = ctx;
    const { esc, icon } = ui;
    if (params[0] && ['ring', 'files', 'search'].includes(params[0])) this._tab = params[0];
    const tab = this._tab || 'ring';
    if (state.query?.get('project')) { this._fproj = state.query.get('project'); state.query = null; }
    const [stats, facts, projects] = await Promise.all([api('GET', '/api/memory/stats'), api('GET', '/api/memory/facts'), api('GET', '/api/projects')]);
    try { const handed = sessionStorage.getItem('jade.search'); if (handed) { this._q = handed; this._tab = 'search'; sessionStorage.removeItem('jade.search'); } } catch {}
    const q = this._q || '';
    const hits = tab === 'search' && q ? await api('GET', `/api/search?q=${encodeURIComponent(q)}&limit=30&kinds=${encodeURIComponent(this._kind || '')}`) : [];
    // the searched words lit up inside a snippet (the snippet is already escaped)
    const highlight = (s, query) => { const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); return words.length ? s.replace(new RegExp(`(${words.join('|')})`, 'gi'), '<mark>$1</mark>') : s; };
    const fq = this._fq || '', fproj = this._fproj || '', fkind = this._fkind || '', fmade = !!this._fmade;
    const files = tab === 'files' ? await api('GET', `/api/files?q=${encodeURIComponent(fq)}&project=${encodeURIComponent(fproj)}&kind=${encodeURIComponent(fkind)}&made=${fmade ? 1 : 0}&limit=80`) : [];
    const folders = state.boot.config.memory.folders;
    const short = p => p.replace(state.boot.userHome, '~');
    const kinds = ['note', 'document', 'spreadsheet', 'slides', 'pdf', 'image', 'data'];

    root.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Context</div><h1>Memory</h1><p>Jade remembers by reading your files. Every agent searches these folders and the facts below. Nothing leaves your computer except what an agent sends to your chosen engine.</p></div>
        <div class="tools"><div class="tabs"><button data-tab="ring" class="${tab === 'ring' ? 'on' : ''}">Ring</button><button data-tab="files" class="${tab === 'files' ? 'on' : ''}">Files</button><button data-tab="search" class="${tab === 'search' ? 'on' : ''}">Search</button></div></div>
      </div>

      ${tab === 'ring' ? `
        <section class="card memmap-card">
          <div class="memmap-bar">
            <input type="search" data-ring-q placeholder="Light up files about…" value="${esc(this._ringQ || '')}" aria-label="Find files on the ring">
            <div class="memmap-legend" data-ring-legend></div>
            <div class="tabs" data-ring-mode role="group" aria-label="What the ring shows"><button data-mode="outputs" class="${this.ringMode() === 'outputs' ? 'on' : ''}">Outputs</button><button data-mode="all" class="${this.ringMode() === 'all' ? 'on' : ''}">All files</button></div>
            <button class="btn sm ghost" data-ring-reset>${icon('refresh', 13)}Show everything</button>
          </div>
          <div class="memmap-stage ring-stage" data-ring-stage><div class="memmap-loading">${icon('brain', 28)}<span>Arranging ${this.ringMode() === 'outputs' ? 'your outputs' : stats.files + ' files'}…</span></div></div>
          <aside class="memmap-side" data-side hidden></aside>
          <div class="memmap-help tiny muted">${this.ringMode() === 'outputs' ? 'The ring shows your outputs: finished deliverables only, not the inputs and working files behind them. A ringed dot was saved in the wrong place. Choose All files to see everything. ' : ''}Each coloured slice is a project or folder, sized by how many files it holds; the thin band is its sub-folders. Bright dots just outside the bands changed this week; the rest fan out newest first. Hover for details · click a slice to open it up · click the centre to go back · click a file for details · double-click to open it.</div>
        </section>`
      : tab === 'files' ? `
        <section class="card">
          <div class="row wrap" style="gap:8px;margin-bottom:12px">
            <input type="search" data-fq value="${esc(fq)}" placeholder="Find a file by name… budget, plan, .xlsx" style="flex:2;min-width:240px;height:44px;font-size:15px" autofocus aria-label="Find files">
            <select data-fproj style="flex:1;min-width:160px" aria-label="Project">${ui.projectOptions(projects, fproj, 'All projects')}</select>
            <label class="chip ${fmade ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" data-fmade ${fmade ? 'checked' : ''} style="width:12px;height:12px;margin:0;accent-color:var(--accent)"> Made by Jade</label>
          </div>
          <div class="files-kinds" style="margin-bottom:12px"><button class="chip ${!fkind ? 'on' : ''}" data-fkind="">Any type</button>${kinds.map(k => `<button class="chip ${fkind === k ? 'on' : ''}" data-fkind="${k}">${k === 'report' ? 'Reports' : k === 'note' ? 'Notes' : k === 'pdf' ? 'PDFs' : k[0].toUpperCase() + k.slice(1) + 's'}</button>`).join('')}</div>
          <div class="list">${files.map(f => ui.fileRow(f)).join('') || `<div class="empty">${fq ? 'No files match.' : 'No files yet. Add folders in Settings → Your files, or link folders to a project.'}</div>`}</div>
          <div class="tiny muted" style="margin-top:10px">${files.length}${files.length === 80 ? '+' : ''} file${files.length === 1 ? '' : 's'} · searches names and paths across your project folders, memory folders and Jade's own reports and notes · click a row to open it · press <kbd>Ctrl K</kbd> anywhere and type a name</div>
        </section>`
      : `
        <section class="card" style="margin-bottom:16px">
          <form data-search class="row" style="gap:8px"><input type="search" name="q" value="${esc(q)}" placeholder="Search everything: what documents say, file names, past chats…" style="height:46px;font-size:16px" autofocus aria-label="Search"><button class="btn primary" style="height:46px">${icon('search', 16)}Search</button></form>
          <div class="row wrap" style="gap:6px;margin-top:10px">${[['', 'Everything'], ['document', 'Notes & documents'], ['file', 'Files by name'], ['chat', 'Chats']].map(([k, l]) => `<button class="chip ${(this._kind || '') === k ? 'on' : ''}" data-kind="${k}">${l}</button>`).join('')}
            <span class="tiny muted" style="margin-left:auto">${stats.files} files · ${stats.chunks} passages indexed${stats.building ? ' · indexing…' : ''} · reads ${esc(state.boot.config.memory.extensions.join(' '))}</span></div>
        </section>
        ${q ? `<section class="card" style="margin-bottom:16px"><div class="card-head"><h2>${icon('search')}${hits.length} result${hits.length === 1 ? '' : 's'} for “${esc(q)}”</h2></div>
          <div class="list">${hits.map(h => { const isFile = !h.path.startsWith('#'); const kindLabel = { document: 'document', note: 'note', deliverable: 'deliverable', file: 'file', chat: 'chat' }[h.kind] || h.kind; return `<div class="item" style="align-items:flex-start">
            <div class="main-col" style="min-width:0"><div class="row wrap" style="gap:8px;align-items:baseline"><span class="title ${isFile ? 'link' : ''}" ${isFile ? `data-preview-file="${esc(h.path)}" data-name="${esc(h.title)}" style="cursor:pointer"` : ''}>${isFile ? esc(h.title) : `<a href="${esc(h.path)}" style="color:inherit">${esc(h.title)}</a>`}</span><span class="chip" style="height:20px">${esc(kindLabel)}</span>${h.project ? `<span class="chip on" style="height:20px">${esc(h.project)}</span>` : ''}${h.priority ? `<span class="prio ${esc(h.priority)}">${esc(h.priority)}</span>` : ''}</div>
              ${h.snippet ? `<div class="small dim" style="margin:3px 0">${highlight(esc(h.snippet), q)}</div>` : ''}
              <div class="meta mono"><span class="ellipsis">${esc(isFile ? short(h.path) : h.kind === 'chat' ? `${h.turns || 0} turns` : '')}</span>${h.date ? `<span>${ui.ago(h.date)}</span>` : ''}<span class="muted">score ${h.score}</span></div></div>
            <div class="row" style="gap:4px;flex:none">${isFile ? `<button class="btn sm ghost icon" data-open-file="${esc(h.path)}" title="Open with the usual app" aria-label="Open">${icon('external', 13)}</button><button class="btn sm ghost icon" data-reveal-file="${esc(h.path)}" title="Show in folder" aria-label="Show in folder">${icon('folder', 13)}</button><button class="btn sm ghost icon" data-onring="${esc(h.path)}" title="Show on the ring" aria-label="Ring">${icon('brain', 13)}</button>` : ''}
              ${ui.askBtn(ui.askPrompt(kindLabel, h.title, h.snippet || '', 'Tell me what this is about and what I should do with it.'), { iconOnly: true })}</div></div>`; }).join('') || '<div class="empty">Nothing matched. Try fewer or different words; a word also matches the start of longer ones.</div>'}</div></section>` : ''}`}

      <div class="grid g2" style="align-items:start;margin-top:16px">
        <section class="card">
          <div class="card-head"><h2>${icon('brain')}Long-term facts</h2><span class="tiny muted">memory/facts.md</span></div>
          <form data-fact class="row" style="gap:8px;margin-bottom:8px"><input name="f" placeholder="e.g. Steering committee meets Thursdays at 10" aria-label="New fact"><button class="btn">${icon('plus', 15)}Remember</button></form>
          <div class="list">${facts.map(f => `<div class="item"><span style="color:var(--cyan);margin-top:2px">${icon('spark', 14)}</span><div class="main-col"><div class="title">${esc(f)}</div></div><button class="btn sm ghost icon danger" data-forget="${esc(f)}" aria-label="Forget">${icon('x', 14)}</button></div>`).join('') || '<div class="empty">Tell Jade things worth knowing: people, cadences, preferences.</div>'}</div>
        </section>
        <section class="card">
          <div class="card-head"><h2>${icon('folder')}Folders Jade reads</h2><button class="btn sm primary" data-dir>${icon('plus', 14)}Add folder…</button></div>
          <div class="list">${folders.map(f => { const st = stats.folders.find(x => x.folder === f); return `<div class="item"><span style="color:var(--fg-dim);margin-top:2px">${icon('folder', 15)}</span><div class="main-col"><div class="title mono small">${esc(f)}</div>
            <div class="meta">${st?.exists ? `<span style="color:var(--cyan)">${st.files} files indexed</span>` : '<span style="color:var(--warn)">folder not found</span>'}</div></div>
            <button class="btn sm ghost icon danger" data-rmdir="${esc(f)}" aria-label="Remove folder">${icon('x', 14)}</button></div>`; }).join('') || '<div class="empty">No folders added yet. Project folders are read automatically.</div>'}</div>
          <p class="tiny muted" style="margin-top:10px">Reads ${esc(state.boot.config.memory.extensions.join(', '))} files, including sub-folders. Other file types still show up in Files by name.</p>
        </section>
      </div>`;

    const $ = s => root.querySelector(s);
    const openFile = async file => {
      try {
        // outputs are often Word, PDF or web pages, which cannot be shown as text here: open those with the usual app
        if (!/\.(md|markdown|txt|org)$/i.test(file)) { await api('POST', '/api/fs/open', { path: file }); return; }
        const f = await api('GET', `/api/memory/file?path=${encodeURIComponent(file)}`);
        ui.modal({ title: f.path.split(/[\\/]/).pop(), wide: true, body: `<div class="row" style="margin-bottom:12px"><span class="tiny muted mono grow">${esc(short(f.path))}</span><button class="btn sm" data-open-file="${esc(f.path)}">${icon('external', 13)}Open in app</button></div><article class="md">${ui.md(f.text.replace(/^---[\s\S]*?---\s*/, ''))}</article>` });
      } catch (e) { ui.toast(e.message, 'error'); }
    };
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this._tab = b.dataset.tab; ctx.go('memory/' + b.dataset.tab); });
    $('[data-fact]').onsubmit = async e => { e.preventDefault(); const f = e.target.f.value.trim(); if (f) { await api('POST', '/api/memory/facts', { fact: f }); this.render(root, ctx); } };
    root.querySelectorAll('[data-forget]').forEach(b => b.onclick = async () => { await api('DELETE', '/api/memory/facts', { fact: b.dataset.forget }); this.render(root, ctx); });
    $('[data-dir]').onclick = async () => { const d = await ui.chooseFolder(api, { title: 'Choose a folder for Jade to read' }); if (d && !folders.includes(d)) await api('POST', '/api/config', { memory: { folders: [...folders, d] } }); };
    root.querySelectorAll('[data-rmdir]').forEach(b => b.onclick = () => api('POST', '/api/config', { memory: { folders: folders.filter(f => f !== b.dataset.rmdir) } }));
    root.querySelectorAll('[data-file]').forEach(el => el.onclick = e => { if (!e.target.closest('[data-onring]')) openFile(el.dataset.file); });
    root.querySelectorAll('[data-onring]').forEach(b => b.onclick = () => { this._focus = b.dataset.onring; this._tab = 'ring'; this.render(root, ctx); });

    if (tab === 'search') {
      $('[data-search]').onsubmit = e => { e.preventDefault(); this._q = e.target.q.value.trim(); this.render(root, ctx); };
      root.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { this._kind = b.dataset.kind; this.render(root, ctx); });
      root.querySelectorAll('[data-onring]').forEach(b => b.onclick = () => { this._ringQ = b.dataset.onring; this._tab = 'ring'; ctx.go('memory/ring'); });
      return;
    }
    if (tab === 'files') {
      const rerender = () => this.render(root, ctx).then(() => { const i = root.querySelector('[data-fq]'); if (i && document.activeElement !== i && this._typing) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } this._typing = false; });
      const input = $('[data-fq]');
      input.oninput = () => { this._fq = input.value; this._typing = true; clearTimeout(this._ft); this._ft = setTimeout(rerender, 200); };
      $('[data-fproj]').onchange = e => { this._fproj = e.target.value; rerender(); };
      $('[data-fmade]').onchange = e => { this._fmade = e.target.checked; rerender(); };
      root.querySelectorAll('[data-fkind]').forEach(b => b.onclick = () => { this._fkind = b.dataset.fkind; rerender(); });
      return;
    }
    return this.ring(root, ctx, { side: $('[data-side]'), openFile, short });
  },

  // The ring shows outputs only (final deliverables) unless "All files" is chosen; the choice is remembered.
  ringMode() { try { return localStorage.getItem('jade.ring.mode') === 'all' ? 'all' : 'outputs'; } catch { return this._mode === 'all' ? 'all' : 'outputs'; } },
  setRingMode(m) { this._mode = m; try { localStorage.setItem('jade.ring.mode', m); } catch {} },

  // ---- the file ring
  async ring(root, ctx, { side, openFile, short }) {
    const { api, ui } = ctx;
    const { esc, icon } = ui;
    const $ = s => root.querySelector(s);
    const stage = $('[data-ring-stage]');
    this._ring?.destroy();
    const mode = this.ringMode();
    root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if (b.dataset.mode !== mode) { this.setRingMode(b.dataset.mode); this._ringQ = this._ringQ || ''; this.render(root, ctx); } });
    let list, outs, total = 0, indexing = false, outTotal = 0;
    try {
      // the server decides what is an output (server/core/outputs.js); this page only draws what it is given
      const ring = await api('GET', '/api/outputs/ring'); outs = ring.outputs; outTotal = ring.total ?? outs.length;
      if (mode === 'outputs') list = outs;
      else { const r = await api('GET', `/api/memory/files?limit=${this._fileLimit || 3000}`); list = r.files; total = r.total; indexing = r.indexing; }   // a page of the newest files; "Show more" asks for the next
    } catch (e) { stage.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (!stage.isConnected) return;
    const isOut = new Set(outs.map(o => o.file));
    const allBtn = `<button class="btn sm" data-mode-all>Show all files</button>`;
    if (!list.length) {
      stage.innerHTML = mode === 'outputs'
        ? `<div class="memmap-loading">${icon('folder', 28)}<span>No outputs yet. An output is a finished deliverable (a guide, document, slide deck or workbook) kept in an Output folder.</span>${allBtn}</div>`
        : `<div class="memmap-loading">${icon('folder', 28)}<span>${indexing ? 'Jade is still reading your files. They will appear here in a moment.' : 'No files yet. Add a folder and Jade will arrange it here.'}</span></div>`;
      const b = stage.querySelector('[data-mode-all]'); if (b) b.onclick = () => { this.setRingMode('all'); this.render(root, ctx); };
      return;
    }
    stage.innerHTML = '';
    const showSide = (f, near) => {
      if (!f) { side.hidden = true; return; }
      side.hidden = false;
      side.innerHTML = `<button class="btn sm ghost icon" data-close aria-label="Close" style="float:right">${icon('x', 14)}</button>
        <div class="eyebrow" style="margin-bottom:6px">${esc(f.group)} · ${esc(f.area)}</div>
        <h3 style="font:400 20px/1.25 var(--serif);margin-bottom:8px">${esc(f.title)}</h3>
        <div class="tiny muted mono" style="margin-bottom:10px">${esc(short(f.file))}<br>${f.age === 0 ? 'changed today' : f.age === 1 ? 'changed yesterday' : `changed ${f.age} days ago`}</div>
        <button class="btn sm primary" data-open>${icon('doc', 13)}Open</button>
        <button class="btn sm" data-ask>${icon('spark', 13)}Ask Jade about this</button>
        ${isOut.has(f.file) ? `<button class="btn sm ghost" data-fix="not-output" title="Take it off the ring and remember that">Not an output</button>` : `<button class="btn sm ghost" data-fix="output" title="Put it on the ring and remember that">Make it an output</button>`}
        ${f.loose ? `<div class="tiny muted" style="margin-top:8px">Saved in the wrong place: it looks like a finished document but is not in an Output folder.</div>` : ''}
        ${near.length ? `<div class="eyebrow" style="margin:16px 0 6px">Also in ${esc(f.area)}</div><div class="stack" style="gap:2px">${near.map(m => `<button class="memmap-near" data-near="${esc(m.file)}">${esc(m.title)}</button>`).join('')}</div>` : ''}`;
      side.querySelector('[data-close]').onclick = () => { side.hidden = true; };
      side.querySelector('[data-open]').onclick = () => openFile(f.file);
      side.querySelector('[data-ask]').onclick = () => ctx.send(`Using my file "${f.title}" (${short(f.file)}), what are the key points and anything I should act on?`);
      side.querySelector('[data-fix]').onclick = async e => {
        try { await api('POST', '/api/outputs/override', { path: f.file, as: e.currentTarget.dataset.fix }); ui.toast(e.currentTarget.dataset.fix === 'output' ? 'Added to your outputs' : 'Taken off your outputs', 'info'); this._focus = mode === 'outputs' && e.currentTarget.dataset.fix === 'output' ? f.file : null; this.render(root, ctx); }
        catch (err) { ui.toast(err.message, 'error'); }
      };
      side.querySelectorAll('[data-near]').forEach(b => b.onclick = () => this._ring.select(b.dataset.near));
    };
    this._ring = mountRing(stage, list, { onSelect: showSide, onOpen: f => openFile(f.file), noun: mode === 'outputs' ? 'outputs' : 'files' });
    $('[data-ring-legend]').innerHTML = this._ring.groups.map(g => `<button class="memmap-group ring-key" data-ring-group="${esc(g.name)}" title="Open up ${esc(g.name)}"><i style="background:rgb(${g.color.join(',')})"></i>${g.project ? icon('grid', 11) : ''}${esc(g.name)} <span class="muted">${g.count}</span></button>`).join('');
    if (mode === 'outputs' && showing(list.length, outTotal)) $('[data-ring-legend]').insertAdjacentHTML('beforeend', `<span class="tiny muted">${esc(showing(list.length, outTotal, 'outputs'))}</span>`);
    if (mode === 'all' && (total > list.length || indexing)) {
      $('[data-ring-legend]').insertAdjacentHTML('beforeend', `${total > list.length ? `<button class="btn sm" data-more-files>Showing the newest ${list.length} of ${total} files. Show more</button>` : ''}${indexing ? '<span class="tiny muted">Jade is still reading your files.</span>' : ''}`);
      const more = $('[data-more-files]'); if (more) more.onclick = () => { this._fileLimit = (this._fileLimit || 3000) + 3000; this.render(root, ctx); };
    }
    root.querySelectorAll('[data-ring-group]').forEach(b => b.onclick = () => this._ring.focusGroup(b.dataset.ringGroup));
    const input = $('[data-ring-q]');
    const find = async q => {
      this._ringQ = q;
      if (!q.trim()) return this._ring.setHits(null);
      const ql = q.toLowerCase();
      const hits = new Set(list.filter(f => (f.title + ' ' + f.group + ' ' + f.area).toLowerCase().includes(ql)).map(f => f.file));
      this._ring.setHits(hits);
      try { for (const h of await api('GET', `/api/memory/search?q=${encodeURIComponent(q)}&k=40`)) hits.add(h.file); } catch {}
      if (this._ringQ === q) this._ring.setHits(new Set(hits));
    };
    input.oninput = () => { clearTimeout(this._rq); this._rq = setTimeout(() => find(input.value), 220); };
    if (this._ringQ) find(this._ringQ);
    $('[data-ring-reset]').onclick = () => { input.value = ''; this._ringQ = ''; this._ring.reset(); side.hidden = true; };
    if (this._focus) { const f = this._focus; this._focus = null; setTimeout(() => this._ring.select(f), 300); }
  },
};
