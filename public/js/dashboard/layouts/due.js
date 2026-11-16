// The next two weeks: open actions that fall due from today to 14 days ahead, with anything overdue first.
import { h, empty } from '../dom.js';
import { filtered, dateValue, prettyDate } from '../engine.js';

export default function render(section, { data, schema }) {
  const today = data.today, end = dateValue('today+14', today);
  const open = filtered('actions', section.filter, data, schema).filter(a => a.status !== 'done' && a.due);
  const late = open.filter(a => a.due < today).sort((a, b) => a.due.localeCompare(b.due));
  const soon = open.filter(a => a.due >= today && a.due <= end).sort((a, b) => a.due.localeCompare(b.due));
  const cap = section.limit || 30, rows = [...late.map(a => ({ a, late: true })), ...soon.map(a => ({ a, late: false }))].slice(0, cap);
  if (!rows.length) return empty('Nothing falls due in the next two weeks.');
  const item = ({ a, late: l }) => h('div', { class: 'item' }, h('div', { class: 'main-col' }, h('div', { class: 'title' }, a.text),
    h('div', { class: 'meta' }, h('span', null, `${l ? 'Was due' : 'Due'} ${prettyDate(a.due)}`), a.owner ? h('span', null, a.owner) : null)),
  l ? h('span', { class: 'chip dash-late' }, 'Overdue') : null);
  return h('div', { class: 'list' }, rows.map(item));
}
