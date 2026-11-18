// Jade shell: routing, live updates (server-sent events), the dock, Spotlight, the activity drawer and voice.
import * as ui from './ui.js';
import * as voice from './voice.js';
import * as face from './face.js';
import { createStreamer } from './stream.js';

const { esc, icon } = ui;
const $ = s => document.querySelector(s);

export const state = { boot: null, jobs: [], route: 'home', params: [], streams: new Map(), pendingChat: null, pendingThread: null,
  panel: { open: false, cards: new Set() }, panelAuto: new Set(), panelMem: { cid: '', files: [], agents: [] } };

// ------------------------------------------------------------------ API
// api and apiUpload live in api.js (no browser globals at import time) so views never import this shell.
import { api, apiUpload, netMessage } from './api.js';
export { api, apiUpload };
const streamer = createStreamer({ state, api, ui, doc: document });   // draws a run's words as they arrive (stream.js)

// Safety net: any button whose request fails without its own message still tells the person something.
// A request cancelled on purpose (AbortError) stays silent, and the same message is not shown again within a few seconds (a real repeat later is).
let lastNet = '', lastNetAt = 0;
window.addEventListener('unhandledrejection', e => {
  if (e.reason?.name === 'AbortError') { e.preventDefault(); return; }
  const m = netMessage(e.reason, lastNet, Date.now() - lastNetAt);
  if (m) { lastNet = m; lastNetAt = Date.now(); ui.toast(m, 'error', 6000); }
  if (e.reason?.message) e.preventDefault();
});

// ------------------------------------------------------------------ theme
function applyTheme(t) {
  if (!t) return;
  const map = { '--bg': t.background, '--bg-2': t.dark_background, '--bg-3': t.darker_background, '--surface': t.lighter_background, '--sel': t.selection,
    '--muted': t.muted, '--fg': t.foreground, '--fg-dim': t.dark_foreground, '--fg-soft': t.light_foreground, '--fg-bright': t.bright_foreground,
    '--accent': t.accent, '--cyan': t.cyan, '--red': t.red, '--yellow': t.bright_yellow || t.yellow, '--orange': t.orange, '--green': t.green, '--magenta': t.magenta };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(map)) if (v) root.style.setProperty(k, v);
  root.style.colorScheme = t.mode === 'light' ? 'light' : 'dark';
  document.querySelector('meta[name=theme-color]').content = t.dark_background || t.background;
  window.dispatchEvent(new Event('jade:theme'));
}

// ------------------------------------------------------------------ awake / standby
// Jade wakes when you talk to it (wake word, Ask, a chat) or an agent starts work, and drops back to standby after
// a few quiet minutes.
const STANDBY_AFTER = 3 * 60e3;
let standbyTimer = 0;
export function wake() {
  const was = face.isAwake();
  face.setAwake(true);
  if (!was) updateMood();
  clearTimeout(standbyTimer);
  standbyTimer = setTimeout(maybeStandby, STANDBY_AFTER);
}
function maybeStandby() {
  const busy = state.jobs.some(j => j.status === 'running' || j.status === 'queued') || !$('#spot').hidden || voice.status().mode === 'command';
  if (busy) { standbyTimer = setTimeout(maybeStandby, 30e3); return; }
  face.setAwake(false);
  updateMood();
}

// "Hey Jade" on any page: the core wakes in the middle of the screen with what you're saying under it.
let hud = null, hudCore = null, hudTimer = 0;
function showHud(text, hint) {
  wake();
  clearTimeout(hudTimer);
  if (!hud) {
    hud = document.createElement('div');
    hud.className = 'wake-hud';
    hud.innerHTML = '<div class="hud-core"></div><div class="hud-hint"></div><div class="hud-said"></div>';
    document.body.appendChild(hud);
    hudCore ||= face.mount(document.createElement('div'), { size: 340, caption: false, interactive: false });
    hud.querySelector('.hud-core').appendChild(hudCore.el);
    hudCore.update();
    requestAnimationFrame(() => hud?.classList.add('on'));
  }
  hud.querySelector('.hud-hint').textContent = hint ? `${hint} · Esc to cancel` : '';
  hud.querySelector('.hud-said').textContent = text || '';
}
function hideHud(delay = 0) {
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    if (!hud) return;
    const h = hud; hud = null;
    h.classList.remove('on');
    setTimeout(() => h.remove(), 350);
  }, delay);
}

// ------------------------------------------------------------------ Jade's mood (drives the face)
let flash = null, flashTimer = 0;
export function flashMood(mood, ms, caption) {
  flash = { mood, caption };
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash = null; updateMood(); }, ms);
  updateMood();
}
function updateMood() {
  if (!state.boot) return;
  const vs = voice.status();
  const running = state.jobs.filter(j => j.status === 'running');
  const hr = new Date().getHours();
  let mood = 'idle', caption = 'Here when you need me · click to ask';
  if (vs.mode === 'command') { mood = 'listening'; caption = 'Listening…'; }
  else if (voice.isSpeaking()) { mood = 'speaking'; caption = 'Speaking…'; }
  else if (flash) { mood = flash.mood; caption = flash.caption; }
  else if (running.length) { mood = 'thinking'; caption = `Working on ${running[0].title}${running.length > 1 ? ` · +${running.length - 1} more` : ''}`; if (!face.isAwake()) wake(); }
  else if (vs.mode === 'wake') caption = `Listening for “${cap(state.boot.config.wakeWord)}”`;
  else if (hr >= 23 || hr < 6) { mood = 'sleepy'; caption = 'Resting'; }
  if (mood === 'idle' && !face.isAwake()) caption = vs.mode === 'wake' ? `Listening for “${cap(state.boot.config.wakeWord)}”` : vs.micDenied ? 'Microphone blocked · allow it to use the wake word' : 'Standing by · click to ask';
  face.setMood(mood, caption);
}

// ------------------------------------------------------------------ navigation
// The dock comes from the module manifests (/api/boot): a module with `nav` entries is in it, in `order`, with a separator between
// each hundred (10-50 | 110-140 | 210). The module a route belongs to: its id, a nav route, or a route it declares under `views`.
const navMods = () => state.boot.modules.filter(m => m.nav?.length).sort((a, b) => a.order - b.order);
const moduleOf = route => state.boot?.modules.find(m => m.id === route || m.nav?.some(n => n.route === route) || (m.views && route in m.views))?.id || route;
const MOBILE_TABS = ['home', 'chat', 'projects', 'actions'];

