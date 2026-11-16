// A list under headings: rows grouped by one field.
import { h, empty } from '../dom.js';
import { select, rowParts, groupRows } from '../engine.js';

export default function render(section, { data, schema }) {
  const meta = schema.sources[section.source], rows = select(section, data, schema).slice(0, section.limit || 30);
  if (!rows.length) return empty();
  const fields = (section.fields && section.fields.length ? section.fields : [meta.main]).filter(f => f !== section.group || section.fields?.length === 1);
  return h('div', { class: 'dash-groups' }, groupRows(rows, section.group, meta).map(g => h('div', { class: 'dash-group' },
    h('div', { class: 'dash-group-head' }, h('span', { class: 'title' }, g.label), h('span', { class: 'chip' }, String(g.rows.length))),
    h('div', { class: 'list' }, g.rows.map(r => {
      const { head, rest } = rowParts(r, fields, meta);
      return h('div', { class: 'item' }, h('div', { class: 'main-col' }, h('div', { class: 'title' }, head),
        rest.length ? h('div', { class: 'meta' }, rest.map(([l, x]) => h('span', null, `${l}: ${x}`))) : null));
    })))));
}
