// Timing checks that survive a busy machine: measure how late a timer fires when nothing is going on, and allow for that.
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
