// UI helpers shared by every view: escaping, icons, markdown, dates, modals, toasts and small charts.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Lucide-style 24px stroke icons.
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checks: '<rect x="3" y="4" width="5" height="5" rx="1.5"/><path d="M11 6.5h10M11 17.5h10"/><rect x="3" y="15" width="5" height="5" rx="1.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h0a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3h0a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/><path d="M17 3v3M15.5 4.5h3"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  toggle: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clip: '<path d="M21 11.5 12.4 20.1a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  download: '<path d="M12 3v12M6 11l6 6 6-6M4 21h16"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  eye_off: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.4-1"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v6"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  arrow_left: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>',
};
export function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.spark}</svg>`;
}

// ---------------- markdown (escaped first, then a safe subset)
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|#[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}
export function md(src) {
  const lines = esc(src || '').split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push(`<pre><code>${buf.join('\n')}</code></pre>`); continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^&gt;\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^&gt;\s?/, ''));
      out.push(`<blockquote>${inline(buf.join('<br>'))}</blockquote>`); continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
      const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
      const head = row(l); i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let t = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const box = /^\[( |x)\]\s+/i.exec(t);
        if (box) t = `<input type="checkbox" disabled ${box[1].toLowerCase() === 'x' ? 'checked' : ''}> ` + t.slice(box[0].length);
        items.push(`<li>${inline(t)}</li>`); i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) { items[items.length - 1] = items[items.length - 1].replace('</li>', ' ' + inline(lines[i].trim()) + '</li>'); i++; }
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`); continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*+]|\d+[.)])\s+|&gt;|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join('<br>'))}</p>`);
  }
  return out.join('\n');
}
export const plain = s => String(s || '').replace(/```[\s\S]*?```/g, '').replace(/[#*_`>|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\n{2,}/g, '\n').trim();

// ---------------- dates
export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return 'in ' + until(iso);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function until(iso) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s < 3600) return Math.ceil(s / 60) + 'm';
  if (s < 86400) return Math.ceil(s / 3600) + 'h';
  return Math.ceil(s / 86400) + 'd';
}
export const todayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function daysUntil(date) {
  if (!date) return null;
  const a = new Date(todayStr() + 'T00:00:00'), b = new Date(String(date).slice(0, 10) + 'T00:00:00');
  return Math.round((b - a) / 864e5);
}
export function fmtDate(date, opts = { month: 'short', day: 'numeric' }) {
  if (!date) return '';
  const d = new Date(String(date).length <= 10 ? date + 'T00:00:00' : date);
  return isNaN(d) ? String(date) : d.toLocaleDateString(undefined, opts);
}
export function dueLabel(date) {
  const n = daysUntil(date);
  if (n === null) return '';
  if (n < 0) return `${-n}d overdue`;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n < 7) return fmtDate(date, { weekday: 'short' });
  return fmtDate(date);
}

// ---------------- components

// ---------------- seeded randomness for generative art (stable per id)
function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}

/**
 * Jade's world: a dark sky, a soft silhouette of jade mountains at the horizon, and a perspective hex-grid floor that
 * runs from your feet to the mountains. The vanishing point sits under Jade's core (vx), so the core stands on the grid.
 */
