// A bar chart of counts: one bar per value of a field, as long as the number of rows with that value. Plain SVG.
import { h, s, empty } from '../dom.js';
import { filtered, groupRows } from '../engine.js';

const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

export default function render(section, { data, schema }) {
  const meta = schema.sources[section.source];
  const groups = groupRows(filtered(section.source, section.filter, data, schema), section.group, meta)
    .sort((a, b) => b.rows.length - a.rows.length).slice(0, section.limit || 8);
  if (!groups.length) return empty();
  const max = Math.max(...groups.map(g => g.rows.length)), rowH = 30, left = 170, right = 44, plot = 420, W = left + plot + right;
  const bars = groups.map((g, i) => {
    const y = i * rowH, w = Math.max(2, Math.round(g.rows.length / max * plot));
    return s('g', null,
      s('title', null, `${g.label}: ${g.rows.length}`),
      s('text', { x: left - 8, y: y + 19, 'text-anchor': 'end', class: 'dash-bar-label' }, clip(g.label, 26)),
      s('rect', { x: left, y: y + 5, width: w, height: 18, rx: 3, class: 'dash-bar' }),
      s('text', { x: left + w + 6, y: y + 19, class: 'dash-bar-num' }, String(g.rows.length)));
  });
  return h('div', { class: 'dash-chart' }, s('svg', { viewBox: `0 0 ${W} ${groups.length * rowH}`, width: '100%', role: 'img', 'aria-label': `${schema.sources[section.source].label} by ${meta.fields[section.group].label}`, focusable: 'false' }, bars));
}
