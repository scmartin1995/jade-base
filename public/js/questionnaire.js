// A step-by-step questionnaire: one question at a time with Back / Next, a progress line and a final review.
// Questions are plain data (so they can live in a JSON file):
//   { id, type, label, help, options, required }
//   type: choice (radio cards) | multi (checkboxes, optional `other: true` for a "something else" box) | text | longtext |
//         folder (the folder picker) | files (tick files from `options`) | custom ({ render, validate }: see below)
//   options: [{ value, label, help }] (a plain string means value = label).
//   custom: render(box, { value, set(v), answers, next(), refresh(), api }) draws the step (it may return a clean-up function);
//           validate(value, answers) returns '' when fine, else a plain-words message (may be async).
//           review(value, answers) -> text for the review.
// Answers are collected as { id: value } and pre-filled from `answers`. `api` (the app's api helper) is required.
import * as ui from './ui.js';

const { esc, icon } = ui;

const opt = o => (typeof o === 'string' ? { value: o, label: o, help: '' } : { value: o.value, label: o.label ?? String(o.value), help: o.help || '' });
const empty = v => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/** Radio cards. Used by choice questions and by custom steps that load their own options. */
export function choiceCards(box, options, value, set) {
  box.innerHTML = `<div class="qn-options">${options.map(o0 => { const o = opt(o0); return `<label class="mod-row choice ${o.value === value ? '' : 'off'}" data-v="${esc(o.value)}">
    <input type="radio" name="qn-choice" value="${esc(o.value)}" ${o.value === value ? 'checked' : ''}><div class="grow"><div class="title" style="font-weight:500;color:var(--fg-bright)">${esc(o.label)}</div>${o.help ? `<div class="tiny muted">${esc(o.help)}</div>` : ''}</div></label>`; }).join('')}</div>`;
  box.querySelectorAll('input[name="qn-choice"]').forEach(r => r.onchange = () => {
    set(r.value);
    box.querySelectorAll('.choice').forEach(x => x.classList.toggle('off', x.dataset.v !== r.value));
  });
}

const RENDER = {
  choice(box, q, o) { choiceCards(box, o.options, o.value, o.set); },
  multi(box, q, o) {
    const known = new Set(o.options.map(x => opt(x).value));
    const cur = Array.isArray(o.value) ? o.value : [];
    const other = cur.filter(v => !known.has(v)).join(', ');
    box.innerHTML = `<div class="qn-options">${o.options.map(x0 => { const x = opt(x0); return `<label class="mod-row choice ${cur.includes(x.value) ? '' : 'off'}" data-v="${esc(x.value)}">
      <input type="checkbox" value="${esc(x.value)}" ${cur.includes(x.value) ? 'checked' : ''}><div class="grow"><div class="title" style="font-weight:500;color:var(--fg-bright)">${esc(x.label)}</div>${x.help ? `<div class="tiny muted">${esc(x.help)}</div>` : ''}</div></label>`; }).join('')}</div>
      ${q.other ? `<label class="field" style="margin-top:12px">Something else <small>separate more than one with commas</small><input type="text" data-other value="${esc(other)}"></label>` : ''}`;
    const collect = () => {
      const ticked = [...box.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
      const extra = q.other ? (box.querySelector('[data-other]').value || '').split(',').map(s => s.trim()).filter(Boolean) : [];
      o.set([...ticked, ...extra]);
    };
    box.querySelectorAll('input[type=checkbox]').forEach(i => i.onchange = () => { i.closest('.choice').classList.toggle('off', !i.checked); collect(); });
    box.querySelector('[data-other]')?.addEventListener('input', collect);
  },
  files(box, q, o) {
    const cur = Array.isArray(o.value) ? o.value : [];
    box.innerHTML = o.options.length ? `<div class="qn-files">${o.options.map(x0 => { const x = opt(x0); return `<label class="item row qn-file"><input type="checkbox" value="${esc(x.value)}" ${cur.includes(x.value) ? 'checked' : ''}>
      <div class="main-col"><div class="title">${esc(x.label)}</div>${x.help ? `<div class="meta">${esc(x.help)}</div>` : ''}</div></label>`; }).join('')}</div>`
      : `<div class="tiny muted">${esc(q.emptyText || 'There are no files to pick from.')}</div>`;
    box.querySelectorAll('input[type=checkbox]').forEach(i => i.onchange = () => o.set([...box.querySelectorAll('input[type=checkbox]:checked')].map(x => x.value)));
  },
  text(box, q, o) {
    box.innerHTML = `<input type="text" class="qn-input" value="${esc(o.value || '')}" placeholder="${esc(q.placeholder || '')}" autocomplete="off">`;
    const i = box.querySelector('input'); i.oninput = () => o.set(i.value);
    i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); o.next(); } };
    setTimeout(() => i.focus(), 0);
  },
  longtext(box, q, o) {
    box.innerHTML = `<textarea class="qn-input" rows="6" placeholder="${esc(q.placeholder || '')}">${esc(o.value || '')}</textarea>`;
    const i = box.querySelector('textarea'); i.oninput = () => o.set(i.value);
    setTimeout(() => i.focus(), 0);
  },
  folder(box, q, o) {
    const paint = () => {
      box.innerHTML = `<div class="folder-row">${icon('folder', 17)}<div class="grow" style="min-width:0"><div class="mono small ellipsis" style="color:var(--fg-soft)">${esc(o.value || 'No folder chosen yet')}</div></div>
        <button type="button" class="btn sm" data-pick>${icon('folder', 13)}${o.value ? 'Choose a different folder' : 'Choose a folder'}</button>${o.value && !q.required ? `<button type="button" class="btn sm ghost" data-clear>Clear</button>` : ''}</div>`;
      box.querySelector('[data-pick]').onclick = async () => {
        const f = await ui.chooseFolder(o.api, { title: q.label });
        if (f) { o.set(f); o.value = f; paint(); }
      };
      box.querySelector('[data-clear]')?.addEventListener('click', () => { o.set(''); o.value = ''; paint(); });
    };
    paint();
  },
};

