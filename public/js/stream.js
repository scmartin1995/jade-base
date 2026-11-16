// A run's words arrive as small pieces (job:text events). This keeps the text so far (state.streams) and draws it:
//  - plain text (an agent's output) gets only the new piece added to what is on screen;
//  - a chat reply is markdown, so it is drawn again, but no more often than its length allows (a long reply is drawn less often),
//    so a long reply does not cost more with every word;
//  - a page opened while a run was going has missed the start: it asks for it once and holds the pieces that arrive meanwhile.
// No browser globals at import time: the page (document, api, ui) is handed in.
const FINAL = ['done', 'error', 'cancelled'];
const stripActions = s => s.replace(/```jade-actions[\s\S]*?(```|$)/, '').trim();

/** createStreamer({ state, api, ui, doc, now?, later? }) -> { text({ id, text }), paint(id), finished(id) }. state: { jobs, streams: Map }. */
export function createStreamer({ state, api, ui, doc, now = Date.now, later = setTimeout }) {
  const drawn = new Map();       // run id -> { at, timer, len, el } how a stream was last drawn
  const catchingUp = new Map();  // run id -> pieces held while the earlier text is fetched

  function paint(id, added) {
    const el = doc.querySelector(`[data-stream="${id}"]`);
    if (!el) return;
    const full = state.streams.get(id) || '';
    const j = state.jobs.find(x => x.id === id);
    const body = el.closest('.body, .output, .messages');
    // follow the reply as it streams only if the user is at the bottom already; someone scrolled up to read stays put
    const follow = body && body.scrollHeight - body.scrollTop - body.clientHeight < 60;
    const settle = () => { if (follow) body.scrollTo({ top: body.scrollHeight, behavior: 'instant' }); };
    const st = drawn.get(id) || { at: 0, timer: null };
    if (j?.agent !== 'jade') {
      if (added !== undefined && st.el === el && st.len === full.length - added.length) el.append(added);   // just the new words
      else el.textContent = full;
      drawn.set(id, { ...st, len: full.length, el });
      return settle();
    }
    const wait = Math.min(1000, 120 + full.length / 150), due = st.at + wait - now();
    if (due > 0) { if (!st.timer) { st.timer = later(() => { st.timer = null; paint(id); }, due); drawn.set(id, st); } return; }
    st.at = now(); drawn.set(id, st);
    el.innerHTML = ui.md(stripActions(full));
    settle();
  }

  // Each piece says where it starts (from) and ends (at) in the run's text. pos is how far this page has the text, so a piece that
  // starts later than pos means something was missed (a reconnect, a late start) and is fetched again; one that ends at or before pos
  // is already here and is dropped. A piece with no from/at (an older server) is simply added.
  const pos = new Map();         // run id -> how much of the run's text the page has (the server's count)

  function put(id, text, at) {
    state.streams.set(id, (state.streams.get(id) || '') + text);
    if (at !== undefined) pos.set(id, at);
    paint(id, text);
  }
  function apply(id, p) {
    if (p.from === undefined || p.at === undefined) return put(id, p.text);
    const have = state.streams.has(id) ? pos.get(id) ?? 0 : 0;
    if (p.at <= have) return 'dup';
    if (p.from === have) return put(id, p.text, p.at);
    return 'gap';
  }
  function catchUp(id, held, tries = 0) {
    catchingUp.set(id, held);
    return api('GET', `/api/jobs/${id}`).catch(() => null).then(full => {
      const pieces = catchingUp.get(id) || []; catchingUp.delete(id);
      if (full && typeof full.output === 'string' && full.outputLength !== undefined) {
        state.streams.set(id, full.output); pos.set(id, full.outputLength); paint(id);
        let again = false;
        for (const p of pieces) if (apply(id, p) === 'gap') again = true;   // started before what was fetched but ended after it: fetch once more
        if (again && tries < 3) return catchUp(id, pieces.filter(p => p.at > pos.get(id)), tries + 1);   // (bounded: the final event settles it anyway)
      }
      // fetching failed (or the run is gone): keep what is here; the next piece asks again
    });
  }
  function text(p) {
    const id = p.id;
    if (catchingUp.has(id)) { catchingUp.get(id).push(p); return; }
    if (apply(id, p) === 'gap') return catchUp(id, [p]);
  }

  /** The run ended: its final event carries all its text, which replaces whatever was streamed; nothing more is drawn for it. */
  function finish(id, full) {
    if (typeof full === 'string') { state.streams.set(id, full); pos.delete(id); }
    catchingUp.delete(id);
    finished(id);
    if (typeof full === 'string') paint(id);   // drawn at once, in place of what was streamed
  }
  /** Forget the text of runs that are no longer in the run list. */
  function prune() { for (const id of [...state.streams.keys()]) if (!state.jobs.some(j => j.id === id)) { state.streams.delete(id); pos.delete(id); } }

  /** The run ended: its events carry all of its text now, and nothing more is drawn for it. */
  function finished(id) { clearTimeout(drawn.get(id)?.timer); drawn.delete(id); }

  return { text, paint, finished, finish, prune };
}
