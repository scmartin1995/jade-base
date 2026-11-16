// The file ring: every file Jade knows, arranged round a hub.
//   hub        — the file count, or the name and count of whatever band you're hovering
//   inner band — one slice per group (a Jade project, else a folder), sized by how many files it holds
//   thin band  — that group's sub-folders ("areas")
//   bright zone just outside the bands — files changed this week, newest first
//   outer dots — everything else, newest nearest the middle
// Click a slice to open it up (it takes most of the ring); click the hub to go back. Dots glide between layouts.

import { honeycomb } from './hex.js';

const NEW_DAYS = 7, DAY = 864e5, START = -Math.PI / 2;
const PALETTE = ['--cyan', '--magenta', '--yellow', '--orange', '--fg-dim', '--accent'];

function cssColor(name) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  const v = probe.fillStyle;
  return v.startsWith('#') ? [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16)) : (v.match(/\d+/g) || [128, 128, 128]).slice(0, 3).map(Number);
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Split a0..a1 into slices proportional to the weights, with a gap between each.
function spans(weights, a0, a1, gap) {
  const total = weights.reduce((s, w) => s + w, 0) || 1, free = a1 - a0 - gap * weights.length;
  let a = a0 + gap / 2;
  return weights.map(w => { const s = { a0: a, a1: a + (free * w) / total }; a = s.a1 + gap; return s; });
}

// Pure data -> structure (no drawing): the five biggest groups get a colour each, the rest share "Other". Each file gets its
// age, a new-this-week flag and its group index; each group gets its areas (sub-folders), biggest first.
export function buildGroups(list, now = Date.now()) {
  const byGroup = new Map();
  for (const f of list) { if (!byGroup.has(f.group)) byGroup.set(f.group, []); byGroup.get(f.group).push(f); }
  let groups = [...byGroup].sort((a, b) => b[1].length - a[1].length).map(([name, files]) => ({ name, files, project: !!files[0].project }));
  if (groups.length > 6) {
    const rest = groups.slice(5).flatMap(g => g.files.map(f => ({ ...f, area: g.name.split('/').pop() })));
    groups = [...groups.slice(0, 5), { name: 'Other', files: rest }];
  }
  const files = [];
  groups.forEach((g, gi) => {
    g.color = gi;
    g.areas = [];
    for (const f of g.files) {
      const age = Math.max(0, Math.floor((now - f.mtime) / DAY));
      const file = { ...f, gi, age, isNew: age <= NEW_DAYS, x: 0, y: 0, tx: 0, ty: 0 };
      files.push(file);
      let a = g.areas.find(x => x.name === file.area);
      if (!a) g.areas.push(a = { name: file.area, files: [] });
      a.files.push(file);
    }
    for (const a of g.areas) a.files.sort((x, y) => y.mtime - x.mtime);
    g.areas.sort((x, y) => y.files.length - x.files.length);
  });
  return { groups, files };
}

