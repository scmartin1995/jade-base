// Jade's core: a HUD-style ring system drawn on a canvas.
//   Standby: a small, dim gyroscope of rings tilted in 3D, slowly turning.
//   Awake:   the rings swing face-on and grow, tick rings and segmented arcs fade in, and the JADE wordmark brushes in
//            with a short glitch. It goes back to standby when the app says so (after a few quiet minutes).
// While awake, moods change the motion: idle · listening · thinking · speaking · happy · concerned · sleepy.
//
// API: mount(el, { size, caption }) -> { el, update, setCaption, destroy }; setMood(mood, caption); setAwake(bool).
// Every ring element is projected through the same 3D tilt, so standby -> awake is one continuous motion.

const MOODS = {
  //          spin  glow  pulse  chase  ripple  tint
  idle:      { spin: .12, glow: .75, pulse: 0,  chase: 0, ripple: 0, tint: 0 },
  listening: { spin: .22, glow: 1.0, pulse: 1,  chase: 0, ripple: 1, tint: 0 },
  thinking:  { spin: .7,  glow: .95, pulse: 0,  chase: 1, ripple: 0, tint: 0 },
  speaking:  { spin: .25, glow: 1.0, pulse: .7, chase: 0, ripple: .3, tint: 0 },
  happy:     { spin: .4,  glow: 1.25, pulse: .2, chase: 0, ripple: 0, tint: 0 },
  concerned: { spin: .1,  glow: .8,  pulse: 0,  chase: 0, ripple: 0, tint: 1 },
  sleepy:    { spin: .12, glow: .4,  pulse: 0,  chase: 0, ripple: 0, tint: 0 },
};

let globalMood = 'idle', globalCaption = '', globalAwake = false, globalName = 'JADE';
const faces = new Set();