export function landscape(seed = 'jade', { vx = .72 } = {}) {
  const W = 1440, H = 460, HY = 268;                 // horizon line
  const r = rng(seed);
  const VX = W * vx;

  // mountains: three soft layers that sit on the horizon, cooler and hazier with distance
  const ridge = (base, amp, i) => {
    let d = `M0,${HY + 2}`;
    const phase = r() * 10;
    for (let xv = 0; xv <= W + 24; xv += 24) {
      const yv = base - amp * Math.max(0, Math.sin(xv / (210 + i * 70) + phase) * .55 + Math.sin(xv / (90 + i * 21) + phase * 2.1) * .3 + .35) - r() * 4;
      d += ` L${xv},${Math.min(HY, yv).toFixed(1)}`;
    }
    return d + ` L${W},${HY + 2} Z`;
  };
  const mountains = [
    { base: HY - 20, amp: 130, fill: 'color-mix(in srgb, var(--accent) 22%, var(--bg-2))', op: .55 },
    { base: HY - 8, amp: 92, fill: 'color-mix(in srgb, var(--accent) 30%, var(--bg-3))', op: .75 },
    { base: HY, amp: 52, fill: 'color-mix(in srgb, var(--accent) 16%, var(--bg-3))', op: .95 },
  ];

  // hex floor: a honeycomb lying on the ground, seen in perspective. Each hexagon draws only its far three edges, so
  // neighbours share edges and nothing is drawn twice. Lines fade toward the horizon, the sides and the near edge.
  const k = 520, camH = 1;
  const proj = (x, z) => [VX + (x * k) / z, HY + (camH * k) / z];
  const s = .62, rowH = s * Math.sqrt(3), zNear = 1.9, zFar = 24;
  const buckets = Array.from({ length: 6 }, () => []);
  for (let c = -40; c <= 40; c++) {                            // columns of flat-top hexagons, pitch 1.5 s
    const x = c * 1.5 * s, shift = (c & 1) ? rowH / 2 : 0;
    for (let r = 0; r < 60; r++) {
      const z = zNear + r * rowH + shift;
      if (z > zFar) break;
      const [sx] = proj(x, z);
      if (sx < -80 || sx > W + 80) continue;
      const depth = 1 - (z - zNear) / (zFar - zNear);           // 1 near us, 0 at the horizon
      const nearFade = Math.min(1, (z - zNear) / 2.2);           // the big hexagons right in front stay soft
      const lateral = Math.max(0, 1 - Math.abs(sx - VX) / (W * .6));
      const v = depth * depth * nearFade * (.3 + .7 * lateral);
      if (v < .04) continue;
      const P = a => proj(x + s * Math.cos(a), z + s * Math.sin(a)).map(n => n.toFixed(1)).join(',');
      buckets[Math.min(5, Math.floor(v * 6))].push(`M${P(Math.PI)}L${P(Math.PI * 2 / 3)}L${P(Math.PI / 3)}L${P(0)}`);
    }
  }

  return `<svg class="land" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--bg-3)"/>
        <stop offset=".55" stop-color="color-mix(in srgb, var(--accent) 10%, var(--bg-3))"/>
        <stop offset="1" stop-color="color-mix(in srgb, var(--cyan) 12%, var(--bg-2))"/>
      </linearGradient>
      <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="color-mix(in srgb, var(--cyan) 10%, var(--bg-2))"/>
        <stop offset="1" stop-color="var(--bg-3)"/>
      </linearGradient>
      <radialGradient id="pool" cx="${(VX / W).toFixed(3)}" cy=".72" r=".42"><stop offset="0" stop-color="var(--cyan)" stop-opacity=".18"/><stop offset="1" stop-color="var(--cyan)" stop-opacity="0"/></radialGradient>
      <linearGradient id="horizon" x1="0" x2="1"><stop offset="0" stop-color="var(--cyan)" stop-opacity="0"/><stop offset="${(VX / W).toFixed(3)}" stop-color="var(--cyan)" stop-opacity=".75"/><stop offset="1" stop-color="var(--cyan)" stop-opacity="0"/></linearGradient>
      <filter id="haze"><feGaussianBlur stdDeviation="14"/></filter>
      <linearGradient id="fadeb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--bg-3)" stop-opacity="0"/><stop offset="1" stop-color="var(--bg-3)"/></linearGradient>
    </defs>
    <rect width="${W}" height="${HY}" fill="url(#sky)"/>
    ${mountains.map((m, i) => `<path class="ridge" d="${ridge(m.base, m.amp, i)}" fill="${m.fill}" opacity="${m.op}"/>`).join('')}
    <rect x="0" y="${HY - 30}" width="${W}" height="40" fill="var(--cyan)" opacity=".05" filter="url(#haze)"/>
    <rect y="${HY}" width="${W}" height="${H - HY}" fill="url(#floor)"/>
    ${buckets.map((b, i) => b.length ? `<path d="${b.join('')}" fill="none" stroke="var(--cyan)" stroke-width="${(.6 + i * .12).toFixed(2)}" stroke-opacity="${(.05 + i * .085).toFixed(3)}"/>` : '').join('')}
    <rect width="${W}" height="${H}" fill="url(#pool)"/>
    <rect y="${HY - .5}" width="${W}" height="1.2" fill="url(#horizon)"/>
    <rect y="${H - 90}" width="${W}" height="90" fill="url(#fadeb)"/>
  </svg>`;
}

