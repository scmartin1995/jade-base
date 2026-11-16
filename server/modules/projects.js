// Module manifest: see docs/EXTENDING.md.
export default {
  id: 'projects', name: 'Projects', icon: 'grid', order: 30,
  desc: 'A list of projects and a page per project with its description, folders, files, notes, actions and dashboard.',
  nav: [{ route: 'projects', label: 'Projects' }],
  views: { project: 'project.js' },  // the project page (#/project/<id>) belongs to this module
};
