// Things in date order along a line. Rows with no date are left out, and a line says how many.
import { h, empty } from '../dom.js';
import { filtered, sorted, rowParts, prettyDate } from '../engine.js';

export default function render(section, { data, schema }) {
  const meta = schema.sources[section.source], f = section.group;
  const all = filtered(section.source, section.filter, data, schema);
  const dated = sorted(all.filter(r => r[f]), { field: f, direction: 'asc' }).slice(0, section.limit || 20);
  if (!dated.length) return empty();
  const fields = section.fields && section.fields.length ? section.fields : [meta.main];
  const undated = all.length - all.filter(r => r[f]).length;
  return h('div', null, h('div', { class: 'dash-timeline' }, dated.map(r => {
    const { head, rest } = rowParts(r, fields, meta);
    return h('div', { class: 'dash-tl-row' }, h('div', { class: 'dash-tl-date' }, prettyDate(r[f])), h('div', { class: 'dash-tl-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'dash-tl-body' }, h('div', { class: 'title' }, head), rest.length ? h('div', { class: 'meta' }, rest.map(x => x[1]).join(' · ')) : null));
  })), undated ? h('div', { class: 'tiny muted dash-more' }, `${undated} without a ${meta.fields[f].label.toLowerCase()} left out`) : null);
}
