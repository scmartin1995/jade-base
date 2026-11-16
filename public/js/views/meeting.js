// One meeting: the review of what was pulled out of a transcript, item by item, before the record is written.
import { isWorking, statusText } from './meetings.js';

const STEP_NAMES = { read: 'Read the transcript', extract: 'Pull out the key points', check: 'Check them against the transcript', agent: 'Have the checker review them', repair: 'Fix what was wrong' };
const passed = i => i.codeCheck?.ok !== false && i.verdict === 'supported';
const failed = i => i.codeCheck?.ok === false || i.verdict === 'wrong' || i.verdict === 'not-asked';
const label = i => {
  if (i.codeCheck?.ok === false) return { t: i.note && /too short/.test(i.note) ? 'Quote too short to check' : 'Quote not found in the transcript', k: 'bad' };
  if (i.addedByPM) return { t: 'Added by you', k: 'ok' };
  if (i.verdict === 'supported') return { t: 'Checked', k: 'ok' };
  if (i.verdict === 'wrong') return { t: `Checker disagrees${i.note ? ': ' + i.note : ''}`, k: 'bad' };
  if (i.verdict === 'not-asked') return { t: `Not what was asked${i.note ? ': ' + i.note : ''}`, k: 'bad' };
  return { t: 'Could not be checked', k: 'warn' };
};
const words = k => { const s = String(k).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); return s[0].toUpperCase() + s.slice(1); };