export function setMood(mood, caption) {
  if (MOODS[mood]) globalMood = mood;
  if (caption !== undefined) globalCaption = caption;
  for (const f of faces) f.update();
}
export function setAwake(on) { globalAwake = !!on; for (const f of faces) f.update(); }
export function setName(name) { globalName = String(name || 'Jade').toUpperCase(); for (const f of faces) f.update(); }
export const isAwake = () => globalAwake;

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const probe = document.createElement('canvas').getContext('2d');
  const rgb = name => {
    probe.fillStyle = '#000';
    probe.fillStyle = cs.getPropertyValue(name).trim() || '#000';
    const v = probe.fillStyle;
    if (v.startsWith('#')) return [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16));
    return (v.match(/\d+(\.\d+)?/g) || [0, 0, 0]).slice(0, 3).map(Number);
  };
  return { cyan: rgb('--cyan'), accent: rgb('--accent'), bright: rgb('--fg-bright'), deep: rgb('--bg-3'), warn: rgb('--yellow') };
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a))})`;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

// The rings. r = radius as a fraction of R; standby tilt (x, y) in radians; spin direction and speed.
const RINGS = [
  { id: 'ticks',  r: .96, tx: 1.15, ty: .35,  dir: 1,  sp: .03, standby: false },
  { id: 'outer',  r: .89, tx: 1.25, ty: -.5,  dir: -1, sp: .07, standby: true },
  { id: 'arcs',   r: .80, tx: .35,  ty: 1.2,  dir: 1,  sp: .14, standby: true },
  { id: 'heavy',  r: .71, tx: -.9,  ty: .7,   dir: -1, sp: .11, standby: true },
  { id: 'dashes', r: .63, tx: .8,   ty: -1.1, dir: 1,  sp: .08, standby: false },
  { id: 'inner',  r: .56, tx: -1.3, ty: -.3,  dir: -1, sp: .18, standby: true },
];

/** A hexagonal platform for the core to stand on: hexes in a flattened perspective, brightest at the centre.
 *  Each hex carries its ring distance (--d) so CSS can ripple light outward when Jade is busy. */
/** The pool of light Jade stands in: a soft glow and thin rings lying flat on the floor's own hex grid (so there is
 *  one continuous grid, lit from above). The rings breathe when idle and ripple outward when Jade is busy. */
function platformSVG() {
  const W = 400, H = 136;
  return `<svg viewBox="${-W / 2} ${-H / 2} ${W} ${H}" aria-hidden="true">
    <defs><radialGradient id="platGlow"><stop offset="0" stop-color="var(--cyan)" stop-opacity=".5"/><stop offset=".55" stop-color="var(--cyan)" stop-opacity=".12"/><stop offset="1" stop-color="var(--cyan)" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="0" cy="0" rx="${W * .48}" ry="${H * .46}" fill="url(#platGlow)" class="plat-glow"/>
    ${[0, 1, 2].map(d => `<ellipse class="hx" style="--d:${d}" cx="0" cy="0" rx="${70 + d * 50}" ry="${(70 + d * 50) * .3}" fill="none" stroke-width="${1.4 - d * .3}" stroke-opacity="${(.6 - d * .17).toFixed(2)}"/>`).join('')}
  </svg>`;
}

export function mount(host, { size = 320, caption = true, interactive = true, platform = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'jade-face' + (platform ? ' on-platform' : '');
  wrap.style.setProperty('--face', size + 'px');
  if (platform) { const p = document.createElement('div'); p.className = 'face-platform'; p.innerHTML = platformSVG(); wrap.appendChild(p); }
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Jade');
  wrap.appendChild(canvas);
  let cap = null;
  if (caption) { cap = document.createElement('div'); cap.className = 'face-caption'; wrap.appendChild(cap); }
  host.appendChild(wrap);

  const ctx = canvas.getContext('2d');
  let colors = readColors();
  let dpr = 1, S = size;
  const resize = () => {
    S = wrap.clientWidth || size;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(S * dpr); canvas.height = Math.round(S * dpr);
    canvas.style.width = canvas.style.height = S + 'px';
    word = null;
  };

  const st = { wake: globalAwake ? 1 : 0, spin: .35, glow: .75, pulse: 0, chase: 0, ripple: 0, tint: 0, flash: 0, rot: RINGS.map(() => Math.random() * 6) };
  let target = MOODS.idle, mood = 'idle', wakeTarget = st.wake, lastWakeChange = 0;
  let visible = true, raf = 0, last = performance.now(), t = 0, mouse = { x: 0, y: 0 };
  let word = null;   // kept for resize(); the wordmark is drawn live
  wrap._core = st;   // for debugging in the console: document.querySelector('.jade-face')._core
  const WORD_FONT = '"Unbounded", "Geist", system-ui, sans-serif';

  // The wordmark: wide-tracked light caps in a jade gradient. Letters fade and settle in one by one as Jade wakes.
  function drawWord(c, R, reveal, col, speak) {
    const name = globalName.split('');
    const fs = R * .2;
    ctx.save();
    ctx.font = `300 ${fs}px ${WORD_FONT}`;
    ctx.textBaseline = 'middle';
    const tracking = fs * lerp(1.1, .42, ease(Math.min(1, reveal * 1.2)));   // letters gather as they arrive
    const widths = name.map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + tracking * (name.length - 1);
    let x = c - total / 2;
    const grad = ctx.createLinearGradient(0, c - fs / 2, 0, c + fs / 2);
    grad.addColorStop(0, rgba(colors.bright, 1));
    grad.addColorStop(1, rgba(mix(col, colors.bright, .35), 1));
    ctx.shadowColor = rgba(col, .8);
    ctx.shadowBlur = 10 + speak * 12 + st.flash * 10;
    name.forEach((ch, i) => {
      const k = Math.max(0, Math.min(1, reveal * (name.length + 1) - i));     // this letter's own 0..1
      ctx.globalAlpha = ease(k);
      ctx.fillStyle = grad;
      ctx.fillText(ch, x, c + (1 - ease(k)) * fs * .35);
      x += widths[i] + tracking;
    });
    // a hairline under the name, drawn outward from the centre
    const lw = total * .5 * ease(reveal);
    ctx.globalAlpha = .55 * reveal;
    ctx.shadowBlur = 6;
    ctx.fillStyle = rgba(col, 1);
    ctx.fillRect(c - lw / 2, c + fs * .78, lw, 1);
    ctx.restore();
  }

  const api = {
    el: wrap,
    update() {
      mood = globalMood; target = MOODS[mood];
      if (wakeTarget !== (globalAwake ? 1 : 0)) { wakeTarget = globalAwake ? 1 : 0; lastWakeChange = t; }
      if (cap) cap.textContent = globalCaption;
      wrap.dataset.mood = mood;
      wrap.dataset.awake = globalAwake ? '1' : '0';
      if (reduceMotion()) { st.wake = wakeTarget; draw(0); }
    },
    setCaption(text) { if (cap) cap.textContent = text; },
    destroy() { cancelAnimationFrame(raf); faces.delete(api); io.disconnect(); window.removeEventListener('pointermove', onMove); window.removeEventListener('jade:theme', onTheme); wrap.remove(); },
  };
  faces.add(api);

  const onMove = e => {
    const r = canvas.getBoundingClientRect();
    mouse = { x: Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 2))), y: Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height * 2))) };
  };
  const onTheme = () => { colors = readColors(); };
  if (interactive) window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('jade:theme', onTheme);
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) loop(); });
  io.observe(canvas);
  new ResizeObserver(resize).observe(wrap);
  resize();
  document.fonts?.load('300 48px Unbounded');

  // --- 3D projection: rotate a point on a ring by the ring's tilt (scaled by how asleep we are), then drop z.
  function project(ring, i, a, rad, c, sleep) {
    const tx = ring.tx * sleep + mouse.y * .25 * (1 - sleep), ty = ring.ty * sleep + mouse.x * .25 * (1 - sleep);
    const wob = sleep * .25;
    const ax = tx + Math.sin(t * .35 + i) * wob, ay = ty + Math.cos(t * .27 + i * 1.7) * wob;
    let x = Math.cos(a) * rad, y = Math.sin(a) * rad, z = 0;
    // rotate around X
    let y2 = y * Math.cos(ax) - z * Math.sin(ax), z2 = y * Math.sin(ax) + z * Math.cos(ax);
    // rotate around Y
    const x3 = x * Math.cos(ay) + z2 * Math.sin(ay), z3 = -x * Math.sin(ay) + z2 * Math.cos(ay);
    return [c + x3, c + y2, z3];
  }
  function arc(ring, i, rad, a0, a1, c, sleep, steps = 64) {
    ctx.beginPath();
    for (let k = 0; k <= steps; k++) {
      const [x, y] = project(ring, i, a0 + (a1 - a0) * (k / steps), rad, c, sleep);
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
  }

  function draw(dt) {
    const k = Math.min(1, dt * 3.5);
    for (const key of ['spin', 'glow', 'pulse', 'chase', 'ripple', 'tint']) st[key] = lerp(st[key], target[key], k);
    st.flash = lerp(st.flash, mood === 'happy' ? 1 : 0, Math.min(1, dt * 6));
    // wake/standby is a slower, eased transition (~1.4s)
    st.wake += Math.sign(wakeTarget - st.wake) * Math.min(Math.abs(wakeTarget - st.wake), dt / 1.4);
    const w = ease(st.wake), sleep = 1 - w;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const c = S / 2;
    const speak = mood === 'speaking' ? (Math.sin(t * 7) * .5 + Math.sin(t * 4.3) * .3 + .5) : 0;
    const R = S * .46 * lerp(.42, 1, w) * (1 + st.pulse * Math.sin(t * 2.6) * .012 + speak * .015);
    const col = st.tint > .02 ? mix(colors.cyan, colors.warn, st.tint) : colors.cyan;
    const hot = mix(col, colors.bright, .55);
    const base = (.35 + .65 * w) * st.glow;

    // soft core glow
    const halo = ctx.createRadialGradient(c, c, 0, c, c, R * 1.15);
    halo.addColorStop(0, rgba(col, (.10 + .14 * w) * st.glow + speak * .08 + st.flash * .1));
    halo.addColorStop(.6, rgba(col, .04 * st.glow));
    halo.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = halo; ctx.fillRect(0, 0, S, S);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.shadowColor = rgba(col, .9);
    const glowBlur = 10 * (.5 + st.glow * .6);

    RINGS.forEach((ring, i) => {
      ctx.shadowBlur = ring.id === 'heavy' || ring.id === 'outer' ? glowBlur : 0;   // blur is the costliest thing we draw
      st.rot[i] += dt * ring.sp * ring.dir * (1 + st.spin) * (.45 + .4 * w + sleep * .7);
      const vis = ring.standby ? 1 : w;                  // some rings only exist when awake
      if (vis < .02) return;
      const rad = R * ring.r * lerp(ring.standby ? 1 : .8, 1, w);
      const rot = st.rot[i];
      const a = base * vis;
      ctx.strokeStyle = rgba(col, a);
      switch (ring.id) {
        case 'ticks': {                                   // 120 ticks, every 5th long; two batched paths, lit ticks on top
          const litFrom = st.chase > .05 ? Math.floor(t * 9) : -1;
          const batch = (which, width, alpha) => {
            ctx.beginPath();
            for (let n = 0; n < 120; n++) {
              const long = n % 5 === 0;
              if (long !== which) continue;
              if (litFrom >= 0 && ((n - litFrom) % 120 + 120) % 120 < 10) continue;
              const ang = rot + (n / 120) * Math.PI * 2;
              const [x1, y1] = project(ring, i, ang, rad, c, sleep), [x2, y2] = project(ring, i, ang, rad - R * (long ? .05 : .025), c, sleep);
              ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
            }
            ctx.strokeStyle = rgba(col, alpha); ctx.lineWidth = width; ctx.stroke();
          };
          batch(true, 1.4, a * .9); batch(false, 1, a * .5);
          if (litFrom >= 0) {
            ctx.beginPath();
            for (let k = 0; k < 10; k++) {
              const n = ((litFrom + k) % 120 + 120) % 120, long = n % 5 === 0, ang = rot + (n / 120) * Math.PI * 2;
              const [x1, y1] = project(ring, i, ang, rad, c, sleep), [x2, y2] = project(ring, i, ang, rad - R * (long ? .05 : .025), c, sleep);
              ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
            }
            ctx.strokeStyle = rgba(hot, Math.min(1, a + .5 * st.chase)); ctx.lineWidth = 1.4; ctx.stroke();
          }
          break;
        }
        case 'outer':
          ctx.lineWidth = 1.2 + w * .6;
          arc(ring, i, rad, rot, rot + Math.PI * 2, c, sleep, 120); ctx.stroke();
          ctx.lineWidth = 3;
          ctx.strokeStyle = rgba(hot, a);
          arc(ring, i, rad, rot + .3, rot + .55, c, sleep, 16); ctx.stroke();
          arc(ring, i, rad, rot + 3.4, rot + 3.5, c, sleep, 8); ctx.stroke();
          break;
        case 'arcs': {                                    // four segments of different lengths
          ctx.lineWidth = 2 + w * 1.5;
          const segs = [[0, 1.1], [1.4, 1.8], [2.3, 3.9], [4.3, 5.7]];
          segs.forEach(([s0, s1], si) => {
            const lit = st.chase > .05 && si === Math.floor(t * 1.1) % segs.length;
            ctx.strokeStyle = rgba(lit ? hot : col, a * (lit ? 1 : .85) + (lit ? .3 : 0));
            arc(ring, i, rad, rot + s0, rot + s1, c, sleep, 36); ctx.stroke();
          });
          break;
        }
        case 'heavy': {                                   // thick, bright partial arcs; pulse with the voice
          ctx.lineWidth = (3.5 + w * 4) * (1 + st.pulse * (Math.sin(t * 3.4) * .5 + .5) * .45 + speak * .5);
          ctx.strokeStyle = rgba(mix(col, colors.bright, .25), a);
          arc(ring, i, rad, rot, rot + 2.1, c, sleep, 48); ctx.stroke();
          arc(ring, i, rad, rot + Math.PI, rot + Math.PI + 1.2, c, sleep, 32); ctx.stroke();
          break;
        }
        case 'dashes':
          ctx.lineWidth = 1;
          for (let n = 0; n < 48; n++) { const s = rot + (n / 48) * Math.PI * 2; arc(ring, i, rad, s, s + .07, c, sleep, 3); ctx.stroke(); }
          break;
        case 'inner':
          ctx.lineWidth = 1.2;
          arc(ring, i, rad, rot, rot + Math.PI * 1.75, c, sleep, 90); ctx.stroke();
          // little triangle marker riding the inner ring
          { const [x, y] = project(ring, i, rot + Math.PI * 1.85, rad, c, sleep); ctx.fillStyle = rgba(hot, a); ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill(); }
          break;
      }
    });

    // awake-only details: crosshair, readouts, listening ripples
    if (w > .05) {
      ctx.shadowBlur = 4;
      ctx.strokeStyle = rgba(col, .35 * w * st.glow); ctx.lineWidth = 1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.beginPath(); ctx.moveTo(c + dx * R * 1.0, c + dy * R * 1.0); ctx.lineTo(c + dx * R * 1.08, c + dy * R * 1.08); ctx.stroke();
      }
      ctx.fillStyle = rgba(col, .55 * w);
      ctx.font = `500 ${Math.max(8, S * .022)}px "Geist Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(mood === 'thinking' ? 'PROCESSING' : mood === 'listening' ? 'LISTENING' : mood === 'speaking' ? 'SPEAKING' : mood === 'concerned' ? 'CHECK' : 'ONLINE', c, c + R * 1.16);
      if (st.ripple > .02) {
        for (let n = 0; n < 3; n++) {
          const kk = ((t * .45 + n / 3) % 1);
          ctx.strokeStyle = rgba(col, (1 - kk) * .5 * st.ripple * w);
          ctx.beginPath(); ctx.arc(c, c, R * (.5 + kk * .55), 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
    ctx.restore();

    // the wordmark
    if (w > .45) {
      drawWord(c, R, Math.min(1, (w - .45) / .5), col, speak);
    } else if (w < .3) {
      // standby: a tiny glowing core point
      ctx.fillStyle = rgba(colors.bright, .6 + Math.sin(t * 1.4) * .2);
      ctx.shadowColor = rgba(col, 1); ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(c, c, 2.2 + Math.sin(t * 1.4), 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Frame rate follows what is happening: full rate while waking, listening, thinking or flashing; a calm 30 when
  // awake and idle; 15 in standby. Nothing is drawn while the page is hidden or the core is scrolled out of view.
  function targetFps() {
    if (window.__faceFps) return window.__faceFps;   // test hook
    // Full rate only for the short transitions; a working or listening Jade runs at 30, which reads as smooth and costs
    // half the CPU on a laptop; resting at 20 / 10.
    if (Math.abs(wakeTarget - st.wake) > .005 || st.flash > .02 || st.ripple > .02) return 60;
    if (!['idle', 'sleepy'].includes(mood) || st.pulse > .02) return 30;
    return st.wake > .5 ? 20 : 10;
  }
  let slowT = 0;
  function loop() {
    cancelAnimationFrame(raf); clearTimeout(slowT);
    if (!visible || document.hidden || !canvas.isConnected) return;
    const go = () => { raf = requestAnimationFrame(now => {
      const dt = Math.min(.12, (now - last) / 1000); last = now;   // keep real time even at low frame rates
      t += dt;
      const d0 = performance.now(); draw(dt);
      (window.__faceStats ||= { draws: 0, ms: 0 }); window.__faceStats.draws++; window.__faceStats.ms += performance.now() - d0;
      if (!reduceMotion()) loop();
    }); };
    const wait = 1000 / targetFps() - (performance.now() - last);
    if (wait > 4) slowT = setTimeout(go, wait); else go();
  }
  document.addEventListener('visibilitychange', () => { last = performance.now(); loop(); });
  api.update();
  last = performance.now();
  if (reduceMotion()) draw(1); else loop();
  return api;
}
