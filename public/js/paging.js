// Paging and "newest answer wins" for the list pages, as plain functions (no browser needed to test them).
// A list page asks the server for a page with ?paged=1 and gets { items, total }; it always knows how many there are.

/** The words under a list: "Showing 50 of 312", or "" when everything is shown (or nothing is). */
export function showing(shown, total, noun = '') {
  if (!(total > shown) || shown <= 0) return '';
  return `Showing ${shown} of ${total}${noun ? ' ' + noun : ''}`;
}

/** The server's answer, however it came: { items, total } or (older) a plain list. total is never smaller than what came. */
export function pageOf(r) {
  const items = Array.isArray(r) ? r : Array.isArray(r?.items) ? r.items : [];
  const total = Number.isFinite(r?.total) ? Math.max(r.total, items.length) : items.length;
  return { items, total };
}

/** Is there more to show? Judged by the server's total, never by whether a page came back full. */
export const hasMore = (shown, total) => total > shown;

/** How many to ask for next time: one more step, but never more than there is. */
export const nextSize = (current, step, total) => Math.min(Math.max(current, 0) + step, Math.max(total, current));

/**
 * Only the newest of several overlapping requests may be drawn.
 * const mine = latest.begin();  ... await something ...  if (!mine()) return;
 * latest.cancel() makes every request still going stale (when the page is left).
 */
export function createLatest() {
  let n = 0;
  return { begin() { const mine = ++n; return () => mine === n; }, cancel() { n++; } };
}
