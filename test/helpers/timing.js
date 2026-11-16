// Timing checks that survive a busy machine: measure how late a timer fires when nothing is going on, and allow for that.
import { AssertionError } from 'node:assert';
/** The longest a 5 ms timer was late over `ms` of idle time: how slow this machine is right now. */
export async function idleLag(ms = 300) {
  let worst = 0, last = Date.now();
  const tick = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last - 5); last = n; }, 5);
  await new Promise(r => setTimeout(r, ms));
  clearInterval(tick);
  return Math.max(worst, 0);
}
/** The smallest of `n` runs of fn (a busy moment slows some runs, not all). */
export const best = (n, fn) => { let m = Infinity; for (let i = 0; i < n; i++) { const t = performance.now(); fn(); m = Math.min(m, performance.now() - t); } return m; };
/**
 * Try a timing measurement up to `n` times and pass when any attempt meets its bound (a busy shared machine spoils some runs, not all).
 * `fn(i)` returns '' / undefined / true when the bound was met, or a sentence saying how it was missed; a thrown error counts as a miss.
 * Throws with every miss listed when no attempt passes.
 */
export async function attempts(n, fn) {
  const misses = [];
  for (let i = 0; i < n; i++) {
    let r; try { r = await fn(i); } catch (e) { r = 'threw: ' + (e?.message || e); }
    if (r === undefined || r === true || r === '') return;
    misses.push(`attempt ${i + 1}: ${r}`);
  }
  throw new AssertionError({ message: 'every attempt missed the bound\n  ' + misses.join('\n  ') });
}