// ---------------- toasts & modals
export function toast(text, kind = 'info', ms = 3800, onClick) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'spark', 16)}<span>${esc(text)}</span>`;
  if (onClick) { el.style.cursor = 'pointer'; el.onclick = () => { onClick(); el.remove(); }; }
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
}

// `body` is raw HTML: the caller must run every value it puts in through esc() (title and button labels are escaped here).
export function modal({ title, body, wide = false, actions = [], onMount }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost icon" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
      ${actions.length ? `<div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.kind || ''}" data-i="${i}">${a.icon ? icon(a.icon, 16) : ''}${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>`;
    const close = v => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
    wrap.querySelector('[data-close]').onclick = () => close(null);
    wrap.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => {
      const a = actions[+b.dataset.i];
      const form = wrap.querySelector('form');
      const data = form ? Object.fromEntries(new FormData(form)) : {};
      if (a.onClick) { const r = await a.onClick(data, wrap); if (r === false) return; close(r ?? data); } else close(a.value ?? data);
    });
    const f = wrap.querySelector('form');
    if (f) f.addEventListener('submit', e => { e.preventDefault(); wrap.querySelector('.modal-foot .primary')?.click(); });
    document.body.appendChild(wrap);
    onMount?.(wrap, close);
    setTimeout(() => (wrap.querySelector('[autofocus]') || wrap.querySelector('input, textarea, select'))?.focus(), 30);
  });
}

/**
 * Ticking something off: ask for a note on how it went (optional; Enter or "Done" saves, an empty note is fine).
 * Resolves to the note ('' for none), or null if they closed it, in which case nothing is ticked.
 */
export async function doneNote(text) {
  const shown = String(text || '').length > 150 ? String(text).slice(0, 147) + '…' : String(text || '');
  const r = await modal({
    title: 'Done',
    body: `<form><p class="small" style="color:var(--fg-soft);margin:0 0 14px">“${esc(shown)}”</p>
      <label class="field">Add a note <small>optional: what happened, what's left, who to tell</small><textarea name="note" rows="3" autofocus placeholder="e.g. Sent to the client; waiting on their sign-off by Friday"></textarea></label></form>`,
    actions: [{ label: 'Cancel', kind: 'ghost', value: null }, { label: 'Done', kind: 'primary', icon: 'check', onClick: d => ({ note: String(d.note || '').trim() }) }],
    onMount: wrap => {
      // Enter saves (Shift+Enter for a new line), the way the chat box works
      const ta = wrap.querySelector('textarea');
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); wrap.querySelector('.modal-foot .primary').click(); } });
    },
  });
  return r && typeof r === 'object' ? r.note : null;
}

export async function confirmBox(title, text, label = 'Confirm', kind = 'primary') {
  const r = await modal({ title, body: `<p class="dim">${esc(text)}</p>`, actions: [{ label: 'Cancel', kind: 'ghost', value: false }, { label, kind, value: true }] });
  return r === true;
}

export function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Copied', 'success', 1600), () => toast('Copy failed', 'error'));
}

export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Ask for a folder the friendly way: open the computer's own folder dialog (Explorer / Finder / the desktop's chooser).
 * If this computer has none, fall back to Jade's built-in folder browser. Resolves to "~/…" or null.
 */
export async function chooseFolder(api, { title = 'Choose a folder for Jade', start = '~' } = {}) {
  toast('Opening your folder picker…', 'info', 2500);
  try {
    const r = await api('POST', '/api/fs/choose', { title, start });
    if (r.path) return r.path;
    if (r.cancelled) return null;
  } catch {}
  return pickFolder(api, { title, start });
}

