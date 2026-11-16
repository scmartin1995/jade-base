// Draws a dashboard: the saved specification plus fresh data from the server. Each section is drawn by one renderer file in
// layouts/<layout>.js; the specification has already been checked by the server, and the layout name is checked against its list
// again here before it is used to load a file.
import { h, empty } from './dom.js';

const defaultLoad = id => import(`./layouts/${id}.js`);

export async function renderDashboard(spec, data, schema, { load = defaultLoad } = {}) {
  const sections = [];
  for (const section of spec.sections) {
    let body;
    try {
      if (!Object.hasOwn(schema.layouts, section.layout) || !/^[a-z]+$/.test(section.layout)) throw new Error('unknown layout');
      const mod = await load(section.layout);
      body = [mod.default(section, { data, schema }), mod.usesNote ? null : (section.note ? h('p', { class: 'small muted dash-note' }, section.note) : null)];
    } catch (e) {
      // say so on the page (with the reason, for whoever helps) and in the console; never a silent blank
      console.error('Dashboard section could not be drawn:', section.title, section.layout, e);
      body = [empty(`This part could not be drawn${e?.message ? ` (${e.message})` : ''}.`)];
    }
    sections.push(h('section', { class: 'card dash-sec', 'data-layout': section.layout }, h('div', { class: 'card-head' }, h('h2', null, section.title)), body));
  }
  return h('div', { class: 'dash-doc' },
    h('h2', { class: 'dash-title' }, spec.title), spec.intro ? h('p', { class: 'dash-intro' }, spec.intro) : null,
    h('div', { class: 'tiny muted' }, `${data.project.name} · figures as of ${new Date(data.generatedAt).toLocaleString()}`), sections);
}