const enabled = id => state.boot?.modules.find(m => m.id === id)?.enabled;

let lastDock = '';

// The dock: the OS's app switcher. The menubar: crumb, agent and voice status, engine, clock.
function renderNav() {
  const mods = state.boot.modules;
  const running = state.jobs.filter(j => j.status === 'running' || j.status === 'queued').length;
  const counts = { actions: state.counts?.actions, agents: running };
  let lastGroup = null;
  const items = navMods().filter(m => m.enabled).map(m => {
    const id = m.id, route = m.nav[0].route, group = Math.floor(m.order / 100);
    const sep = lastGroup !== null && group !== lastGroup ? '<span class="dock-sep" aria-hidden="true"></span>' : '';
    lastGroup = group;
    const on = moduleOf(state.route) === id;
    const n = counts[id];
    return sep + `<a href="#/${route}" class="dock-app ${on ? 'on' : ''} ${MOBILE_TABS.includes(id) ? 'pin' : ''}" ${on ? 'aria-current="page"' : ''} aria-label="${esc(m.name)}">
      ${icon(m.icon, 21)}<span class="dock-tip">${esc(m.nav[0].label || m.name)}</span>${n ? `<em class="dock-badge">${n}</em>` : ''}</a>`;
  }).join('').replace(/(<span class="dock-sep" aria-hidden="true"><\/span>\s*)+/g, '<span class="dock-sep" aria-hidden="true"></span>');
  const dockHtml = `<button class="dock-ask" id="dock-ask" aria-label="Ask Jade">${icon('spark', 18)}<span>Ask</span></button><span class="dock-sep" aria-hidden="true"></span>${items}
    <button class="dock-app dock-more" id="dock-more" aria-label="More">${icon('menu', 21)}<span class="dock-tip">More</span></button>`;
  if (dockHtml !== lastDock) {   // rebuilding the dock on every event would kill hover states
    lastDock = dockHtml;
    $('#dock').innerHTML = dockHtml;
    $('#dock-ask').onclick = () => openSpot();
    $('#dock-more').onclick = openMore;
  }
  const mod = mods.find(m => m.id === moduleOf(state.route));
  $('#crumb').innerHTML = mod && state.route !== 'home' ? `<span class="slash">/</span>${esc(mod.name)}${state.route === 'project' ? '<span class="slash">/</span>' + esc(state.params[0] || '') : ''}` : '';
  if (state.boot.config.setup?.done === false && state.route !== 'setup') $('#crumb').innerHTML += `<a class="setup-link" href="#/setup">Finish set-up</a>`;
  const up = state.boot.update;   // a newer Jade on GitHub (server/core/updates.js): the link opens Settings, where Update now is
  if (up?.state === 'behind' && up.check !== false && !(state.route === 'settings' && state.params[0] === 'updates')) $('#crumb').innerHTML += `<a class="setup-link" href="#/settings/updates" title="${up.behind} new change${up.behind === 1 ? '' : 's'} on GitHub">Update available</a>`;
  $('#mb-agents').innerHTML = running ? `<span class="pulse-dot"></span>${running} working` : `${icon('cpu', 14)}<span class="hide-sm">idle</span>`;
  $('#mb-agents').classList.toggle('live', running > 0);
  document.querySelectorAll('.orb, .gem').forEach(o => o.classList.toggle('working', running > 0 && !o.classList.contains('listening')));
  updateMood();
}

function openMore() {
  const items = navMods().filter(m => m.enabled);
  ui.modal({ title: 'Everything', body: `<div class="grid g3 more-grid">${items.map(m => `<a class="more-app" href="#/${m.nav[0].route}" data-go>${icon(m.icon, 22)}<b>${esc(m.nav[0].label || m.name)}</b></a>`).join('')}</div>`,
    onMount: (w, close) => w.querySelectorAll('[data-go]').forEach(a => a.addEventListener('click', () => close())) });
}

