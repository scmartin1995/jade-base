// Recent meetings: for each one, the decisions and key points, the risks and the actions.
import { h, fileLink, empty } from '../dom.js';
import { filtered, prettyDate } from '../engine.js';

const COLS = [['decisions', 'Decisions and key points'], ['risks', 'Risks'], ['actions', 'Actions']];
const SHOWN = 8;

export default function render(section, { data, schema }) {
  const rows = filtered('meetings', section.filter, data, schema).slice(0, section.limit || 3);
  if (!rows.length) return empty('No meetings have been recorded yet.');
  return h('div', { class: 'dash-meetings' }, rows.map(m => h('div', { class: 'card dash-meeting' },
    h('div', { class: 'dash-meeting-head' }, h('span', { class: 'title' }, m._path ? fileLink(m.title, m._path) : m.title), m.date ? h('span', { class: 'tiny muted' }, prettyDate(m.date)) : null),
    h('div', { class: 'grid g3' }, COLS.map(([k, label]) => {
      const items = (m._lists || {})[k] || [], total = m[k] || 0;
      return h('div', null, h('div', { class: 'eyebrow' }, label),
        items.length ? h('ul', { class: 'dash-bullets' }, items.slice(0, SHOWN).map(x => h('li', null, x))) : h('div', { class: 'tiny muted' }, 'None recorded'),
        total > Math.min(items.length, SHOWN) ? h('div', { class: 'tiny muted' }, `and ${total - Math.min(items.length, SHOWN)} more`) : null);
    })),
    // the other kinds of item a meeting record holds (a skill added to the Transcript agent): the heading and what was kept
    (m._other || []).some(o => o.total) ? h('div', { class: 'grid g3 dash-other' }, m._other.filter(o => o.total).map(o => h('div', null, h('div', { class: 'eyebrow' }, o.heading),
      h('ul', { class: 'dash-bullets' }, o.items.slice(0, SHOWN).map(x => h('li', null, x))),
      o.total > Math.min(o.items.length, SHOWN) ? h('div', { class: 'tiny muted' }, `and ${o.total - Math.min(o.items.length, SHOWN)} more`) : null))) : null)));
}
