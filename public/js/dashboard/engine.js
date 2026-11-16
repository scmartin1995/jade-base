// Choosing and ordering the rows of a section: pure functions over the specification and the data. Every number a dashboard shows
// is counted here or in a layout from the rows the server sent, never taken from the specification.
import { fileLink } from './dom.js';

/** "today", "today+14" or a date, as YYYY-MM-DD. */
export function dateValue(v, today) {
  const m = /^today(?:([+-])(\d+))?$/.exec(String(v));
  if (!m) return String(v);
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + (m[1] === '-' ? -1 : 1) * Number(m[2] || 0));
  return d.toISOString().slice(0, 10);
}
const blank = v => v === '' || v == null;
function test(row, f, meta, today) {
  const type = meta.fields[f.field]?.type, v = row[f.field];
  const val = type === 'date' ? dateValue(f.value, today) : type === 'flag' ? f.value === 'yes' : type === 'number' ? Number(f.value) : String(f.value ?? '');
  switch (f.op) {
    case 'is': return type === 'text' ? String(v).toLowerCase() === String(val).toLowerCase() : v === val;
    case 'is_not': return type === 'text' ? String(v).toLowerCase() !== String(val).toLowerCase() : v !== val;
    case 'contains': return String(v ?? '').toLowerCase().includes(String(val).toLowerCase());
    case 'before': return !blank(v) && v < val;
    case 'after': return !blank(v) && v > val;
    case 'above': return typeof v === 'number' && v > val;
    case 'below': return typeof v === 'number' && v < val;
    case 'empty': return blank(v);
    case 'not_empty': return !blank(v);
    default: return false;
  }
}
/** The rows of a source that pass every filter. */
export function filtered(source, filters, data, schema) {
  const meta = schema.sources[source], rows = data.sources[source] || [];
  return rows.filter(r => (filters || []).every(f => test(r, f, meta, data.today)));
}
const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
export function sorted(rows, sort) {
  if (!sort) return rows;
  const dir = sort.direction === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const x = a[sort.field], y = b[sort.field];
    if (blank(x) !== blank(y)) return blank(x) ? 1 : -1;   // empty values last, whichever way it sorts
    return dir * cmp(x, y);
  });
}
/** Rows chosen by a section: filter, then sort. (The limit is applied by the layout, which knows what it counts.) */
export const select = (section, data, schema) => sorted(filtered(section.source, section.filter, data, schema), section.sort);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const prettyDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d)); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1].slice(0, 3)} ${m[1]}` : String(d); };
const prettyMonth = k => { const m = /^(\d{4})-(\d{2})$/.exec(k); return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : k; };
/** A value as the words a person reads. */
export function show(value, type) {
  if (value === '' || value == null) return '';
  if (type === 'flag') return value ? 'Yes' : 'No';
  if (type === 'date') return prettyDate(value);
  return String(value);
}
/** Group rows by a field (dates by month). Groups are in order of first appearance, dates earliest first. */
export function groupRows(rows, field, meta) {
  const type = meta.fields[field].type, map = new Map();
  for (const r of rows) {
    const v = r[field];
    const key = blank(v) ? '' : type === 'date' ? String(v).slice(0, 7) : String(v);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  const label = k => (k === '' ? 'Not set' : type === 'date' ? prettyMonth(k) : type === 'flag' ? (k === 'true' ? 'Yes' : 'No') : k);
  const out = [...map].map(([key, list]) => ({ key, label: label(key), rows: list }));
  if (type === 'date') out.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.key.localeCompare(b.key)));
  return out;
}
/** One row for a list: its first field as the heading (a link to its file when it is the row's name and the row has a file), and the other fields as [label, text] pairs that are not blank. */
export function rowParts(r, fields, meta) {
  const main = fields[0] || meta.main;
  const v = show(r[main], meta.fields[main].type) || '(blank)';
  return { head: r._path && main === meta.main ? fileLink(v, r._path) : v,
    rest: fields.slice(1).map(f => [meta.fields[f].label, show(r[f], meta.fields[f].type)]).filter(x => x[1] !== '') };
}