// ------------------------------------------------------------------ spotlight
const SUGGEST = ['What needs my attention today?', 'Which of my projects has the most open actions?', 'Add an action to chase the vendor on Friday', 'What changed on my projects since yesterday?'];
let spotCore = null;
export function openSpot(prefill = '') {
  const s = $('#spot');
  s.hidden = false;
  wake();
  spotCore ||= face.mount($('#spot-core'), { size: 104, caption: false, interactive: false });
  requestAnimationFrame(() => s.classList.add('open'));
  $('#spot-hints').innerHTML = SUGGEST.map(t => `<button type="button" class="chip" data-hint="${esc(t)}">${esc(t)}</button>`).join('');
  $('#spot-hints').querySelectorAll('[data-hint]').forEach(b => b.onclick = () => { closeSpot(); sendChat(b.dataset.hint); });
  const i = $('#cmd-input');
  i.value = prefill;
  // One box to jump anywhere, (Ctrl+K): as you type, it lists the pages to go to, things to do, your
  // projects and past chats, files by name and documents by what they say, grouped and filtered by every word typed.
  // Up and down move through the list, Enter opens the highlighted one, and the last row is always "Ask Jade".
  const box = $('#spot-files');
  box.innerHTML = '';
  let rows = [], at = 0, ft = null, seq = 0;
  const words = q => q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (q, s) => words(q).every(w => String(s).toLowerCase().includes(w));
  const paint = () => {
    let last = '';
    box.innerHTML = rows.length ? rows.map((r, n) => {
      const head = r.group !== last ? `<div class="spot-group">${esc(r.group)}</div>` : '';
      last = r.group;
      return `${head}<div class="spot-hit ${n === at ? 'on' : ''}" data-row="${n}" role="option" aria-selected="${n === at}">${icon(r.icon || 'doc', 15)}<span class="grow" style="min-width:0"><span class="t">${esc(r.label)}</span>${r.sub ? `<span class="s">${esc(r.sub)}</span>` : ''}</span>${r.tag ? `<span class="tiny muted">${esc(r.tag)}</span>` : ''}</div>`;
    }).join('') + '<div class="spot-foot"><span>↑↓ move</span><span>Enter open</span><span>Esc close</span></div>' : '';
    box.querySelectorAll('[data-row]').forEach(el => {
      el.onmousemove = () => { if (at === +el.dataset.row) return; at = +el.dataset.row; box.querySelectorAll('.spot-hit').forEach(x => x.classList.toggle('on', x === el)); };
      el.onclick = () => run(rows[+el.dataset.row]);
    });
    box.querySelector('.spot-hit.on')?.scrollIntoView({ block: 'nearest' });
  };
  const run = r => {
    if (!r) return;
    closeSpot();
    if (r.ask) return sendChat(r.ask);
    if (r.file) return ui.previewFile(api, r.file, r.label);
    if (r.go) return go(r.go);
    r.do?.();
  };
  // The quick part, from what is already loaded: pages, actions, projects and recent chats.
  const local = q => {
    const out = [];
    for (const m of state.boot.modules.filter(m => m.enabled && m.id !== 'voice'))
      if (hit(q, `${m.name} ${m.id} ${m.desc || ''} open go`)) out.push({ group: 'Go to', icon: m.icon, label: m.name, go: m.nav?.[0]?.route || m.id });
    const DO = [
      ['New chat', 'chat', 'chat/new'], ['New project', 'plus', 'projects?new'], ['New note', 'pen', 'notes'],
      ['Home', 'home', 'home'], ['Agent activity', 'cpu', 'agents'], ['Settings', 'gear', 'settings'],
    ];
    for (const [label, ic, route] of DO) if (hit(q, label)) out.push({ group: 'Do', icon: ic, label, go: route });
    for (const p of spotCache.projects.filter(p => !p.archived && hit(q, `${p.name} ${p.description || ''}`)).slice(0, 5))
      out.push({ group: 'Projects', icon: 'grid', label: p.name, sub: p.description ? p.description.slice(0, 80) : '', go: `project/${p.id}` });
    for (const t of spotCache.chats.filter(t => hit(q, `${t.title} ${t.preview || ''}`)).slice(0, 5))
      out.push({ group: 'Chats', icon: 'chat', label: t.title || 'Chat', sub: t.preview, go: `chat/${t.id}` });
    return out;
  };
  const askRow = q => ({ group: 'Ask', icon: 'spark', label: `Ask Jade: "${q}"`, ask: q });
  // The list is drawn once per pause in typing, with everything in it. Drawing the quick part first and the files and documents
  // a moment later made the box shrink and grow on every key, which moved everything under it.
  let lastFound = [];
  i.oninput = () => {
    clearTimeout(ft);
    const q = i.value.trim(), mine = ++seq;
    $('#spot-hints').hidden = !!q; // the suggestion chips make way for the results while typing
    if (!q) { rows = []; lastFound = []; at = 0; paint(); return; }
    // From the second word on, the previous results stay up (still filtered by what is typed) until the new ones arrive.
    if (!rows.length || q.length < 2) { at = 0; rows = [...local(q), askRow(q)]; paint(); }
    if (q.length < 2) return;
    // The slower part from the server: documents by content, files by name and chats.
    ft = setTimeout(async () => {
      const found = await api('GET', `/api/search?q=${encodeURIComponent(q)}&limit=12`).catch(() => lastFound);
      if (mine !== seq) return;
      lastFound = found;
      rows = [...local(q), askRow(q)];
      const chatIds = new Set(rows.filter(r => r.group === 'Chats').map(r => r.go));
      const more = [];
      for (const h of found) {
        if (h.kind === 'chat') { const route = h.path.replace(/^#\//, ''); if (!chatIds.has(route)) more.push({ group: 'Chats', icon: 'chat', label: h.title, sub: h.snippet, go: route }); continue; }
        if (String(h.path).startsWith('#')) { more.push({ group: 'Documents', icon: 'doc', label: h.title, sub: h.snippet, go: h.path.replace(/^#\//, '') }); continue; }
        more.push({ group: h.source === 'name' ? 'Files' : 'Documents', icon: h.source === 'name' ? 'folder' : 'doc', label: h.title, sub: h.snippet || h.path, tag: h.project, file: h.path });
      }
      const order = ['Go to', 'Do', 'Projects', 'Chats', 'Files', 'Documents', 'Ask'];
      rows = [...rows.filter(r => r.group !== 'Ask'), ...more, askRow(q)].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
      at = 0;
      paint();
    }, 180);
  };
  i.onkeydown = e => {
    if (!rows.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(rows.length - 1, at + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); paint(); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); run(rows[at]); i.value = ''; }
  };
  // projects and chats are fetched once per open, so filtering them as you type is instant
  Promise.all([api('GET', '/api/projects').catch(() => []), api('GET', '/api/chats').catch(() => [])]).then(([projects, chats]) => {
    spotCache = { projects, chats };
    if (i.value.trim()) i.oninput();
  });
  if (prefill) i.oninput();
  setTimeout(() => i.focus(), 30);
}
let spotCache = { projects: [], chats: [] };
export function closeSpot() {
  const s = $('#spot');
  s.classList.remove('open');
  setTimeout(() => { s.hidden = true; }, 180);
}

function tickClock() {
  const d = new Date();
  $('#mb-clock').textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '  ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function paintVoice() {
  const st = voice.status();
  const b = $('#mb-voice');
  b.hidden = !enabled('voice');
  b.title = st.mode === 'off' ? 'Turn on the wake word' : 'Turn off the wake word';
  b.innerHTML = st.mode === 'wake' || st.mode === 'command' ? `<span class="pulse-dot"></span><span class="hide-sm">“${esc(state.boot.config.wakeWord)}”</span>`
    : st.micDenied ? `${icon('alert', 14)}<span class="hide-sm">mic blocked · click to allow</span>`
    : state.boot.config.voice?.wake && st.error ? `${icon('alert', 14)}<span class="hide-sm">voice problem</span>`
    : state.boot.config.voice?.wake ? `<span class="spin" style="display:grid">${icon('refresh', 13)}</span><span class="hide-sm">starting voice…</span>`
    : `${icon('mic', 14)}<span class="hide-sm">voice off</span>`;
  b.classList.toggle('live', st.mode === 'wake' || st.mode === 'command');
}

export function go(route) { location.hash = '#/' + route.replace(/^#?\/?/, ''); }

// ------------------------------------------------------------------ views (hot-reloadable)
const versions = {};
let current = { name: null, mod: null, dirty: false };
const viewRoot = () => $('#view .view-inner');

// A route's view: the file its module names under `views`, else <route>.js. A user module's file is served from the server
// (/modules/<id>/views/); a built-in one is in public/js/views.
function viewFor(route) {
  const m = state.boot?.modules.find(x => x.id === moduleOf(route));
  const file = (m?.views?.[route] || route + '.js').replace(/\.js$/, '');
  return { name: file, url: m?.source === 'user' ? `/modules/${encodeURIComponent(m.id)}/views/${file}.js?v=${versions[file] || 0}` : `./views/${file}.js?v=${versions[file] || 0}` };
}
async function loadView(v) { return import(v.url); }

// One render at a time. A navigation or a data event that arrives mid-render queues one more pass, so the page on screen
// is always the latest route, never a slower render landing on top of a newer one.
let inFlight = null, again = false, progressT = null;
export function render() {
  if (inFlight) { again = true; return inFlight; }
  inFlight = (async () => {
    do { again = false; await renderOnce(); } while (again);
  })().catch(e => console.error(e)).finally(() => { inFlight = null; });
  return inFlight;
}
const progress = on => { const bar = $('#nav-progress'); if (!bar) return; clearTimeout(progressT); if (on) progressT = setTimeout(() => bar.classList.add('on'), 150); else bar.classList.remove('on'); };
async function renderOnce() {
  progress(true);
  try { await renderRoute(); } finally { progress(false); }
}
async function renderRoute() {
  const [pathPart, queryPart] = (location.hash.replace(/^#\/?/, '') || 'home').split('?');
  const [route, ...params] = pathPart.split('/');
  state.query = queryPart !== undefined ? new URLSearchParams(queryPart) : null;
  const vf = viewFor(route), name = vf.name;
  const module = moduleOf(route);
  state.route = route; state.params = params.map(decodeURIComponent);
  if (state.boot && !enabled(module)) {
    if (state.boot.modules.some(m => m.id === module)) { viewRoot().innerHTML = disabledView(module); renderNav(); return; }
    return go('home');
  }
  renderNav();
  let mod;
  try { mod = await loadView(vf); } catch (e) { viewRoot().innerHTML = `<div class="empty-big"><h2>Page not found</h2><p>${esc(e.message)}</p></div>`; return; }
  const sameView = current.name === name && current.params === params.join('/');
  const scroll = $('#view').scrollTop;
  current = { name, mod: mod.default, params: params.join('/'), dirty: false };
  document.title = (state.boot?.config.assistantName || 'Jade') + ' · ' + (mod.default.title || name);
  const root = viewRoot();
  if (!sameView) { root.style.animation = 'none'; void root.offsetWidth; root.style.animation = ''; }
  // A refresh redraws the whole view. While it is being redrawn the page is momentarily empty, so the browser puts it back
  // at the top; with smooth scrolling on, putting it back where it was then glided down again, which looked like the page
  // jumping to the top and scrolling back. The view is pinned at its height while it redraws, and the position is restored
  // instantly.
  const view = $('#view');
  if (sameView) root.style.minHeight = root.offsetHeight + 'px';
  try { await mod.default.render(root, ctx()); }
  catch (e) { root.innerHTML = `<div class="empty-big"><h2>Something broke</h2><p class="mono small">${esc(e.stack || e.message)}</p></div>`; console.error(e); }
  root.style.minHeight = '';
  view.scrollTo({ top: sameView ? scroll : 0, behavior: 'instant' });
}

function disabledView(id) {
  const m = state.boot.modules.find(x => x.id === id);
  return `<div class="empty-big">${icon(m.icon, 42)}<h2>${esc(m.name)} is switched off</h2><p>${esc(m.desc)}</p><a class="btn primary" href="#/modules">Open Modules</a></div>`;
}

// Re-render on data changes, but never while the user is typing in the view.
// Bursts of events (a job's tool calls, several files saved) coalesce into one re-render per kind.
const refreshTimers = new Map();
function refresh(kind) {
  if (!current.mod) return;
  const wants = current.mod.refreshOn || [];
  if (kind && !wants.includes(kind) && !wants.includes('*')) return;
  clearTimeout(refreshTimers.get(kind));
  refreshTimers.set(kind, setTimeout(() => {
    refreshTimers.delete(kind);
    if (busyUser()) { current.dirty = true; return; }
    render();
  }, 300));
}
// Hold re-renders while the user is actually typing (a draft in the box, or a key in the last 1.5 s), while a dialog is
// open, or mid-click (so a click is never swallowed by a redraw). A merely focused, empty box never holds anything up:
// the chat composer is always focused, and the finished reply must still appear.
let pointerDown = false, lastKey = 0;
const busyUser = () => {
  const a = document.activeElement;
  const typing = a && viewRoot().contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && (String(a.value || '').length > 0 || Date.now() - lastKey < 1500);
  return pointerDown || !!document.querySelector('.modal-wrap') || typing;
};
const flushDirty = () => setTimeout(() => { if (current.dirty && !busyUser()) { current.dirty = false; render(); } }, 60);
let pointerT = null;
document.addEventListener('pointerdown', () => { pointerDown = true; clearTimeout(pointerT); pointerT = setTimeout(() => { pointerDown = false; flushDirty(); }, 2000); }, true); // a release outside the window never fires pointerup
document.addEventListener('pointerup', () => { setTimeout(() => { pointerDown = false; flushDirty(); }, 0); }, true);
document.addEventListener('pointercancel', () => { pointerDown = false; flushDirty(); }, true);
window.addEventListener('blur', () => { pointerDown = false; });
document.addEventListener('keydown', () => { lastKey = Date.now(); }, true);
document.addEventListener('focusout', flushDirty);
setInterval(() => { if (current.dirty && !busyUser()) flushDirty(); }, 2500); // a deferred refresh never waits for a click
new MutationObserver(() => { if (!document.querySelector('.modal-wrap')) flushDirty(); }).observe(document.body, { childList: true });

function ctx() {
  return {
    api, apiUpload, state, go, ui, params: state.params, boot: state.boot,
    enabled, workLine, togglePanel, panelPast, panelFiles,
    runAgent: async (agent, input = {}) => {
      const j = await api('POST', `/api/agents/${agent}/run`, { input });
      noteStart(j);
      ui.toast(`${j.title} started · Esc to stop`, 'info', 2400);
      return j;
    },
    openJob: jid => openDrawer('activity', jid),
    ask: text => sendChat(text),
    send: (text, via, thread, choice) => sendChat(text, via, thread, choice),
    face, wake,
    openSpot,
    voice,
  };
}

// ------------------------------------------------------------------ live events
let es = null, lastPid = null;
function connect() {
  es = new EventSource('/api/events');
  es.onmessage = async e => {
    const ev = JSON.parse(e.data);
    const p = ev.payload;
    switch (ev.type) {
      case 'hello':
        if (lastPid && lastPid !== p.pid) {
          // The server restarted: reload everything, including the job list (runs in flight were interrupted).
          await boot();
          state.jobs = await api('GET', '/api/jobs');
          renderNav(); renderDrawer();
          ui.toast('Jade updated', 'success', 1800);
        }
        lastPid = p.pid; break;
      case 'theme': state.boot.theme = p; applyTheme(p); break;
      case 'update': if (state.boot) { state.boot.update = p; renderNav(); refresh('update'); } break;
      case 'config': await boot(); break;
      case 'engines': if (state.boot) { state.boot.engines = p; paintEngine(); refresh('engines'); } break;
      case 'models': if (state.boot) { state.boot.models = await api('GET', '/api/models').catch(() => state.boot.models); refresh('engines'); } break;
      case 'asset': onAsset(p.file); break;
      case 'job': onJob(p); break;
      case 'job:text': streamer.text(p); break;
      case 'permission': onPermission(p); break;
      case 'data':
        if (['actions', 'skills'].includes(p.kind)) loadCounts();
        refresh(p.kind); break;
      case 'skills': loadCounts(); refresh('skills'); break;
      case 'agents': state.boot.agents = (await api('GET', '/api/boot')).agents; refresh('agents'); break;
      case 'memory': refresh('memory'); break;
      case 'schedule': refresh('schedule'); break;
      case 'toast': ui.toast(p.text, p.kind); break;
    }
  };
  es.onerror = () => { es.close(); setTimeout(connect, 1500); };
}

function onAsset(file) {
  if (file.endsWith('.css')) {
    const link = $('#css-main');
    const next = link.cloneNode();
    next.href = '/css/jade.css?v=' + Date.now();
    next.onload = () => link.remove();
    link.after(next);
    return;
  }
  const m = /^js\/views\/(\w[\w-]*)\.js$/.exec(file);
  if (m) { versions[m[1]] = Date.now(); if (current.name === m[1]) render(); return; }
  if (file.endsWith('.js') || file.endsWith('.html')) location.reload();
}

function onJob(j) {
  const i = state.jobs.findIndex(x => x.id === j.id);
  const prev = i >= 0 ? state.jobs[i] : null;
  if (i >= 0) state.jobs[i] = { ...state.jobs[i], ...j }; else state.jobs.unshift(j);
  // a finished run carries all its text; one still going sends only its length (its words arrive as job:text)
  // and it replaces whatever was streamed, so a missed or doubled piece never stays
  if (['done', 'error', 'cancelled'].includes(j.status)) { streamer.finish(j.id, j.output); streamer.prune(); }
  // a quiet scheduled run (one with nothing new) says nothing
  if (prev && prev.status !== j.status && ['done', 'error'].includes(j.status) && j.agent !== 'jade' && !(j.status === 'done' && j.result?.quiet)) {
    ui.toast(j.status === 'done' ? `${j.title} finished` : `${j.title}: ${j.error}`, j.status === 'done' ? 'success' : 'error', j.status === 'error' ? 7000 : 3200);
  }
  if (prev && prev.status !== j.status && j.status === 'done' && j.result?.navigate && j.agent !== 'jade' && j.trigger === 'manual') {
    ui.toast(`${j.result.summary || j.title} · click to open`, 'success', 12000, () => go(j.result.navigate));
  }
  if (prev && prev.status !== j.status) {
    if (j.status === 'done') flashMood('happy', 2200, j.agent === 'jade' ? 'Done' : `Finished ${j.title}`);
    else if (j.status === 'error') flashMood('concerned', 3800, `Ran into a problem with ${j.title}`);
  }
  if (j.agent === 'jade') {
    // live tool activity inside the chat bubble that is streaming
    const tl = document.querySelector(`[data-tools="${j.id}"]`);
    if (tl && j.tools?.length) tl.innerHTML = workLine(j);
    const tc = document.querySelector(`[data-touched="${j.id}"]`);
    if (tc) tc.innerHTML = ui.touchedList(j.touched, { live: true });
    panelSync(j);
    if (['done', 'error', 'cancelled'].includes(j.status) && state.pendingChat === j.id) {
      state.pendingChat = null;
      if (j.status === 'error') ui.toast(j.error, 'error', 7000);
      else {
        if (j.result?.navigate) go(j.result.navigate);
        if (state.lastVia === 'voice' && j.result?.reply) voice.speak(ui.plain(j.result.reply));
      }
      voice.setBusy(false);
      refresh('chat-pending');
    }
  }
  // the dock badge counts runs and only a status change moves it; the drawer shows each run's steps, so a new step redraws it
  if (!prev || prev.status !== j.status) renderNav();
  if (!prev || prev.status !== j.status || prev.tools?.length !== j.tools?.length || prev.touched?.length !== j.touched?.length || prev.title !== j.title || prev.error !== j.error) renderDrawer();
  if (!prev || prev.status !== j.status) refresh('jobs');   // pages care about status changes, not every tool call
}


// Esc, anywhere: undo an accidental trigger. In order: stop Jade talking, stop her listening, stop a run started from
// this window in the last 20 seconds, then the chat reply that is still streaming.
const recentStarts = [];   // { id, title, at }
function noteStart(j) { if (j?.id) recentStarts.push({ id: j.id, title: j.title || 'run', at: Date.now() }); while (recentStarts.length > 10) recentStarts.shift(); }
export async function escapeOut() {
  const v = voice.cancel();
  if (v) { ui.toast(v === 'speaking' ? 'Stopped talking' : 'Never mind: not listening', 'info', 1600); return v; }
  const live = id => state.jobs.find(j => j.id === id && (j.status === 'running' || j.status === 'queued'));
  const recent = [...recentStarts].reverse().find(r => Date.now() - r.at < 20000 && live(r.id));
  const target = recent || (state.pendingChat && live(state.pendingChat) ? { id: state.pendingChat, title: 'the reply' } : null);
  if (!target) return '';
  try { await api('POST', `/api/jobs/${target.id}/cancel`); ui.toast(`Stopped ${target.title}`, 'info', 2000); } catch {}
  return 'job:' + target.id;
}

// What Jade is doing after (or before) the words: which file it is reading, how many so far, how long this is taking.
// Reading files is where a reply spends its time once the text has appeared, so it is said plainly rather than hidden.
const TOOL_VERB = { Read: 'reading', Glob: 'listing', Grep: 'searching', WebSearch: 'searching the web for', WebFetch: 'fetching', Edit: 'editing', Write: 'writing', NotebookEdit: 'editing', Bash: 'running' };

// Jade asks before something irreversible: one dialog per question, in every open window; answering in one closes the rest.
const askOpen = new Map();   // permission id -> close()
function onPermission(p) {
  if (p.resolved) { askOpen.get(p.id)?.(); askOpen.delete(p.id); return; }
  if (askOpen.has(p.id)) return;
  wake();
  // Said in plain words first: what will happen, to which files, whether it can be undone, and what "No" means. The raw request
  // (the command or path, the tool's name) is still there, behind one click, for anyone who wants to check it.
  const x = p.plain || {};
  const raw = p.command ? `<pre class="output" style="white-space:pre-wrap;margin:0">${esc(p.command)}</pre>` : p.path ? `<div class="mono small" style="color:var(--fg-soft)">${esc(p.path)}</div>` : `<div class="mono small">${esc(p.label)}</div>`;
  const levelName = { safe: 'Safe', undoable: 'Can be undone', unknown: 'Not sure it can be undone', final: 'Cannot be undone' }[x.level] || 'Check this one';
  const plain = x.headline ? `
      <div class="ask-head">${esc(x.headline)}</div>
      ${x.own ? `<div class="ask-own">${icon('spark', 13)}<span>Jade says: ${esc(x.own)}</span></div>` : ''}
      ${(x.steps || []).length ? `<div class="ask-label">What will happen</div><ul class="ask-steps">${x.steps.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${(x.files || []).length ? `<div class="ask-label">Which file${x.files.length === 1 ? '' : 's'}</div>${x.files.map(f => `<div class="ask-file">${icon('doc', 13)}<b>${esc(f.name)}</b>${f.where ? `<span>${esc(f.where)}</span>` : ''}</div>`).join('')}` : ''}
      <div class="ask-level ${esc(x.level || 'unknown')}"><b>${esc(levelName)}.</b> ${esc(x.levelText || '')}</div>
      <div class="ask-no"><b>If you say No:</b> ${esc(x.ifNo || 'Jade skips this and carries on.')}</div>`
    : `<p style="margin:0 0 10px;color:var(--fg-bright);font-size:15px">${esc(p.question)}</p>`;
  ui.modal({
    title: 'Jade asks',
    body: `${plain}
      <details class="ask-tech"><summary>Show the technical details</summary>${raw}
        <div class="tiny muted" style="margin-top:8px">${esc(p.question)}${p.jobTitle ? ` · from “${esc(p.jobTitle)}”` : ''} · mode: ${esc(p.mode)} · <a href="#/settings/permissions">change in Settings</a></div></details>`,
    actions: [
      { label: 'No', kind: 'ghost', onClick: async () => { await api('POST', `/api/permissions/${p.id}`, { allow: false }).catch(() => {}); } },
      { label: 'Yes, and don\'t ask again this run', kind: '', onClick: async () => { await api('POST', `/api/permissions/${p.id}`, { allow: true, remember: true }).catch(() => {}); } },
      { label: 'Yes', kind: 'primary', icon: 'check', onClick: async () => { await api('POST', `/api/permissions/${p.id}`, { allow: true }).catch(() => {}); } },
    ],
    onMount: (wrap, close) => { askOpen.set(p.id, close); },
  }).then(() => askOpen.delete(p.id));
}
// Questions that were waiting before this window opened (or reloaded).
async function loadPendingAsks() { try { for (const p of (await api('GET', '/api/permissions')).pending || []) onPermission(p); } catch {} }
export function workLine(j) {
  const t = j.tools?.at(-1);
  const secs = j.startedAt ? Math.round((Date.now() - Date.parse(j.startedAt)) / 1000) : 0;
  if (!t) return j.status === 'queued' ? 'waiting for a free agent slot…' : secs >= 8 ? `thinking… ${secs}s` : '';
  const verb = TOOL_VERB[t.name] || (t.name.startsWith('mcp__') ? 'asking ' + t.name.split('__')[1]?.replace(/^claude_ai_/, '').replace(/_/g, ' ') : t.name);
  const what = String(t.detail || '').replace(/^.*[\\/]/, '');
  return `<span class="spin" style="display:inline-grid">${icon('refresh', 11)}</span> ${esc(verb)} <b>${esc(what)}</b> · ${j.tools.length} ${j.tools.length === 1 ? 'step' : 'steps'} · ${secs}s`;
}
// ------------------------------------------------------------------ the chat's work panel (sub-agents and changed files)
// What the conversation already holds: the files its replies changed (newest first, one row per file) and the latest reply's sub-agents.
function panelPast(thread) {
  const turns = thread?.turns || [];
  const files = ui.latestFiles(turns);
  const agents = [...turns].reverse().find(t => t.agents?.length)?.agents || [];
  state.panelMem = { cid: thread?.id || '', files, agents };
  return { files, agents };
}
const panelFiles = (past, live = []) => ui.mergeFiles(live, past);
function paintPanel(shell) {
  const body = shell?.querySelector('[data-panel-body]');
  if (!body) return;
  // only this conversation's work: another chat's reply that is still running must not show here
  const cid = state.params[0];
  const mine = x => x.agent === 'jade' && x.input?.thread === cid;
  const live = state.jobs.find(x => x.id === state.pendingChat && mine(x)) || state.jobs.find(x => mine(x) && ['running', 'queued'].includes(x.status));
  const agents = live?.agents?.length ? live.agents : null;
  const past = state.panelMem.cid === cid ? state.panelMem : { files: [], agents: [] };
  const html = ui.sidePanel({ agents: agents || past.agents, files: panelFiles(past.files, live?.touched), open: [...state.panel.cards], earlier: !agents });
  shell.querySelector('.sp-toggle')?.classList.toggle('busy', !!agents?.some(a => a.status === 'running'));
  // redraw only when something changed, so a click or the keyboard focus on a card is never swept away by an update
  if (body._html === html) return;
  const top = body.scrollTop, focused = document.activeElement?.closest?.('[data-agent-card]')?.dataset.agentCard;
  body.innerHTML = body._html = html;
  body.scrollTop = top;
  if (focused) body.querySelector(`[data-agent-card="${CSS.escape(focused)}"]`)?.focus();
}
function panelSync(j) {
  const shell = document.querySelector('.chat-shell');
  if (!shell || state.route !== 'chat' || state.params[0] !== j.input?.thread) return;
  // the first time a reply hands work to a sub-agent the panel opens; closing it afterwards stays closed for that reply
  // (on a narrow window it does not: the button pulses instead, since the panel would cover the conversation)
  if (j.agents?.length && !state.panelAuto.has(j.id)) {
    state.panelAuto.add(j.id);
    if (window.innerWidth > 1000) { state.panel.open = true; shell.classList.add('panel-open'); shell.querySelector('.sp-toggle')?.setAttribute('aria-pressed', 'true'); shell.querySelector('.sp-toggle')?.classList.add('on'); }
  }
  paintPanel(shell);
}
function togglePanel() {
  state.panel.open = !state.panel.open;
  const shell = document.querySelector('.chat-shell');
  shell?.classList.toggle('panel-open', state.panel.open);
  shell?.querySelector('.sp-toggle')?.setAttribute('aria-pressed', String(state.panel.open));
  shell?.querySelector('.sp-toggle')?.classList.toggle('on', state.panel.open);
  if (state.panel.open) paintPanel(shell);
}
// Keep the elapsed time ticking while something is running.
setInterval(() => {
  for (const el of document.querySelectorAll('[data-since]')) el.textContent = Math.max(0, Math.round((Date.now() - Number(el.dataset.since)) / 1000)) + 's';
  for (const el of document.querySelectorAll('[data-tools]')) {
    const j = state.jobs.find(x => x.id === el.dataset.tools);
    if (j && (j.status === 'running' || j.status === 'queued')) el.innerHTML = workLine(j);
  }
}, 1000);

async function loadCounts() {
  try {
    const c = await api('GET', '/api/counts');
    state.counts = { actions: c.actions || '' };
    renderNav();
  } catch {}
}

// ------------------------------------------------------------------ activity drawer (agent runs; chat has its own page)
function openDrawer(tab = 'activity', focusJob) {
  state.focusJob = focusJob || null;
  $('#drawer').classList.add('open'); $('#scrim').classList.add('on');
  renderDrawer();
}
function closeDrawer() { $('#drawer').classList.remove('open'); $('#scrim').classList.remove('on'); }

function renderDrawer() {
  if (!$('#drawer').classList.contains('open')) return;
  const body = $('#drawer-body');
  {
    const list = state.jobs.slice(0, 30);
    body.innerHTML = list.length ? list.map(j => {
      const open = state.focusJob === j.id || ((j.status === 'running') && !state.focusJob);
      return `<div class="card" style="padding:14px 16px">
        <div class="row"><span class="status-dot ${esc(j.status)}"></span><b class="grow ellipsis" style="color:var(--fg-soft)">${esc(j.title)}</b>
          ${j.status === 'running' || j.status === 'queued' ? `<button class="btn sm ghost" data-cancel="${esc(j.id)}">${icon('stop', 14)}Stop</button>`
            : (j.status === 'error' || j.status === 'cancelled') && j.agent !== 'jade' ? `<button class="btn sm" data-rerun="${esc(j.id)}" title="Run it again with the same request">${icon('refresh', 14)}Run again</button>` : ''}
          <button class="btn sm ghost icon" data-toggle="${esc(j.id)}" aria-label="Toggle output">${icon('more', 16)}</button></div>
        <div class="tiny muted" style="margin:4px 0 0 18px">${esc(j.agentName)} · ${esc(j.engine)} · ${esc(j.trigger)} · ${ui.ago(j.createdAt)}${j.error ? ` · <span style="color:var(--red)">${esc(j.error)}</span>` : ''}</div>
        ${open ? `<div style="margin-top:10px">${(j.tools || []).slice(-4).map(t => `<div class="tool-line">${icon('spark', 12)}<b>${esc(t.name)}</b> ${esc(t.detail || '')}</div>`).join('')}
          ${ui.touchedList(j.touched, { live: j.status === 'running' })}
          <div class="output" data-stream="${esc(j.id)}">${esc(state.streams.get(j.id) || (j.status === 'queued' ? 'Waiting for a free slot…' : j.status === 'running' ? 'Thinking…' : ''))}</div></div>` : ''}
      </div>`;
    }).join('') : '<div class="empty">No agent runs yet.</div>';
    $('#drawer-foot').innerHTML = `<a class="btn sm ghost" href="#/agents">${icon('cpu', 14)}Open the agent console</a>`;
    body.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => api('POST', `/api/jobs/${b.dataset.cancel}/cancel`));
    body.querySelectorAll('[data-rerun]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { const j = await api('POST', `/api/jobs/${b.dataset.rerun}/rerun`); state.focusJob = j.id; ui.toast(`${j.title} started again`, 'info', 2200); }
      catch (err) { ui.toast(err.message, 'error'); b.disabled = false; }
    });
    body.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      const id = b.dataset.toggle;
      state.focusJob = state.focusJob === id ? '__none' : id;
      if (state.focusJob === id && !state.streams.has(id)) { const full = await api('GET', `/api/jobs/${id}`); state.streams.set(id, full.output || ''); }
      renderDrawer();
    });
  }
}

function paintEngine() {
  const e = state.boot?.engines;
  $('#mb-engine').innerHTML = `<span class="status-dot ${e?.checking ? 'queued' : engineLabel() === 'not set up' ? 'error' : 'done'}"></span><span class="hide-sm">${esc(engineLabel())}${e?.checking ? ' · checking' : ''}</span>`;
}

function engineLabel() {
  const e = state.boot?.engines;
  if (!e) return '…';
  return e.claude.installed ? 'Claude Code' : 'not set up';
}

/**
 * Send a message to Jade. Ask (dock, Ctrl+K, Home) and the wake word start a fresh conversation; the composer on the
 * Chats page continues the one that is open. thread: a conversation id, "new", or "recent". The Chats page opens on it.
 */
export async function sendChat(text, via = 'text', thread, choice = {}) {
  text = String(text || '').trim();
  const images = choice.images || []; // data: URLs pasted into the chat box
  const files = choice.files || [];   // { name, data } for any other attached file
  if (!text && !images.length && !files.length) return;
  state.lastVia = via;
  wake();
  const from = state.route;
  thread ||= 'new';
  try {
    const j = await api('POST', '/api/chat', { message: text, via, route: from, thread, model: choice.model, effort: choice.effort, ...(images.length ? { images } : {}), ...(files.length ? { files } : {}) });
    state.pendingChat = j.id;
    noteStart(j);
    state.pendingThread = j.thread;
    // The live "job started" event can arrive before this response; never list the same job twice.
    if (!state.jobs.some(x => x.id === j.id)) state.jobs.unshift(j);
    voice.setBusy(true);
    if (from === 'chat' && state.params[0] === j.thread) render(); else go('chat/' + j.thread);
  } catch (e) { ui.toast(e.message, 'error'); }
}

// ------------------------------------------------------------------ boot
async function boot() {
  state.boot = await api('GET', '/api/boot');
  applyTheme(state.boot.theme);
  $('#brand-name').textContent = state.boot.config.assistantName || 'Jade';
  paintEngine();
  $('#cmd-input').placeholder = `Ask ${state.boot.config.assistantName || 'Jade'} anything${enabled('voice') ? ` — or say “${cap(state.boot.config.wakeWord)}”` : ''}…`;
  face.setName(state.boot.config.assistantName || 'Jade');
  voice.configure(state.boot.config, enabled('voice'), { onCommand: t => sendChat(t, 'voice'), api,
  });
  paintVoice();
  renderNav();
  render();
}
const cap = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase());

async function start() {
  $('#send-btn').innerHTML = icon('send', 17);
  $('#drawer-close').innerHTML = icon('x');
  $('#mic').innerHTML = icon('mic');
  // Enter is taken by the result list when it shows (openSpot); with nothing typed into it, the send button still asks Jade.
  $('#cmd').addEventListener('submit', e => { e.preventDefault(); const i = $('#cmd-input'); const t = i.value.trim(); if (!t) return; i.value = ''; closeSpot(); sendChat(t); });
  $('#spot').addEventListener('mousedown', e => { if (e.target.id === 'spot') closeSpot(); });
  $('#mb-agents').onclick = () => openDrawer('activity');
  $('#mb-engine').onclick = () => go('settings');
  // The menubar voice item: retry if the mic was blocked, otherwise switch the wake word on and off.
  $('#mb-voice').onclick = async () => {
    if (voice.status().micDenied) { voice.retry(); return; }
    const on = !state.boot.config.voice?.wake;
    await api('POST', '/api/config', { voice: { wake: on } });
    ui.toast(on ? `Listening for “${cap(state.boot.config.wakeWord)}”` : 'Wake word off', on ? 'success' : 'info', 2000);
  };
  $('#drawer-close').onclick = closeDrawer;
  $('#scrim').onclick = closeDrawer;
  $('#mic').onclick = () => { closeSpot(); voice.pushToTalk(); };
  // Every "Ask Jade" button anywhere: a fresh chat about that one thing. Every file row: open it, or show it in its folder.
  document.addEventListener('click', e => {
    const card = e.target.closest('[data-agent-card]');
    if (card) { const id = card.dataset.agentCard; state.panel.cards.has(id) ? state.panel.cards.delete(id) : state.panel.cards.add(id); paintPanel(document.querySelector('.chat-shell')); return; }
    const ask = e.target.closest('[data-ask-jade]');
    if (ask) { e.preventDefault(); e.stopPropagation(); sendChat(ask.dataset.askJade, 'text', 'new'); return; }
    const reveal = e.target.closest('[data-reveal-file]');
    if (reveal) {
      e.preventDefault(); e.stopPropagation();
      ui.toast('Showing it in File Explorer…', 'info', 1800); // so a click that reaches here is visible even if no window appears
      api('POST', '/api/fs/reveal', { path: reveal.dataset.revealFile }).catch(err => ui.toast(`Show in folder failed: ${err.message}`, 'error', 9000));
      return;
    }
    const open = e.target.closest('[data-open-file]');
    if (open) { e.preventDefault(); e.stopPropagation(); api('POST', '/api/fs/open', { path: open.dataset.openFile }).then(() => ui.toast('Opening ' + open.dataset.openFile.split(/[\\/]/).pop(), 'info', 1600)).catch(err => ui.toast(err.message, 'error')); return; }
    const undo = e.target.closest('[data-undo-change]');
    if (undo) {
      e.preventDefault(); e.stopPropagation();
      undo.disabled = true;
      api('POST', `/api/changes/${undo.dataset.undoChange}/restore`)
        .then(() => { undo.textContent = 'Put back'; ui.toast(`${undo.dataset.undoName}: the earlier version is back. The version you had just now is kept too.`, 'success', 5200); })
        .catch(err => { undo.disabled = false; ui.toast(err.message, 'error', 7000); });
      return;
    }
    const prev = e.target.closest('[data-preview-file]');
    const inner = e.target.closest('button');
    if (prev && (!inner || inner === prev)) { e.preventDefault(); e.stopPropagation(); closeSpot(); ui.previewFile(api, prev.dataset.previewFile, prev.dataset.fileName); }
  }, true);
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#spot').hidden ? openSpot() : closeSpot(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); openSpot(); }
    else if (e.key === 'Escape' && !$('#spot').hidden) closeSpot();
    else if (e.key === 'Escape' && $('#drawer').classList.contains('open') && !document.querySelector('.modal-wrap')) closeDrawer();
    else if (e.key === 'Escape' && !document.querySelector('.modal-wrap')) escapeOut();
  });
  tickClock(); setInterval(tickClock, 15000);
  loadPendingAsks();
  window.addEventListener('jade:voice', () => { paintVoice(); updateMood(); });
  window.addEventListener('jade:hear', e => showHud(e.detail.text, e.detail.hint));
  window.addEventListener('jade:hear-end', e => hideHud(e.detail?.delay || 0));
  setInterval(updateMood, 60000);
  setInterval(paintVoice, 1500);
  window.addEventListener('hashchange', () => render());
  try {
    await boot();
    if (state.boot.config.setup?.done === false && /^(#\/?(home)?)?$/.test(location.hash)) go('setup');   // first run, when opened with no page chosen; the person may leave, and "Finish set-up" stays in the menubar
    state.jobs = await api('GET', '/api/jobs');
    renderNav();
    loadCounts();
  } catch (e) {
    viewRoot().innerHTML = `<div class="empty-big"><h2>Can't reach Jade</h2><p>${esc(e.message)}. Start it with <code>npm start</code>.</p></div>`;
  }
  connect();
}

start();
