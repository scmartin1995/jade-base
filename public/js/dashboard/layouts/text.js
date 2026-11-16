// A plain text block: the model's own words, shown as text, one paragraph per blank line. Never markup.
import { h } from '../dom.js';
export const usesNote = true;   // the note IS the block, so the page does not show it again underneath

export default function render(section) {
  return h('div', { class: 'dash-text' }, String(section.note || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => h('p', null, p)));
}
