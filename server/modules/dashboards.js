// Module manifest: see docs/EXTENDING.md. Dashboards: how each project is set up in Claude Code, and its dashboards. A dashboard is a
// saved specification a model chose from the project manager's answers; Jade's own code draws it from fresh data each time it is opened.

const bad = (status, message) => Object.assign(new Error(message), { status });

export default {
  id: 'dashboards', name: 'Dashboards', icon: 'pulse', order: 32,
  desc: 'A page for each project: how it is set up in Claude Code, and dashboards. A model chooses what to show from your answers; Jade draws it from fresh figures every time you open it.',
  nav: [{ route: 'dashboards', label: 'Dashboards' }],
  views: { dashboards: 'dashboards.js' },
  projectPanels: [{ id: 'dashboards', title: 'Dashboards', view: 'dashboard-panel.js', order: 10 }],
  defaults: { dashboards: { model: '' } },
  async init({ on, jobs, store }) {
    const dashboards = await import('../core/dashboards.js');
    const claudesetup = await import('../core/claudesetup.js');
    const files = await import('../core/files.js');
    const project = pid => { const p = store.getProject(pid); if (!p) throw bad(404, 'That project is not there any more.'); return p; };
    const shape = p => ({ id: p.id, name: p.name, description: p.description || '', folders: p.folders || [], dashboards: dashboards.listFor(p) });
    const startBuild = (p, d, what) => jobs.enqueue({ agent: 'dashboard-builder', input: { project: p.id, dashboard: d.id }, title: `${what} dashboard · ${d.name}` });

    // the build and the changes run as jobs of the Dashboard Builder, so they show in the activity drawer
    jobs.register('dashboard', ({ input, signal, log }) => input.change
      ? dashboards.change(input.project, input.dashboard, input.change, { signal, log })
      : dashboards.build(input.project, input.dashboard, { signal, log }));

    on('GET', '/api/dashboards', () => store.listProjects().filter(p => !p.archived).map(p => ({ ...shape(p), claude: claudesetup.forProject(p).folders })));
    on('GET', '/api/dashboards/questions', async ({ q }) => ({ questions: dashboards.questionsFor(project(q.get('project') || '').id, await files.list()) }));
    on('GET', '/api/projects/:id/claude', ({ p }) => claudesetup.forProject(project(p.id)));
    on('GET', '/api/projects/:id/dashboards', ({ p }) => shape(project(p.id)).dashboards);
    on('POST', '/api/projects/:id/dashboards', ({ p, body }) => {
      const pr = project(p.id);
      const a = body?.answers || {};
      if (!String(a.name || '').trim()) throw bad(400, 'Give the dashboard a name.');
      const d = dashboards.create(pr.id, a);
      return { dashboard: d, job: startBuild(pr, d, 'Build') };
    });
    // new answers: saved, and the dashboard is made again (the model runs only here, on Rebuild, and on Change it)
    on('PATCH', '/api/projects/:id/dashboards/:did', ({ p, body }) => {
      const pr = project(p.id);
      const d = dashboards.setAnswers(pr.id, p.did, body?.answers || {});
      return { dashboard: d, job: startBuild(pr, d, 'Rebuild') };
    });
    on('POST', '/api/projects/:id/dashboards/:did/rebuild', ({ p }) => {
      const pr = project(p.id);
      const d = (pr.dashboards || []).find(x => x.id === p.did);
      if (!d) throw bad(404, 'That dashboard cannot be built again.');
      return { dashboard: d, job: startBuild(pr, d, 'Rebuild') };
    });
    // what the page draws from: the saved specification and the figures as they are now (no model)
    on('GET', '/api/projects/:id/dashboards/:did/view', async ({ p }) => dashboards.view(project(p.id).id, p.did, await files.list()));
    on('POST', '/api/projects/:id/dashboards/:did/change', ({ p, body }) => {
      const pr = project(p.id);
      const request = String(body?.change || '').trim();
      if (!request) throw bad(400, 'Say what you would like changed.');
      const { dashboard } = dashboards.readSpec(pr.id, p.did);
      return { job: jobs.enqueue({ agent: 'dashboard-builder', input: { project: pr.id, dashboard: dashboard.id, change: request.slice(0, 2000) }, title: `Change dashboard · ${dashboard.name}` }) };
    });
    // remove or reorder sections: code only
    on('POST', '/api/projects/:id/dashboards/:did/sections', ({ p, body }) => dashboards.editSections(project(p.id).id, p.did, body || {}));
    on('DELETE', '/api/projects/:id/dashboards/:did', ({ p }) => dashboards.remove(project(p.id).id, p.did));
    return { collect: dashboards.collect };
  },
};
