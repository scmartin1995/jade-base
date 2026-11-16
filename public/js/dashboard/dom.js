// The only way dashboard code puts anything on the page: elements built one by one, and every value inserted as TEXT (a text node),
// never as markup. Nothing here reads innerHTML, and attributes come from an allowed list (class, role, title, aria-*, data-*, and the drawing attributes of the charts). A link may only go to an in-app
// route ("#/...") or open a project file through the app's own preview (data-preview-file).
const doc = () => globalThis.document;
const SVG = 'http://www.w3.org/2000/svg';
const ATTR = /^(class|role|title|aria-[a-z-]+|data-[a-z-]+|type|colspan|scope|viewBox|width|height|x|y|x1|x2|y1|y2|rx|dx|dy|text-anchor|preserveAspectRatio|focusable)$/;

function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'href') { if (/^#\/[A-Za-z0-9_~%./?=&-]*$/.test(String(v))) el.setAttribute('href', String(v)); continue; }   // in-app routes only
    if (ATTR.test(k)) el.setAttribute(k, String(v));
  }
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.appendChild(typeof k === 'object' ? k : doc().createTextNode(String(k)));
  }
  return el;
}
/** An HTML element: h('div', { class: 'card' }, 'text', otherElement) */
export const h = (tag, attrs, ...kids) => { const el = doc().createElement(tag); apply(el, attrs); return add(el, kids); };
/** An SVG element, the same way. */
export const s = (tag, attrs, ...kids) => { const el = doc().createElementNS(SVG, tag); apply(el, attrs); return add(el, kids); };
/** A button that opens a project file in the app's preview. */
export const fileLink = (name, path) => h('button', { type: 'button', class: 'dash-link', 'data-preview-file': path, 'data-file-name': String(path).split(/[\\/]/).pop(), title: 'Preview this file' }, name);
export const empty = (msg = 'Nothing to show here yet.') => h('div', { class: 'empty' }, msg);
