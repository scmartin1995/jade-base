// The Meetings card on a project page: a small drop bin and the five latest meetings.
import { mountBin, uploadFiles, TRANSCRIPT_TYPES } from '../dropbin.js';
import { meetingRow, byNewest, loadFailed } from './meetings.js';

export default {
  async render(root, ctx, project) {
    const { api, ui } = ctx;
    let all, failure = null;
    try { all = await api('GET', `/api/meetings?project=${encodeURIComponent(project.id)}`); } catch (err) { all = []; failure = err; console.error('Meetings panel: could not load', err); }
    const recent = [...all].sort(byNewest).slice(0, 5);
    // a load that failed says so; "No meetings yet" is only for a list that really is empty
    root.innerHTML = `<div data-bin-host></div>
      <div class="list" data-list style="margin-top:10px">${failure ? loadFailed(ui.esc, 'the meetings for this project', failure) : recent.map(m => meetingRow(m, { ui })).join('') || '<div class="empty">No meetings yet. Drop a transcript above and Jade will pull out the key points and action items for you to check.</div>'}</div>
      ${all.length ? `<a class="btn sm ghost" href="#/meetings" style="margin-top:6px">All meetings</a>` : ''}`;
    root.querySelector('[data-retry]')?.addEventListener('click', () => this.render(root, ctx, project));
    mountBin(root.querySelector('[data-bin-host]'), {
      accept: TRANSCRIPT_TYPES, compact: true, hint: `For ${project.name}. Caption files, text, Word or PDF.`,
      onFiles: async files => { const ids = await uploadFiles(files, project.id); if (ids.length === 1 && files.length === 1) ctx.go('meeting/' + ids[0]); },
    });
  },
};
