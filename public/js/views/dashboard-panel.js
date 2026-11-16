// The Dashboards card on a project page: the project's dashboards and a New dashboard button.
import { dashboardRow, wire, building } from './dashboards.js';

const panel = {
  async render(root, ctx, project) {
    const { api, ui, state } = ctx;
    // a failed load is not "none yet": the error goes to the project page, which shows it in this card and keeps the other cards
    const list = await api('GET', `/api/projects/${encodeURIComponent(project.id)}/dashboards`);
    const p = { id: project.id, name: project.name, dashboards: list };
    root.innerHTML = `<div class="list">${list.map(d => dashboardRow(ui, p, d, { busy: building(state, p.id, d.id) })).join('') || '<div class="empty">No dashboards yet. Choose New dashboard and answer a few questions; Jade chooses what it shows, and its figures are fresh every time you open it.</div>'}</div>
      <div class="row" style="gap:8px;margin-top:10px"><button class="btn sm primary" data-new="${ui.esc(p.id)}">${ui.icon('plus', 14)}New dashboard</button><a class="btn sm ghost" href="#/dashboards">Dashboards page</a></div>`;
    wire(root, ctx, [p], () => panel.render(root, ctx, project));
  },
};
export default panel;
