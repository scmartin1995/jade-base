// Where an action came from, in words a person can follow. An action made from a meeting keeps the path of the meeting record as its
// source: that becomes a link to the meeting, named by its title and date. Any other path shows its file name only.
const looksLikePath = s => /[\\/]/.test(String(s || ''));
const norm = p => String(p || '').replace(/\\/g, '/');

export function sourceHtml(esc, a, meetings = []) {
  const src = String(a?.source || '');
  if (!looksLikePath(src)) return `<span>${esc(src)}</span>`;
  const m = (meetings || []).find(x => x.recordPath && norm(x.recordPath) === norm(src));
  if (m) return `<a href="#/meeting/${esc(m.id)}">From the meeting ${esc(m.title || 'record')}${m.date ? ` (${esc(m.date)})` : ''}</a>`;
  return `<span>From ${esc(norm(src).split('/').pop().replace(/\.[^.]+$/, ''))}</span>`;
}
