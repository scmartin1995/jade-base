// Module manifest: see docs/EXTENDING.md.
import * as skills from '../core/skills.js';

export default {
  id: 'skills', name: 'Skills', icon: 'bolt', order: 120,
  desc: 'Reusable SKILL.md playbooks. A skill with a schedule runs as an automation.',
  nav: [{ route: 'skills', label: 'Skills' }],
  // "Open folder" on read-only skills (Claude Code, project, plugin): only a skill Jade lists can be opened.
  init({ on }) {
    // "Allow this skill": for a skill from a project folder or a plugin; and taking that back.
    on('POST', '/api/skills/:name/allow', ({ p }) => { skills.allowSkill(p.name); return { ok: true }; });
    on('POST', '/api/skills/:name/disallow', ({ p }) => { skills.disallowSkill(p.name); return { ok: true }; });
    on('POST', '/api/skills/:name/open-folder', ({ p }) => {
      try { return { ok: true, path: skills.openFolder(p.name) }; } catch (e) { throw Object.assign(e, { status: 404 }); }
    });
  },
};