export default {
  title: 'Meeting',
  refreshOn: ['meetings'],
  async render(root, ctx) {
    const { api, ui, go, params } = ctx;
    const { esc, icon } = ui;
    const id = params[0];
    let m;
    try { m = await api('GET', `/api/meetings/${encodeURIComponent(id)}`); }
    catch { root.innerHTML = `<div class="empty-big"><h2>That meeting is not there any more</h2><a class="btn" href="#/meetings">Back to meetings</a></div>`; return; }
    const back = `<a href="#/meetings" class="small dim row" style="gap:6px;margin-bottom:8px;width:max-content">${icon('arrow_left', 14)}Meetings</a>`;
    const patch = body => api('PATCH', `/api/meetings/${encodeURIComponent(id)}`, body).catch(e => ui.toast(e.message, 'error'));
    const rerun = async () => {
      if (m.status === 'recorded' && !await ui.confirmBox('Run again?', 'Jade will read the transcript again and your choices will be cleared. The record already written is kept until you write it again.', 'Run again')) return;
      try { await api('POST', `/api/meetings/${encodeURIComponent(id)}/rerun`); } catch (e) { ui.toast(e.message, 'error'); }
    };
    const del = async () => {
      if (!await ui.confirmBox('Delete this meeting?', (m.status === 'failed' ? 'This removes the review from Jade, and the copy of the transcript Jade made in the project. The file you dropped is not touched.' : 'This removes the review from Jade. The transcript file and any meeting record already written are kept.'), 'Delete', 'danger')) return;
      try { await api('DELETE', `/api/meetings/${encodeURIComponent(id)}`); go('meetings'); } catch (e) { ui.toast(e.message, 'error'); }
    };
    const head = `<div class="page-head" data-meeting-head><div class="grow">${back}<div class="eyebrow">Meeting</div>
        ${isWorking(m) || m.status === 'failed' || m.status === 'paused' ? `<h1>${esc(m.title || m.source?.name || 'Meeting')}</h1>` : `<input class="mtg-title" data-title value="${esc(m.title)}" aria-label="Meeting title">`}
        <div class="mtg-meta"${isWorking(m) ? ' hidden' : ''}>
          <label class="field"><span class="tiny muted">Date</span><input type="date" data-date value="${esc(m.date || '')}"></label>
          <label class="field grow"><span class="tiny muted">Who was there (separate with commas)</span><input data-attendees value="${esc((m.attendees || []).join(', '))}"></label>
        </div>
        <p class="tiny muted mono ellipsis" style="margin-top:10px">${esc(m.source?.name || '')}</p></div></div>`;
    const wire = () => {
      root.querySelector('[data-title]')?.addEventListener('change', e => patch({ title: e.target.value }));
      root.querySelector('[data-date]')?.addEventListener('change', e => { if (e.target.value) patch({ date: e.target.value }); else e.target.value = m.date || ''; });   // a meeting always has a date: clearing the box puts the old one back
      root.querySelector('[data-attendees]')?.addEventListener('change', e => patch({ attendees: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }));
      root.querySelector('[data-rerun]')?.addEventListener('click', rerun);
      root.querySelector('[data-delete]')?.addEventListener('click', del);
    };

    // a run in progress, paused or failed: say where it is, no review yet
    if (isWorking(m) || m.status === 'paused' || m.status === 'failed') {
      const steps = m.steps || [];
      root.innerHTML = `${head}<section class="card" data-progress data-status="${esc(m.status)}">
        <div class="row" style="gap:12px;margin-bottom:12px">${isWorking(m) ? `<span class="spin" style="display:grid;color:var(--cyan)">${icon('refresh', 18)}</span>` : icon(m.status === 'failed' ? 'alert' : 'clock', 18)}
          <h2 style="font-size:16px" data-status-text role="status">${esc(statusText(m))}</h2></div>
        ${m.status === 'paused' && m.error ? `<p class="dim">${esc(m.error)}</p>` : ''}
        ${m.status === 'failed' ? '<p class="dim">Check the file and run again, or drop a different version of the transcript.</p>' : ''}
        ${steps.length ? `<div class="list">${steps.map(s => `<div class="item" data-step="${esc(s.name)}"><span class="status-dot ${s.ok ? 'done' : 'error'}" style="margin-top:7px"></span><div class="main-col"><div class="title">${esc(STEP_NAMES[s.name] || words(s.name))}</div>${s.ok ? '' : `<div class="small bin-err">${esc(s.error || 'This step did not finish.')}</div>`}</div><span class="tiny muted">${s.ms != null ? (s.ms / 1000).toFixed(1) + ' s' : ''}</span></div>`).join('')}</div>` : ''}
        <div class="row wrap" style="gap:8px;margin-top:14px"><button class="btn" data-rerun>${icon('refresh', 15)}Run again</button><button class="btn ghost danger" data-delete>${icon('trash', 15)}Delete</button></div>
      </section>`;
      wire(); return;
    }

    // the review
    const all = m.skills.flatMap(s => s.items);
    const undecided = all.filter(i => i.accepted == null).length;
    const kept = all.filter(i => i.accepted === true).length;
    const actionCount = m.skills.filter(s => s.saveTo === 'actions').reduce((n, s) => n + s.items.filter(i => i.accepted === true).length, 0);
    const field = (i, k, sk) => {
      const v = i.fields?.[k]; const isArr = Array.isArray(v); const s = isArr ? v.join(', ') : v ?? '';
      const long = String(s).length > 70 || (sk.longText || []).includes(k);   // the skill's x-jade.longText says which fields are long
      return `<label class="field mtg-field"><span class="tiny muted">${esc(words(k))}</span>${long
        ? `<textarea rows="2" data-field="${esc(k)}" data-array="${isArr ? 1 : ''}">${esc(s)}</textarea>`
        : `<input data-field="${esc(k)}" data-array="${isArr ? 1 : ''}" value="${esc(s)}">`}</label>`;
    };
    const item = (i, sk) => {
      const l = label(i); const st = i.accepted === true ? 'kept' : i.accepted === false ? 'left-out' : 'undecided';
      return `<div class="mtg-item" data-item="${esc(i.id)}" data-state="${st}" data-verdict="${esc(i.verdict)}" data-passed="${passed(i)}">
        <div class="mtg-fields">${Object.keys(i.fields || {}).filter(k => k !== (sk.quoteField || 'quote')).map(k => field(i, k, sk)).join('')}</div>
        ${i.quote ? `<blockquote class="mtg-quote">${esc(i.quote)}</blockquote>` : ''}
        <div class="mtg-foot"><span class="mtg-verdict ${l.k}" data-verdict-label>${esc(l.t)}</span>
          <span class="grow"></span>
          <span class="tiny muted" data-state-label>${st === 'kept' ? 'Kept' : st === 'left-out' ? 'Left out' : 'Not decided yet'}</span>
          <button class="btn sm ${i.accepted === true ? 'primary' : ''}" data-keep aria-pressed="${i.accepted === true}">${icon('check', 14)}Keep</button>
          <button class="btn sm ${i.accepted === false ? 'danger on' : ''}" data-leave aria-pressed="${i.accepted === false}">${icon('x', 14)}Leave out</button></div>
      </div>`;
    };
    const missed = m.missed || [];
    const skillOf = n => m.skills.find(x => x.skill === n);
    const canAdd = x => !!skillOf(x.skill);
    const headingOf = s => m.skills.find(x => x.skill === s)?.heading || words(s);
    const recorded = m.status === 'recorded' && m.recordPath;
    root.innerHTML = `${head}
      <div class="row wrap" style="gap:8px;margin-bottom:16px" data-shortcuts>
        <button class="btn sm" data-keep-passed>${icon('check', 14)}Keep all that passed</button>
        <button class="btn sm" data-leave-failed>${icon('x', 14)}Leave out all that failed</button>
        <span class="tiny muted">Passed means the checker agreed and the quote is really in the transcript.</span></div>
      <div class="stack" style="gap:16px">
      ${m.skills.map(s => `<section class="card" data-skill="${esc(s.skill)}"><div class="card-head"><h2>${esc(s.heading)}</h2><span class="chip">${s.items.length}</span></div>
        ${s.items.length ? `<div class="stack" style="gap:12px">${s.items.map(i => item(i, s)).join('')}</div>` : '<div class="empty">Nothing was found here.</div>'}</section>`).join('')}
      ${missed.length ? `<section class="card" data-missed><div class="card-head"><h2>Possibly missed</h2><span class="chip">${missed.length}</span></div>
        <p class="small dim" style="margin:0 0 10px">The checker thinks these were said but not picked up. They are here to read; press Add to put one in the list above, then change the words if you need to.</p>
        ${m.missedDropped ? `<p class="tiny muted" style="margin:0 0 10px" data-dropped>The checker named ${m.missedDropped} more ${m.missedDropped === 1 ? 'thing' : 'things'} it could not point to in the transcript, so ${m.missedDropped === 1 ? 'it was' : 'they were'} left out.</p>` : ''}
        <div class="list">${missed.map((x, k) => `<div class="item" data-missed-item="${k}"><div class="main-col"><div class="title">${esc(x.text)}</div><div class="tiny muted">${esc(headingOf(x.skill))}</div>${x.quote ? `<blockquote class="mtg-quote">${esc(x.quote)}</blockquote>` : ''}</div>${canAdd(x) ? `<button class="btn sm" data-add-missed="${k}">${icon('plus', 14)}Add</button>` : ''}</div>`).join('')}</div></section>` : m.missedDropped ? `<p class="tiny muted" data-dropped>The checker named ${m.missedDropped} more ${m.missedDropped === 1 ? 'thing' : 'things'} it could not point to in the transcript, so ${m.missedDropped === 1 ? 'it was' : 'they were'} left out.</p>` : ''}
      </div>
      <div class="mtg-bar" data-bar role="region" aria-label="Write the meeting record">
        <div class="grow" style="min-width:200px" data-bar-text>${recorded
          ? `<div class="small"><strong>Saved</strong> to <span class="mono" style="word-break:break-all">${esc(m.recordPath)}</span></div><div class="tiny muted">${actionCount} action ${actionCount === 1 ? 'item' : 'items'} added to your list</div>`
          : undecided ? `<div class="small" data-pending>${undecided} ${undecided === 1 ? 'item' : 'items'} still to decide</div><div class="tiny muted">Keep or leave out each one, then write the record.</div>`
          : `<div class="small">${kept} kept, ${all.length - kept} left out</div>`}</div>
        ${recorded ? `<button class="btn sm" data-open-file="${esc(m.recordPath)}">${icon('external', 14)}Open</button><button class="btn sm" data-reveal-file="${esc(m.recordPath)}">${icon('folder', 14)}Show in folder</button>` : ''}
        <button class="btn sm" data-rerun>${icon('refresh', 14)}Run again</button>
        <button class="btn sm ghost danger" data-delete>${icon('trash', 14)}Delete</button>
        <button class="btn primary" data-record ${undecided ? 'disabled' : ''}>${recorded ? 'Update the meeting record' : 'Write the meeting record'}</button>
      </div>`;
    wire();

    const setAll = (pick, accepted) => {
      const items = all.filter(pick).map(i => ({ id: i.id, accepted }));
      if (items.length) patch({ items }); else ui.toast('Nothing to change.', 'info', 1800);
    };
    root.querySelector('[data-keep-passed]').onclick = () => setAll(passed, true);
    root.querySelector('[data-leave-failed]').onclick = () => setAll(failed, false);
    root.querySelectorAll('[data-item]').forEach(el => {
      const iid = el.dataset.item;
      const cur = all.find(i => i.id === iid);
      el.querySelector('[data-keep]').onclick = () => patch({ items: [{ id: iid, accepted: cur.accepted === true ? null : true }] });
      el.querySelector('[data-leave]').onclick = () => patch({ items: [{ id: iid, accepted: cur.accepted === false ? null : false }] });
      el.querySelectorAll('[data-field]').forEach(f => f.addEventListener('change', () => {
        const v = f.dataset.array ? f.value.split(',').map(s => s.trim()).filter(Boolean) : f.value;
        patch({ items: [{ id: iid, fields: { [f.dataset.field]: v } }] });
      }));
    });
    root.querySelectorAll('[data-add-missed]').forEach(b => b.onclick = () => {
      const x = missed[+b.dataset.addMissed];
      // the server puts the words in the skill's text field; the other fields are blank on the card for the person to fill in
      patch({ items: [{ add: { skill: x.skill, text: x.text, fields: {}, quote: x.quote || '' } }] });
    });
    root.querySelector('[data-record]').onclick = async e => {
      e.target.closest('button').disabled = true;
      try { await api('POST', `/api/meetings/${encodeURIComponent(id)}/record`); ui.toast('Meeting record written.', 'info', 2400); }
      catch (err) { ui.toast(err.message, 'error'); e.target.closest('button').disabled = false; }
    };
  },
};