/** A short, plain reading of an answer for the review step. */
function reading(q, v, answers) {
  if (q.type === 'custom' && q.review) return q.review(v, answers);
  if (empty(v)) return 'Skipped';
  if (q.type === 'choice') { const o = (Array.isArray(q.options) ? q.options : []).map(opt).find(x => x.value === v); return o ? o.label : String(v); }
  if (q.type === 'multi' || q.type === 'files') { const os = (Array.isArray(q.options) ? q.options : []).map(opt); return v.map(x => os.find(o => o.value === x)?.label || x).join(', '); }
  if (q.type === 'custom') return typeof v === 'string' ? v : 'Done';
  return String(v);
}

export function runQuestionnaire(root, { title = '', intro = '', questions = [], answers = {}, onDone = () => {}, onCancel, api, doneLabel = 'Finish' } = {}) {
  const data = { ...answers };
  let at = 0, cleanup = null, busy = false;
  const result = () => Object.fromEntries(questions.filter(q => data[q.id] !== undefined).map(q => [q.id, data[q.id]]));

  async function draw() {
    cleanup?.(); cleanup = null;
    const qs = questions;
    at = Math.max(0, Math.min(at, qs.length));
    const q = qs[at], review = at === qs.length;
    const total = qs.length + 1;
    root.innerHTML = `<section class="card qn">
      <div class="qn-top"><div class="tiny muted mono">${review ? 'Last step' : `Step ${at + 1} of ${total}`}</div>${title ? `<div class="tiny muted">${esc(title)}</div>` : ''}</div>
      <div class="qn-bar" aria-hidden="true"><span style="width:${Math.round(((at + 1) / total) * 100)}%"></span></div>
      ${at === 0 && intro ? `<p class="small dim qn-intro">${esc(intro)}</p>` : ''}
      <h2 class="qn-label">${esc(review ? 'Check your answers' : q.label)}</h2>
      ${!review && q.help ? `<p class="small dim qn-help">${esc(q.help)}</p>` : ''}
      <div class="qn-body" data-body></div>
      <div class="qn-error small" data-error role="alert" hidden></div>
      <div class="row qn-nav" style="gap:8px">
        ${at > 0 ? `<button type="button" class="btn ghost" data-back>${icon('arrow_left', 14)}Back</button>` : (onCancel ? '<button type="button" class="btn ghost" data-cancel>Not now</button>' : '')}
        <span class="grow"></span>
        ${review ? `<button type="button" class="btn primary" data-next>${icon('check', 14)}${esc(doneLabel)}</button>` : `<button type="button" class="btn primary" data-next>${at === qs.length - 1 ? 'Review' : 'Next'}</button>`}
      </div></section>`;
    const $ = s => root.querySelector(s);
    const err = m => { const e = $('[data-error]'); e.hidden = !m; e.textContent = m || ''; };
    const body = $('[data-body]');
    const next = async () => {
      if (busy) return;
      busy = true; err('');
      try {
        if (review) {
          const out = result();
          await onDone(out);
          return;
        }
        const v = data[q.id];
        let m = '';
        if (q.required && empty(v)) m = q.requiredText || 'Please answer this one to go on.';
        else if (q.validate) m = (await q.validate(v, data)) || '';
        if (m) return err(m);
        at++;
        await draw();
      } catch (e) { err(e.message); }
      finally { busy = false; }
    };
    const set = v => { data[q.id] = v; err(''); };
    $('[data-back]')?.addEventListener('click', () => { at--; draw(); });
    $('[data-cancel]')?.addEventListener('click', () => onCancel());
    $('[data-next]')?.addEventListener('click', next);
    if (review) {
      body.innerHTML = `<div class="list">${qs.map((x, i) => `<div class="item row qn-review" style="padding:8px 0"><div class="main-col"><div class="tiny muted">${esc(x.label)}</div><div class="title" style="white-space:pre-wrap">${esc(reading(x, data[x.id], data))}</div></div>
        <button type="button" class="btn sm ghost" data-edit="${i}">Change</button></div>`).join('')}</div>`;
      body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { at = Number(b.dataset.edit); draw(); });
      return;
    }
    const o = { value: data[q.id], set(v) { set(v); o.value = v; }, next, api, answers: data };
    if (q.type === 'custom') {
      const c = q.render(body, { value: data[q.id], set, answers: data, next, refresh: draw, api, ui });
      cleanup = typeof c === 'function' ? c : null;
      if (c && typeof c.then === 'function') c.then(fn => { if (typeof fn === 'function') cleanup = fn; });
      return;
    }
    o.options = q.options || [];
    (RENDER[q.type] || RENDER.text)(body, q, o);
  }

  draw();
}
