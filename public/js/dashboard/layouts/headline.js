// Headline numbers: a count with a label for each figure. The count is the number of rows that pass the figure's filter.
import { h } from '../dom.js';
import { filtered } from '../engine.js';

export default function render(section, { data, schema }) {
  return h('div', { class: 'grid g3 dash-figs' }, (section.figures || []).map(f => h('div', { class: 'card dash-fig' },
    h('div', { class: 'stat' }, h('div', { class: 'label' }, f.label), h('div', { class: 'value' }, String(filtered(f.source, f.filter, data, schema).length)),
      h('div', { class: 'sub' }, schema.sources[f.source].label)))));
}
