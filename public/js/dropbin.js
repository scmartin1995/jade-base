// The drop bin: a large drop target for transcripts, plus the one-file-at-a-time upload with progress.
// Browsers never give a dropped file's real path, so the file itself is sent as the raw body of one POST.
import { apiUpload } from './api.js';
import { esc, icon, fmtSize } from './ui.js';

const extOf = n => { const m = /\.[^.\\/]+$/.exec(String(n || '')); return m ? m[0].toLowerCase() : ''; };

// Uploads in flight live here, not in a page, so a page redraw never loses them.
const rows = [];
const lists = new Set();
let rowId = 0;
function paint() {
  for (const el of [...lists]) {
    if (!el.isConnected) { lists.delete(el); continue; }
    el.innerHTML = rows.map(r => `<div class="bin-row" data-upload="${r.id}" data-state="${r.state}">
      <span class="bin-name ellipsis">${esc(r.name)}</span>
      ${r.state === 'sending' ? `<span class="bin-bar" role="progressbar" aria-label="Sending ${esc(r.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r.pct}"><i style="width:${r.pct}%"></i></span><span class="tiny muted">${r.pct}%</span>` : ''}
      <span class="small ${r.state === 'error' ? 'bin-err' : 'dim'}" ${r.state === 'error' ? 'role="alert"' : ''}>${esc(r.text)}</span>
      ${r.meeting ? `<a class="small" href="#/meeting/${esc(r.meeting)}">Open</a>` : ''}
    </div>`).join('');
  }
}
function drop(r, ms) { setTimeout(() => { const i = rows.indexOf(r); if (i >= 0) { rows.splice(i, 1); paint(); } }, ms); }

/** Send one file. Resolves { id, duplicateOf }; rejects with the server's plain-words message. */
export async function uploadTranscript(file, project, onProgress) {
  try { return await apiUpload(`/api/meetings/upload?project=${encodeURIComponent(project)}&name=${encodeURIComponent(file.name)}${file.lastModified ? `&modified=${Math.round(file.lastModified)}` : ''}`, file, onProgress); }
  catch (e) { throw e.said || !e.status ? e : new Error(e.status === 413 ? 'That file is too large.' : e.status === 415 ? 'That kind of file cannot be read.' : 'The file could not be added.'); }
}

/** Upload several files one after another, showing progress in every mounted bin. Returns the meeting ids. */
export async function uploadFiles(files, project) {
  const made = [];
  for (const file of files) {
    const r = { id: ++rowId, name: file.name, pct: 0, state: 'sending', text: fmtSize(file.size), meeting: null };
    rows.push(r); paint();
    try {
      const out = await uploadTranscript(file, project, p => { r.pct = p; paint(); });
      r.meeting = out.duplicateOf || out.id || null;
      if (out.duplicateOf) { r.state = 'duplicate'; r.text = 'Already added, so it was not read again.'; }
      else { r.state = 'done'; r.text = 'Added. Jade is reading it now.'; if (out.id) made.push(out.id); }
      drop(r, 12000);
    } catch (e) { r.state = 'error'; r.text = e.message; drop(r, 30000); }
    paint();
  }
  return made;
}

/**
 * Make `el` a drop bin. accept: ['.vtt', ...]; onFiles(files) gets only the files of an accepted type.
 * ready(): return a plain message if dropping is not allowed yet (for example no project chosen), else nothing.
 * Returns { setHint }.
 */
export function mountBin(el, { accept = [], hint = '', onFiles, ready, compact = false } = {}) {
  const okExt = accept.map(a => a.toLowerCase());
  el.innerHTML = `<div class="bin ${compact ? 'compact' : ''}" data-bin role="button" tabindex="0" aria-label="Drop transcripts here, or press Enter to choose files">
      <span class="bin-ico">${icon('download', compact ? 20 : 30)}</span>
      <div class="bin-text"><strong>Drop transcripts here</strong><span class="small dim" data-bin-hint>${esc(hint)}</span></div>
      <span class="btn sm" aria-hidden="true">Choose files</span>
      <input type="file" multiple hidden ${okExt.length ? `accept="${esc(okExt.join(','))}"` : ''} data-bin-input>
    </div>
    <div class="bin-msg small" data-bin-msg role="status" aria-live="polite"></div>
    <div class="bin-list" data-bin-list></div>`;
  const bin = el.querySelector('[data-bin]'), input = el.querySelector('[data-bin-input]'), msg = el.querySelector('[data-bin-msg]'), list = el.querySelector('[data-bin-list]');
  lists.add(list); paint();
  const say = t => { msg.textContent = t || ''; };
  const take = fl => {
    const files = [...fl || []];
    if (!files.length) return;
    const wait = ready?.();
    if (wait) { say(wait); return; }
    const good = files.filter(f => okExt.includes(extOf(f.name)));
    const bad = files.filter(f => !good.includes(f));
    say(bad.length ? `${bad.map(f => f.name).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a transcript Jade can read. Use ${okExt.join(', ')}.` : '');
    if (good.length) onFiles?.(good);
  };
  bin.addEventListener('click', () => input.click());
  bin.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { take(input.files); input.value = ''; });
  bin.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); bin.classList.add('dropping'); } });
  bin.addEventListener('dragleave', () => bin.classList.remove('dropping'));
  bin.addEventListener('drop', e => { bin.classList.remove('dropping'); if (e.dataTransfer?.files?.length) { e.preventDefault(); take(e.dataTransfer.files); } });
  return { setHint: t => { const h = el.querySelector('[data-bin-hint]'); if (h) h.textContent = t; } };
}

export const TRANSCRIPT_TYPES = ['.vtt', '.srt', '.txt', '.md', '.docx', '.pdf', '.json'];
