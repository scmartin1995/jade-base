// Meetings: drop a transcript, then review what Jade pulled out of it.
import { mountBin, uploadFiles, TRANSCRIPT_TYPES } from '../dropbin.js';

// One table for every status: what to say, which dot, and whether Jade is still working on it.
const STATUS = {
  queued: { text: 'Reading…', dot: 'running', working: true },
  reading: { text: 'Reading…', dot: 'running', working: true },
  extracting: { text: 'Pulling out key points…', dot: 'running', working: true },
  checking: { text: 'Being checked…', dot: 'running', working: true },
  repairing: { text: 'Fixing what the checker found…', dot: 'running', working: true },
  review: { text: 'Ready to review', dot: 'queued' },
  recorded: { text: 'Recorded', dot: 'done' },
  paused: { dot: 'cancelled' },
  failed: { dot: 'error' },
};
export const isWorking = m => !!STATUS[m.status]?.working;

/** The status of a meeting in plain words. */
export function statusText(m) {
  if (m.status === 'paused') {
    const t = m.pausedUntil ? new Date(m.pausedUntil) : null;
    const at = t && !isNaN(t) ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    return at ? `Paused until ${at} because the usage limit was reached` : 'Paused because the usage limit was reached';
  }
  if (m.status === 'failed') return `Could not be read: ${m.error || 'something went wrong'}`;
  return STATUS[m.status]?.text ?? (m.status || '');
}
// a fixed word from the STATUS table above, so it is safe to put in a class without escaping
export const statusDot = m => STATUS[m.status]?.dot || 'queued';
/** Newest first: by meeting date, then by when it was added. Used by the Meetings page and the project panel. */
export const byNewest = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
/** A list that could not be loaded is not an empty list: say so, with the reason. */
export const loadFailed = (esc, what, err) => `<div class="card empty" data-load-failed role="alert"><strong>Could not load ${esc(what)}.</strong> ${esc(err?.message || 'Jade did not answer.')} <button type="button" class="btn sm" data-retry>Try again</button></div>`;
export function countsText(m) {
  const c = m.counts;
  if (!c || m.status === 'failed' || isWorking(m)) return '';
  return `${c.passed} passed · ${c.corrected} corrected · ${c.notChecked} not checked`;
}

/** One row in a meetings list. */
export function meetingRow(m, { ui, projectName = '' }) {
  const { esc } = ui;
  const c = countsText(m);
  return `<a class="item link mtg-row" href="#/meeting/${esc(m.id)}" data-meeting="${esc(m.id)}" data-status="${esc(m.status)}" style="text-decoration:none">
    <span class="status-dot ${statusDot(m)}" style="margin-top:7px"></span>
    <div class="main-col"><div class="title">${esc(m.title || m.source?.name || 'Meeting')}</div>
      <div class="meta"><span>${esc(m.date ? ui.fmtDate(m.date, { year: 'numeric', month: 'short', day: 'numeric' }) : '')}</span>${projectName ? `<span>${esc(projectName)}</span>` : ''}${c ? `<span>${esc(c)}</span>` : ''}</div>
      <div class="small ${m.status === 'failed' ? 'bin-err' : 'dim'}" data-status-text>${esc(statusText(m))}</div></div>
    <span class="btn sm ghost" aria-hidden="true">Open</span>
  </a>`;
}

const KEY = 'jade.meetings.project';
export default {
  title: 'Meetings',
  refreshOn: ['meetings', 'projects'],
  async render(root, ctx) {
    const { api, ui } = ctx;
    const { esc, icon } = ui;
    let projects, meetings;
    try { [projects, meetings] = await Promise.all([api('GET', '/api/projects'), api('GET', '/api/meetings')]); }
    catch (err) {   // a server error is not "no projects" and "no meetings": the page says it could not load, and the drop area is not offered
      root.innerHTML = `<div class="page-head"><div><div class="eyebrow">Meetings</div><h1>Meetings</h1></div></div>${loadFailed(esc, 'your meetings', err)}`;
      root.querySelector('[data-retry]').onclick = () => this.render(root, ctx);
      console.error('Meetings page: could not load', err);
      return;
    }
    const live = projects.filter(p => !p.archived);
    let project = localStorage.getItem(KEY) || '';
    if (!live.some(p => p.id === project)) project = live.length === 1 ? live[0].id : '';
    const name = id => projects.find(p => p.id === id)?.name || id;
    const list = [...meetings].sort(byNewest);

    root.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Meetings</div><h1>Meetings</h1>
        <p>Drop in a meeting transcript. Jade reads it, pulls out the key points, action items and risks, and has each one checked against what was actually said. You decide what to keep.</p></div></div>
      <section class="card" style="margin-bottom:16px" data-intake>
        <label class="field" style="display:grid;gap:6px;max-width:420px;margin-bottom:14px"><span class="small dim">Which project is this meeting for?</span>
          <select data-project aria-label="Project for the dropped meetings">${ui.projectOptions(live, project, 'Choose a project first')}</select></label>
        <div data-bin-host></div>
      </section>
      ${list.length ? `<section class="card"><div class="card-head"><h2>${icon('mic')}All meetings</h2><span class="chip">${list.length}</span></div>
          <div class="list" data-list>${list.map(m => meetingRow(m, { ui, projectName: name(m.project) })).join('')}</div></section>`
        : `<div class="card empty-big" data-empty>${icon('mic', 40)}<h2>No meetings yet</h2>
          <p>Drop a transcript above: a Teams or Zoom caption file, or a text or Word file of what was said. Jade will read it, pull out the key points, action items and risks, and check each one against the transcript. Then you keep what is right and Jade writes the meeting record into your project folder.</p></div>`}`;

    const sel = root.querySelector('[data-project]');
    sel.onchange = () => { project = sel.value; localStorage.setItem(KEY, project); };
    mountBin(root.querySelector('[data-bin-host]'), {
      accept: TRANSCRIPT_TYPES,
      hint: 'Caption files (.vtt, .srt), text, Word, PDF or .json. Several at once is fine.',
      ready: () => project ? '' : 'Choose a project first, so the meeting is filed in the right place.',
      onFiles: async files => {
        const ids = await uploadFiles(files, project);
        if (ids.length === 1 && files.length === 1) ctx.go('meeting/' + ids[0]);
      },
    });
  },
};
