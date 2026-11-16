// Module manifest: see docs/EXTENDING.md.
import * as agentfiles from '../core/agentfiles.js';
import { emit } from '../core/bus.js';

export default {
  id: 'agents', name: 'Agents', icon: 'cpu', order: 130,
  desc: 'Claude Code agents: yours, your projects\', plugins\' and Jade\'s built-ins, with their skills and runs.',
  nav: [{ route: 'agents', label: 'Agents' }],
  init({ on, agents }) {
    agents.watch();   // an agent Claude Code creates shows up on the page by itself
    // Install status of Jade's built-ins in Claude Code's folders, and installing them (never over a file you changed).
    on('GET', '/api/agents/install', () => agentfiles.installStatus());
    on('POST', '/api/agents/install', ({ body }) => {
      const r = agentfiles.install({ ids: Array.isArray(body?.ids) ? body.ids.map(String) : undefined, writeNew: !!body?.writeNew });
      emit('agents', {}); emit('data', { kind: 'agents' }); emit('skills', {});
      return r;
    });
    // What the agent's page shows beyond the list: the skills it owns (with their files) and where its file is.
    on('GET', '/api/agents/:id/detail', ({ p }) => {
      const a = agents.get(p.id); if (!a) throw new Error('No such agent');
      return { id: a.id, file: a.file, owned: agents.ownedSkills(a).map(s => ({ name: s.name, description: s.description, file: s.dir ? s.dir + '/SKILL.md' : '', origin: s.origin || 'built-in' })),
        editable: !a.extends && (a.origin === 'yours' || a.origin === 'built-in') };
    });
    // "Allow this agent to work on its own": for an agent from a project folder or a plugin, by its file; and taking that back.
    const theirs = id => { const a = agents.get(id); if (!a) throw Object.assign(new Error('No such agent'), { status: 404 }); if (a.trusted) throw new Error('This agent is yours or Jade\'s own; it needs no allowing'); return a; };
    const changed = () => { emit('agents', {}); emit('data', { kind: 'agents' }); emit('schedule', {}); emit('skills', {}); };
    on('POST', '/api/agents/:id/allow', ({ p }) => { agentfiles.allow(theirs(p.id).file); changed(); const { body: _b, ...a } = agents.get(p.id); return a; });
    on('POST', '/api/agents/:id/disallow', ({ p }) => { agentfiles.disallow(theirs(p.id).file); changed(); const { body: _b, ...a } = agents.get(p.id); return a; });
    on('POST', '/api/agents/:id/save', ({ p, body }) => {
      const { description, prompt, tools, clearModel } = body || {};
      const { body: _b, ...a } = agents.save(p.id, { description, prompt, tools, clearModel: !!clearModel });
      return a;
    });
    return { install: agentfiles.install, status: agentfiles.installStatus };
  },
};