/** A folder picker that browses this computer through the Jade server. Resolves to a path like "~/Documents/Apollo", or null. */
export function pickFolder(api, { title = 'Choose a folder', start = '~', confirm = 'Choose this folder' } = {}) {
  return new Promise(resolve => {
    let current = null;
    modal({
      title, wide: true,
      body: `<div class="fp-shortcuts"></div><div class="fp-path"></div><div class="fp-list" role="listbox" aria-label="Folders"></div><div class="fp-meta tiny muted"></div>`,
      actions: [{ label: 'Cancel', kind: 'ghost', value: null }, { label: confirm, kind: 'primary', icon: 'check', onClick: () => current?.display || null }],
      onMount: wrap => {
        const $ = s => wrap.querySelector(s);
        const open = async p => {
          $('.fp-list').innerHTML = '<div class="empty">Loading…</div>';
          try { current = await api('GET', `/api/fs/dirs?path=${encodeURIComponent(p)}`); }
          catch (e) { $('.fp-list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
          $('.fp-shortcuts').innerHTML = current.shortcuts.map(s => `<button type="button" class="chip ${s.path === current.path ? 'on' : ''}" data-p="${esc(s.path)}">${icon('folder', 12)}${esc(s.name)}</button>`).join('');
          // breadcrumb: each part of the path is clickable
          const parts = current.display.split(/[\\/]/).filter(Boolean);
          let acc = current.display.startsWith('~') ? '' : (current.sep === '/' ? '' : '');
          $('.fp-path').innerHTML = parts.map((part, i) => {
            acc = i === 0 ? (current.display.startsWith('/') ? '/' + part : part) : acc + current.sep + part;
            return `<button type="button" data-p="${esc(acc)}">${esc(part)}</button>`;
          }).join(`<span>${esc(current.sep)}</span>`);
          $('.fp-list').innerHTML = (current.parent ? `<button type="button" class="fp-row up" data-p="${esc(current.parent)}">${icon('arrow_left', 15)}<span>Up one level</span></button>` : '')
            + (current.dirs.map(d => `<button type="button" class="fp-row" data-p="${esc(d.path)}">${icon('folder', 15)}<span>${esc(d.name)}</span></button>`).join('') || '<div class="empty">No folders inside. You can still choose this one.</div>');
          $('.fp-meta').textContent = `${current.display} · ${current.notes} document${current.notes === 1 ? '' : 's'} in this folder (sub-folders are read too)${current.more ? ' · only the first 500 folders are shown' : ''}`;
          wrap.querySelectorAll('[data-p]').forEach(b => b.onclick = () => open(b.dataset.p));
        };
        open(start);
      },
    }).then(resolve);
  });
}

/**
 * "Ask Jade" for anything Jade surfaces: opens a fresh chat with the item's own content in the first message, so Jade
 * has it in front of her even if memory search would miss it. Clicks are handled once, in app.js, by delegation.
 */
export function askBtn(prompt, { label = 'Ask Jade', small = true, ghost = true, iconOnly = false } = {}) {
  return `<button type="button" class="btn ${small ? 'sm' : ''} ${ghost ? 'ghost' : ''} ${iconOnly ? 'icon' : ''} ask-jade" data-ask-jade="${esc(prompt)}" title="${esc(iconOnly ? 'Ask Jade about this' : 'Open a chat with Jade about this')}" aria-label="Ask Jade about this">${icon('spark', 13)}${iconOnly ? '' : esc(label)}</button>`;
}
/** The first message of such a chat: what it is, the content, and an opening question. */
export function askPrompt(kind, title, body, question = 'What should I do about this?') {
  const b = plain(String(body || '')).slice(0, 1800);
  return `${kind}: ${title}${b ? `\n\n${b}` : ''}\n\n${question}`;
}

// ---------------- files
const KIND_ICON = { note: 'pen', text: 'doc', document: 'doc', spreadsheet: 'grid', slides: 'doc', pdf: 'doc', image: 'bookmark', data: 'cpu', plan: 'calendar', diagram: 'grid', archive: 'folder', email: 'mail', calendar: 'calendar', file: 'doc' };
const KIND_LABEL = { note: 'Note', text: 'Text', document: 'Document', spreadsheet: 'Spreadsheet', slides: 'Slides', pdf: 'PDF', image: 'Image', data: 'Data', plan: 'Plan', diagram: 'Diagram', archive: 'Archive', email: 'Email', calendar: 'Calendar', file: 'File' };
export function fmtSize(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
/** One file in a list: icon, name, where it lives, Open and Show-in-folder (handled by delegation in app.js). */
export function fileRow(f, { compact = false, showProject = true } = {}) {
  const textish = ['note', 'text'].includes(f.kind);
  const where = [showProject && f.projectName ? f.projectName : '', KIND_LABEL[f.kind] || 'File', compact ? '' : f.display.replace(/[\\/][^\\/]*$/, '')].filter(Boolean).join(' · ');
  return `<div class="item file-row ${compact ? 'compact' : ''}" data-preview-file="${esc(f.path)}" data-file-name="${esc(f.name)}" title="Preview ${esc(f.name)}">
    <span class="file-ico">${icon(KIND_ICON[f.kind] || 'doc', 15)}</span>
    <div class="main-col"><div class="title ellipsis">${esc(f.name)}</div><div class="meta"><span class="ellipsis">${esc(where)}</span><span>${esc(ago(new Date(f.mtime).toISOString()))}</span>${compact ? '' : `<span>${esc(fmtSize(f.size))}</span>`}</div></div>
    <span class="file-acts">${textish ? askBtn(`File: ${f.name} (${f.display})\n\nRead this file and tell me the key points and anything I should act on.`, { iconOnly: true }) : ''}
      <button type="button" class="btn sm ghost icon" data-reveal-file="${esc(f.path)}" title="Show in folder" aria-label="Show in folder">${icon('folder', 14)}</button>
      <button type="button" class="btn sm ghost icon" data-open-file="${esc(f.path)}" title="Open" aria-label="Open">${icon('external', 14)}</button></span>
  </div>`;
}

/**
 * The files a reply created or changed, as a list: what happened to each (new, edited, changed by a command), where it
 * is, and the buttons to look at it, find it in its folder, or put the earlier version back. Handled by delegation in app.js.
 * list: [{ path, name, isNew, change?, byCommand? }]
 */
export function touchedList(list = [], { live = false, imagesDeleted = 0, title = '' } = {}) {
  if (!list.length && !imagesDeleted) return '';
  const where = p => { const parts = String(p).split(/[\\/]/).filter(Boolean); parts.pop(); return parts.slice(-2).join(' / '); };
  const row = f => `<div class="touched-row" data-preview-file="${esc(f.path)}" data-file-name="${esc(f.name)}" title="${esc(f.path)}">
      <span class="touched-tag ${f.isNew ? 'new' : f.byCommand ? 'cmd' : 'edit'}">${f.isNew ? 'New' : f.byCommand ? 'Changed' : 'Edited'}</span>
      <span class="touched-name">${esc(f.name)}</span><span class="touched-where">${esc(where(f.path))}</span>
      <span class="touched-acts">
        <button type="button" class="btn sm ghost icon" data-reveal-file="${esc(f.path)}" title="Show in folder" aria-label="Show in folder">${icon('folder', 13)}</button>
        ${f.change ? `<button type="button" class="btn sm ghost" data-undo-change="${esc(f.change)}" data-undo-name="${esc(f.name)}" title="Put back the version from before this reply">${icon('refresh', 12)}Undo</button>` : ''}
      </span></div>`;
  return `<div class="touched${live ? ' live' : ''}">
    ${list.length ? `<div class="touched-head">${icon('edit', 13)}<b>${title || (live ? 'Working on' : 'Changed in this reply')}</b><span>${list.length} file${list.length === 1 ? '' : 's'}</span></div>${list.map(row).join('')}` : ''}
    ${imagesDeleted ? `<div class="touched-note">${icon('check', 12)}${imagesDeleted === 1 ? 'The picture you pasted was' : `${imagesDeleted} pictures you pasted were`} deleted once what ${imagesDeleted === 1 ? 'it' : 'they'} showed was written into a file.</div>` : ''}
  </div>`;
}

const AGENT_STATE = { running: 'Working', done: 'Done', failed: 'Failed', stopped: 'Stopped', background: 'Launched in the background' };
/** The files a conversation's replies changed: one row per file, the latest change record for it, the most recently changed first. */
export function latestFiles(turns = []) {
  const m = new Map();
  for (const t of turns) for (const f of t.touched || []) { m.delete(f.path); m.set(f.path, f); }
  return [...m.values()].reverse();
}
/** The reply in progress first, then what earlier replies changed, one row per file. */
export function mergeFiles(live = [], past = []) {
  const seen = new Set();
  return [...(live || []), ...(past || [])].filter(f => !seen.has(f.path) && seen.add(f.path)).slice(0, 60);
}
const secsOf = (a, now = Date.now()) => Math.max(0, Math.round(((a.endedAt || now) - (a.startedAt || now)) / 1000));
/**
 * The chat's side panel, as Claude Code shows its sub-agent work: each hand-off to a sub-agent as a card (what it was asked, its
 * state, its steps while it runs, what it reported), then the files changed in this conversation.
 * agents: [{ id, type, description, status, steps, tools?, result?, startedAt, endedAt? }]  files: touched files  open: ids of expanded cards
 */
export function sidePanel({ agents = [], files = [], open = [], earlier = false } = {}) {
  const card = a => {
    const live = a.status === 'running';
    const isOpen = open.includes(a.id);
    const steps = (a.tools || []).slice(-8);
    return `<div class="sp-card ${esc(a.status)}${isOpen ? ' open' : ''}">
      <button type="button" class="sp-card-head" data-agent-card="${esc(a.id)}" aria-expanded="${isOpen}">
        <span class="sp-dot ${esc(a.status)}">${live ? icon('refresh', 11) : a.status === 'done' ? icon('check', 11) : a.status === 'background' ? icon('cpu', 11) : icon('x', 11)}</span>
        <span class="sp-main"><b>${esc(a.type)}</b><span>${esc(a.description || '')}</span></span>
      </button>
      <div class="sp-meta"><span>${esc(AGENT_STATE[a.status] || a.status)}</span><span>${Number(a.steps) || 0} ${a.steps === 1 ? 'step' : 'steps'}</span>${a.status === 'background' ? '' : `<span ${live ? `data-since="${Number(a.startedAt) || 0}"` : ''}>${secsOf(a)}s</span>`}</div>
      ${isOpen ? `<div class="sp-body">${steps.length ? `<div class="sp-steps">${steps.map(t => `<div><b>${esc(t.name)}</b> ${esc(String(t.detail || '').replace(/^.*[\\/]/, ''))}</div>`).join('')}</div>` : ''}
        ${a.result ? `<div class="sp-result">${esc(a.result)}</div>` : live ? '<div class="sp-result muted">Waiting for its report…</div>' : ''}</div>` : ''}
    </div>`;
  };
  const running = agents.filter(a => a.status === 'running').length;
  const ids = new Set(agents.map(a => a.id));
  const tree = a => card(a) + agents.filter(c => c.parent === a.id).map(c => `<div class="sp-nested">${tree(c)}</div>`).join('');
  return `${agents.length ? `<div class="sp-sec"><div class="sp-title">Sub-agents <span>${running ? `${running} working` : earlier ? 'last reply' : `${agents.length} in this reply`}</span></div>${agents.filter(a => !a.parent || !ids.has(a.parent)).map(tree).join('')}</div>` : ''}
    ${files.length ? `<div class="sp-sec">${touchedList(files, { title: 'Files changed in this chat' })}</div>` : ''}
    ${!agents.length && !files.length ? '<div class="sp-empty">Nothing here yet.<br>Sub-agent work and files Jade changes show up here as they happen.</div>' : ''}`;
}

/**
 * Preview a file inside Jade: HTML and PDFs in a sandboxed frame, images inline, documents as extracted text,
 * Markdown rendered. Anything else, or the "Open in app" button, hands the file to the computer's own program.
 */
export async function previewFile(api, filePath, name = filePath.split(/[\\/]/).pop()) {
  const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  const raw = `/api/files/raw?path=${encodeURIComponent(filePath)}`;
  const head = `<div class="row" style="margin-bottom:12px;gap:8px"><span class="tiny muted mono grow ellipsis">${esc(filePath)}</span>
    <button class="btn sm" data-reveal-file="${esc(filePath)}">${icon('folder', 13)}Show in folder</button>
    <button class="btn sm primary" data-open-file="${esc(filePath)}">${icon('external', 13)}Open in app</button></div>`;
  let body;
  if (['.html', '.htm'].includes(ext)) body = `<iframe class="preview-frame" src="${raw}" sandbox="allow-scripts" title="${esc(name)}"></iframe>`;
  else if (ext === '.pdf') body = `<iframe class="preview-frame" src="${raw}" title="${esc(name)}"></iframe>`;
  else if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) body = `<div class="preview-img"><img src="${raw}" alt="${esc(name)}"></div>`;
  else {
    try {
      const r = await api('GET', `/api/files/text?path=${encodeURIComponent(filePath)}`);
      body = ['.md', '.markdown'].includes(ext) ? `<article class="md">${md(r.text.replace(/^---[\s\S]*?---\s*/, ''))}</article>` : `<pre class="preview-text">${esc(r.text)}</pre>`;
    } catch {
      // nothing to show inline: open it the normal way
      return api('POST', '/api/fs/open', { path: filePath }).then(() => toast('Opening ' + name, 'info', 1600)).catch(e => toast(e.message, 'error'));
    }
  }
  return modal({ title: name, wide: true, body: head + body });
}

export function projectOptions(projects, selected = '', empty = 'No project') {
  return `<option value="">${esc(empty)}</option>` + projects.filter(p => !p.archived).map(p => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}
