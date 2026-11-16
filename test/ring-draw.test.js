// The file ring draws a frame only when something changed: once its dots have settled and nothing moves, a ring with no
// new-this-week files draws nothing, and one with new files redraws only for their glow (a few times a second, not 60).
import { test } from 'node:test';
import assert from 'node:assert/strict';

let frames = [], draws = 0, now = 0, observer;
const ctx = new Proxy({}, { get: (_, k) => k === 'fillStyle' ? '#888888' : k === 'clearRect' ? () => { draws++; } : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
const el = () => ({ style: {}, classList: { add() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {}, getContext: () => ctx, isConnected: true,
  getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }), querySelector: () => el() });
globalThis.document = { createElement: el, documentElement: {} };
globalThis.window = { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#888888' });
globalThis.performance = { now: () => now };
globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.ResizeObserver = class { constructor(fn) { observer = fn; } observe() {} disconnect() {} };
const { mountRing } = await import('../public/js/filering.js');

const file = (i, ageDays) => ({ file: '/p/' + i, title: 'f' + i, group: 'G' + (i % 3), area: 'A' + (i % 2), mtime: Date.now() - ageDays * 864e5, project: '' });
/** Run `n` animation frames of 16 ms; returns how many were drawn. */
function run(n) { draws = 0; for (let i = 0; i < n; i++) { now += 16; const f = frames.splice(0); f.forEach(fn => fn(now)); } return draws; }

test('settled ring with no new files: no frames drawn', () => {
  const ring = mountRing(el(), Array.from({ length: 300 }, (_, i) => file(i, 30 + i)));
  assert.ok(run(200) > 0, 'it draws while the dots glide into place');
  assert.equal(run(120), 0, 'then nothing is drawn');
  ring.setHits(new Set(['/p/1']));
  assert.ok(run(3) >= 1, 'a choice draws again');
  ring.destroy();
});

test('ring with new files: only the glow is redrawn, far below 60 a second', () => {
  frames = [];
  const ring = mountRing(el(), Array.from({ length: 300 }, (_, i) => file(i, i % 5)));
  run(300);
  const n = run(120);   // about two seconds
  assert.ok(n > 0 && n <= 45, `redraws in about two seconds: ${n}`);
  ring.destroy();
});