// noun: what the hub calls the dots ("outputs" or "files"). A dot with loose set gets a marker and a tooltip line.
export function mountRing(host, list, { onSelect = () => {}, onOpen = () => {}, noun = 'files' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ring-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `File ring of ${list.length} ${noun}`);
  host.appendChild(canvas);
  const tip = document.createElement('div');
  tip.className = 'memmap-tip'; tip.hidden = true;
  host.appendChild(tip);
  const ctx = canvas.getContext('2d');
  let colors = PALETTE.map(cssColor), lattice = cssColor('--cyan'), bright = cssColor('--fg-bright');
  const now = Date.now();

  const { groups, files } = buildGroups(list, now);

  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R = 0, layout = null;
  let focus = null, hover = null, hoverBand = null, selected = null, hits = null, raf = 0, t = 0, first = true;
  // Drawing every dot is the costly part, so a frame is drawn only when something changed: a dot still gliding, the pointer, a
  // choice, the size. Bright new-file dots pulse, and that alone is redrawn about 20 times a second, not 60.
  let dirty = true, moving = false, lastDraw = 0;
  const hasNew = files.some(f => f.isNew), PULSE_MS = 50;

  function weights() {
    const base = groups.map(g => Math.max(3, Math.pow(g.files.length, .62)));
    if (focus === null) return base;
    const others = base.reduce((s, w, i) => s + (i === focus ? 0 : w), 0);
    return base.map((w, i) => (i === focus ? Math.max(others * 5, w) : w));
  }

  // Lay the ring out for a working radius Rx. computeLayout() searches for the Rx that fills the space, so a ring of
  // mostly-new files (which pack tightly near the middle) still uses the whole panel.
  function computeLayout() {
    let lo = 1, hi = 2.2, best = 1;
    for (let i = 0; i < 7; i++) {
      const k = i === 0 ? 1 : (lo + hi) / 2;
      const used = layoutFor(R * k);
      if (used <= R * .97) { best = k; lo = k; if (i === 0 && used > R * .88) break; } else hi = k;
    }
    layoutFor(R * best);
    for (const f of files) { f.tx = cx + f.tr * Math.cos(f.ta); f.ty = cy + f.tr * Math.sin(f.ta); }
    dirty = true;
    if (first) { for (const f of files) { f.x = cx; f.y = cy; } first = false; }   // the first time, dots bloom out from the hub
  }

  function layoutFor(Rx) {
    const rP0 = Rx * .17, rP1 = Rx * .235, rA0 = Rx * .248, rA1 = Rx * .262;
    const dr = Math.max(2.6, Math.min(7, Rx / 72)), sw = dr * 2.5, rZ0 = rA1 + dr * 3.4;
    const ps = spans(weights(), START, START + Math.PI * 2, .024);
    // this week's files: their own tracks just outside the bands
    let zoneTracks = 0;
    groups.forEach((g, gi) => {
      // with a slice opened up, the other groups fold into the hub and the open one gets the whole ring
      if (focus !== null && gi !== focus) { for (const a of g.areas) for (const f of a.files) { f.tr = 0; f.ta = 0; } return; }
      const fresh = g.areas.flatMap(a => a.files).filter(f => f.isNew).sort((x, y) => y.mtime - x.mtime);
      const { a0, a1 } = ps[gi];
      let i = 0, k = 0;
      while (i < fresh.length) {
        const r = rZ0 + k * sw, cap = Math.max(1, Math.floor(((a1 - a0) * r) / sw) || 1), m = Math.min(cap, fresh.length - i);
        const step = Math.min((a1 - a0) / m, (sw * 1.1) / r), s0 = (a0 + a1) / 2 - (step * (m - 1)) / 2;
        for (let j = 0; j < m; j++, i++) { fresh[i].tr = r; fresh[i].ta = s0 + j * step; }
        k++;
      }
      zoneTracks = Math.max(zoneTracks, k);
    });
    const rZ1 = rZ0 + Math.max(zoneTracks - 1, 0) * sw, rD0 = rZ1 + dr * 4.6;
    const older = files.filter(f => !f.isNew && (focus === null || f.gi === focus)).length || 1;
    // spacing for the older files; if the new-files zone already reaches the edge, fall back to a sane minimum
    let s = Math.min(Rx / 14, Math.sqrt(Math.max(0, Math.PI * (Rx * Rx - rD0 * rD0)) / older) * .95);
    if (!(s > dr * 2.2)) s = dr * 2.4;
    const place = () => {
      let maxR = 0;
      groups.forEach((g, gi) => {
        const as = spans(g.areas.map(a => Math.max(1.5, Math.pow(a.files.length, .75))), ps[gi].a0, ps[gi].a1, .012);
        if (focus !== null && gi !== focus) { g.areas.forEach((a, ai) => { a.span = as[ai]; }); return; }
        g.areas.forEach((a, ai) => {
          a.span = as[ai];
          const rest = a.files.filter(f => !f.isNew);
          const { a0, a1 } = as[ai];
          let i = 0, k = 0;
          while (i < rest.length) {
            const r = rD0 + k * s, cap = Math.max(1, Math.floor(((a1 - a0) * r) / s) || 1), m = Math.min(cap, rest.length - i);
            const step = Math.min((a1 - a0) / m, (s * 1.35) / r), s0 = (a0 + a1) / 2 - (step * (m - 1)) / 2;
            for (let j = 0; j < m; j++, i++) { rest[i].tr = r; rest[i].ta = s0 + j * step; }
            maxR = Math.max(maxR, r); k++;
          }
        });
      });
      return maxR;
    };
    let maxR = place();
    while (maxR > Rx && s > dr * 2.2) { s *= .94; maxR = place(); }
    layout = { ps, rP0, rP1, rA0, rA1, rZ0, rZ1, rD0, dr };
    return Math.max(rA1, ...files.map(f => f.tr || 0)) + dr;
  }

  function resize() {
    const r = host.getBoundingClientRect();
    W = r.width; H = r.height; dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    if (W === lastW && H === lastH) return;              // no real change in size
    lastW = W; lastH = H;
    cx = W / 2; cy = H / 2; R = Math.max(110, Math.min(W - 40, H - 40) / 2 * .94);
    dirty = true;
    computeLayout();
    // a resize re-lays the ring at once; only the very first layout blooms out from the hub
    if (performance.now() - mountedAt > 1500) for (const f of files) { f.x = f.tx; f.y = f.ty; }
  }
  let lastW = -1, lastH = -1;
  const mountedAt = performance.now();
  const ro = new ResizeObserver(resize); ro.observe(host);

  function donut(r0, r1, a0, a1) {
    ctx.beginPath();
    ctx.arc(cx, cy, r1, a0, a1);
    ctx.arc(cx, cy, r0, a1, a0, true);
    ctx.closePath();
  }

  function hexLattice() {
    honeycomb(ctx, W, H, 24, cx, cy);
    const g = ctx.createRadialGradient(cx, cy, R * .2, cx, cy, Math.max(W, H) * .7);
    g.addColorStop(0, rgba(lattice, .09)); g.addColorStop(1, rgba(lattice, .015));
    ctx.strokeStyle = g; ctx.lineWidth = 1; ctx.stroke();
  }

  const lit = f => {
    if (hits) return hits.has(f.file);
    if (hoverBand) return f.gi === hoverBand.gi && (!hoverBand.area || f.area === hoverBand.area);
    return true;
  };

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!layout) return;
    hexLattice();
    const L = layout;
    // glow under the ring
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    halo.addColorStop(0, rgba(colors[0], .1)); halo.addColorStop(.5, rgba(colors[0], .03)); halo.addColorStop(1, rgba(colors[0], 0));
    ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
    // faint guide circles for the zones
    ctx.strokeStyle = rgba(bright, .05); ctx.lineWidth = 1;
    for (const r of [L.rZ0 - L.dr * 1.7, L.rD0 - L.dr * 2]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    // bands
    groups.forEach((g, gi) => {
      const c = colors[g.color % colors.length];
      const on = hoverBand?.gi === gi && !hoverBand.area, dimmed = (hoverBand && hoverBand.gi !== gi) || (focus !== null && focus !== gi);
      donut(L.rP0, L.rP1, L.ps[gi].a0, L.ps[gi].a1);
      ctx.fillStyle = rgba(c, dimmed ? .25 : on ? 1 : .75);
      ctx.shadowColor = rgba(c, .8); ctx.shadowBlur = on ? 18 : 0;
      ctx.fill(); ctx.shadowBlur = 0;
      for (const a of g.areas) {
        if (!a.span) continue;
        donut(L.rA0, L.rA1, a.span.a0, a.span.a1);
        ctx.fillStyle = rgba(c, hoverBand?.gi === gi && hoverBand.area === a.name ? 1 : dimmed ? .2 : .5);
        ctx.fill();
      }
    });
    // dots
    moving = false;
    for (const f of files) {
      f.x += (f.tx - f.x) * .14; f.y += (f.ty - f.y) * .14;
      if (Math.abs(f.tx - f.x) + Math.abs(f.ty - f.y) > .05) moving = true;
      if (focus !== null && f.gi !== focus && Math.hypot(f.x - cx, f.y - cy) < layout.rP0) continue;   // folded into the hub
      const c = colors[groups[f.gi].color % colors.length];
      const on = lit(f), r = L.dr * (f === hover || f === selected ? 1.5 : 1);
      ctx.globalAlpha = on ? (f.isNew ? 1 : .78) : .12;
      if (f.isNew && on) { ctx.shadowColor = rgba(c, .9); ctx.shadowBlur = 8 + Math.sin(t * 2 + f.ta * 5) * 3; }
      ctx.fillStyle = rgba(c, 1);
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (f.loose) { ctx.strokeStyle = rgba(colors[2], on ? 1 : .3); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(f.x, f.y, r + 3, 0, Math.PI * 2); ctx.stroke(); }   // saved in the wrong place
      if (f === selected) { ctx.strokeStyle = rgba(bright, .9); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(f.x, f.y, r + 4, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    // hub
    const hr = L.rP0 - 8;
    const hg = ctx.createRadialGradient(cx, cy - hr * .3, 0, cx, cy, hr);
    hg.addColorStop(0, rgba(colors[0], .16)); hg.addColorStop(1, rgba(colors[0], .03));
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(cx, cy, hr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba(colors[0], .35); ctx.lineWidth = 1; ctx.stroke();
    let big = focus !== null ? groups[focus].files.length : files.length, small = focus !== null ? groups[focus].name : noun === 'files' ? 'files Jade knows' : noun;
    if (hoverBand) {
      const g = groups[hoverBand.gi];
      big = hoverBand.area ? g.areas.find(a => a.name === hoverBand.area).files.length : g.files.length;
      small = hoverBand.area ? `${g.name} · ${hoverBand.area}` : g.name;
    } else if (hits) { big = hits.size; small = 'matching ' + noun; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(bright, 1);
    ctx.font = `300 ${Math.max(22, hr * .62)}px Fraunces, Georgia, serif`;
    ctx.fillText(String(big), cx, cy - hr * .1);
    ctx.fillStyle = rgba(colors[4], 1);
    ctx.font = `500 ${Math.max(9, Math.min(11.5, hr * .13))}px "Geist Mono", monospace`;
    const label = small.length > 26 ? small.slice(0, 25) + '…' : small;
    ctx.fillText(label.toUpperCase(), cx, cy + hr * .38);
  }

  function loop() {
    cancelAnimationFrame(raf);
    if (!canvas.isConnected) return;
    raf = requestAnimationFrame(now => {
      if (dirty || moving || (hasNew && now - lastDraw >= PULSE_MS)) { t += Math.min(.1, (now - lastDraw) / 1000); lastDraw = now; dirty = false; draw(); }
      loop();
    });
  }

  // ---- interaction
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const angleIn = (a, s) => { const tau = Math.PI * 2; let x = ((a - s.a0) % tau + tau) % tau; return x <= ((s.a1 - s.a0) % tau + tau) % tau; };
  function bandAt(x, y) {
    if (!layout) return null;
    const d = Math.hypot(x - cx, y - cy), a = Math.atan2(y - cy, x - cx);
    if (d < layout.rP0 - 8) return { hub: true };
    if (d < layout.rP0 || d > layout.rA1 + 3) return null;
    const gi = layout.ps.findIndex(s => angleIn(a, s));
    if (gi < 0) return null;
    if (d >= layout.rA0 - 2) { const ar = groups[gi].areas.find(x => x.span && angleIn(a, x.span)); return { gi, area: ar?.name }; }
    return { gi };
  }
  function dotAt(x, y) {
    let best = null, bd = 12;
    for (const f of files) { const d = Math.hypot(f.x - x, f.y - y); if (d < bd) { best = f; bd = d; } }
    return best;
  }
  function showTip(text, sub, x, y) {
    tip.hidden = false;
    tip.innerHTML = '<b></b><div class="g"></div>';
    tip.querySelector('b').textContent = text;
    tip.querySelector('.g').textContent = sub;
    tip.style.left = Math.min(W - 260, x + 14) + 'px'; tip.style.top = Math.min(H - 70, y + 14) + 'px';
  }
  canvas.addEventListener('pointermove', e => {
    dirty = true;
    const [x, y] = pos(e);
    const b = bandAt(x, y);
    hoverBand = b && !b.hub ? b : null;
    hover = hoverBand ? null : dotAt(x, y);
    canvas.style.cursor = hover || hoverBand || b?.hub ? 'pointer' : 'default';
    if (hover) showTip(hover.title, `${groups[hover.gi].name} · ${hover.area} · ${hover.age === 0 ? 'changed today' : hover.age === 1 ? 'changed yesterday' : `changed ${hover.age} days ago`}${hover.loose ? ' · saved in the wrong place (not in an Output folder)' : ''}`, x, y);
    else if (b?.hub && focus !== null) showTip('Show everything', 'click the centre to go back to all files', x, y);
    else if (hoverBand) { const g = groups[hoverBand.gi]; showTip(hoverBand.area ? hoverBand.area : g.name, hoverBand.area ? `in ${g.name}` : `${g.files.length} files · click to ${focus === hoverBand.gi ? 'show everything' : 'open it up'}`, x, y); }
    else tip.hidden = true;
  });
  canvas.addEventListener('pointerleave', () => { dirty = true; hover = null; hoverBand = null; tip.hidden = true; });
  canvas.addEventListener('click', e => {
    dirty = true;
    const [x, y] = pos(e);
    const b = bandAt(x, y);
    if (b?.hub) { focus = null; computeLayout(); return; }
    if (b) { focus = focus === b.gi ? null : b.gi; computeLayout(); return; }
    const f = dotAt(x, y);
    selected = f;
    onSelect(f, f ? files.filter(o => o !== f && o.gi === f.gi && o.area === f.area).slice(0, 12) : []);
  });
  canvas.addEventListener('dblclick', e => { const f = dotAt(...pos(e)); if (f) onOpen(f); });
  const onTheme = () => { dirty = true; colors = PALETTE.map(cssColor); lattice = cssColor('--cyan'); bright = cssColor('--fg-bright'); };
  window.addEventListener('jade:theme', onTheme);

  resize();
  loop();
  return {
    groups: groups.map(g => ({ name: g.name, count: g.files.length, color: colors[g.color % colors.length], project: g.project })),
    setHits(set) { hits = set && set.size ? set : null; dirty = true; },
    focusGroup(name) { const i = groups.findIndex(g => g.name === name); focus = i < 0 || focus === i ? null : i; computeLayout(); },
    select(file) { const f = files.find(x => x.file === file); if (f) { dirty = true; selected = f; if (focus !== null && focus !== f.gi) { focus = f.gi; computeLayout(); } onSelect(f, files.filter(o => o !== f && o.gi === f.gi && o.area === f.area).slice(0, 12)); } },
    reset() { focus = null; hits = null; selected = null; dirty = true; computeLayout(); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('jade:theme', onTheme); canvas.remove(); tip.remove(); },
  };
}
