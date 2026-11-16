// A table of the chosen fields. A file's name, or a meeting's title, opens the file in the app's preview.
import { h, fileLink, empty } from '../dom.js';
import { select, show } from '../engine.js';

export default function render(section, { data, schema }) {
  const meta = schema.sources[section.source], rows = select(section, data, schema), cap = section.limit || 15;
  if (!rows.length) return empty();
  const cols = section.fields;
  const body = rows.slice(0, cap).map(r => h('tr', null, cols.map(c => {
    const v = show(r[c], meta.fields[c].type);
    return h('td', null, c === meta.main && r._path ? fileLink(v, r._path) : v);
  })));
  return h('div', null, h('div', { class: 'table-wrap' }, h('table', { class: 't' },
    h('thead', null, h('tr', null, cols.map(c => h('th', { scope: 'col' }, meta.fields[c].label)))), h('tbody', null, body))),
  rows.length > cap ? h('div', { class: 'tiny muted dash-more' }, `Showing ${cap} of ${rows.length}`) : null);
}
