// The meeting record file, defined once. meetings.js writes it and dashboards.js reads it, both through this file, so the two cannot drift.
//
//   ---                                  front matter: date, project, title, attendees, transcript, checked
//   ---
//   ## <heading of a kind of item>      one section per kind of item the Transcript agent's skills produce
//   - <item line>                       one line per item the person kept (see itemLine)
//     > <the words from the transcript>   the quote, indented under the item (readers skip it)
//   _Nothing was kept here._            what an empty section says (readers skip it)
//
// The file name is "<date> <title>.md".
import path from 'node:path';
import { parseFrontmatter, stringifyFrontmatter } from './util.js';

const EMPTY = '_Nothing was kept here._';
const NAME = /^(\d{4}-\d{2}-\d{2})\s+(.*)$/;

/** The file name (without .md) of a record: the date, a space, the title. */
export const stem = (date, title) => `${date} ${title}`;

/**
 * One item as the line reads: { label?, text, details?: [], quote } -> "- **Risk:** text (impact: x; owner: y)" and the quote under it.
 * `label` is a bold word before the text, `details` the "name: value" parts in brackets after it.
 */
export function itemLine({ label = '', text, details = [], quote = '' }) {
  return `- ${label ? `**${label}:** ` : ''}${text || '(no text)'}${details.length ? ` (${details.join('; ')})` : ''}\n  > ${quote}`;
}
/** What a reader gets back for that item: the line without its dash (the quote is left out). */
export const itemText = item => itemLine(item).split('\n')[0].slice(2);

/** One section: a heading and its kept items (each as given to itemLine); an empty one says so. */
export const section = (heading, items) => `## ${heading}\n\n${items.length ? items.map(itemLine).join('\n') : EMPTY}\n`;

/** The whole record: front matter (an object) then the sections ([{ heading, items }]). */
export const format = (front, sections) => `${stringifyFrontmatter(front)}${sections.map(s => section(s.heading, s.items)).join('\n')}`;

/** Read a record: { date, title, sections: { heading: [item text] }, file }. Date and title fall back to the file name. */
export function parse(text, file = '') {
  const { data, body } = parseFrontmatter(text);
  const base = path.basename(file, '.md');
  const m = NAME.exec(base);
  const sections = {};
  let cur = null;
  for (const raw of String(body || '').split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(raw);
    if (h) { cur = h[1]; sections[cur] = sections[cur] || []; continue; }
    if (!cur || /^\s*>/.test(raw)) continue;
    const it = /^[-*]\s+(.+)$/.exec(raw);
    if (it && it[1].trim() !== EMPTY) sections[cur].push(it[1].trim());
  }
  return { date: String(data.date || m?.[1] || '').slice(0, 10), title: String(data.title || m?.[2] || base), sections, file };
}
