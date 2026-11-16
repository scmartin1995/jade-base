// Long work that must give way to other requests. A job is written once as a generator that does `if (due()) yield;` now and
// then; runSync finishes it in one go (for callers that cannot wait), runAsync lets the server answer others between slices.
export const SLICE_MS = 15;

/** A clock for one job: due() is true when the current slice has used its time (and starts the next slice). */
export function slicer(ms = SLICE_MS) {
  let t = Date.now();
  return () => { if (Date.now() - t < ms) return false; t = Date.now(); return true; };
}

export function runSync(gen) {
  let r;
  while (!(r = gen.next()).done);
  return r.value;
}

export async function runAsync(gen) {
  let r;
  while (!(r = gen.next()).done) await new Promise(resolve => setImmediate(resolve));
  return r.value;
}
