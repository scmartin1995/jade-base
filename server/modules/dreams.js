// Module manifest: see docs/EXTENDING.md. Dreams: a nightly look at the week's work that brings back ideas, each with its evidence.
// Off until the PM turns it on. Its nightly schedule (in agents/dreams.md) runs only when Routines is on too; "Dream now" works with the
// module on whatever Routines says.
export default {
  id: 'dreams', name: 'Dreams', icon: 'moon', order: 125,
  defaultOff: true,  // switched off until the user turns it on
  desc: 'Reads the week\'s work, in Jade and in Claude Code, and brings back ideas: agents worth building, skills, things to write down. Nothing changes until you say yes.',
  nav: [{ route: 'dreams', label: 'Dreams' }],
  defaults: { dreams: { days: 7, claude: 'projects', web: false, maxCharsPerSession: 6000, maxChars: 60000 } },
  async init({ on, jobs, agents, config, services }) {
    // loaded here, not at the top: the core files import the agents loader, which is still loading the manifests when this file is read
    const dreams = await import('../core/dreams.js');
    const modules = await import('../core/modules.js');
    agents.addContext('work-week', () => dreams.workWeek());
    agents.addContext('dream-history', () => dreams.history());
    agents.addContext('looking-outward', () => dreams.outward());
    agents.addHandler('dreams', (def, input, text) => dreams.finishNight(def, input, text));

    // (a switched-off module answers 403 on every route below: the guard `on` carries, see core/modules.js)
    const running = () => jobs.list().some(j => j.agent === dreams.AGENT && (j.status === 'running' || j.status === 'queued'));
    on('GET', '/api/dreams', () => {
      const def = agents.get(dreams.AGENT);
      const schedule = config.get().schedules?.dreams ?? def?.schedule ?? '';
      return { ...dreams.view(), running: running(), schedule, scheduleOn: modules.enabled('routines') && !!schedule && schedule !== 'off' };
    });
    on('POST', '/api/dreams/run', () => {
      if (!agents.get(dreams.AGENT)) throw new Error('The Dreams agent file is missing.');
      return jobs.enqueue({ agent: dreams.AGENT, input: {}, trigger: 'manual' });
    });
    on('GET', '/api/dreams/:date/idea/:id/preview', ({ p }) => dreams.preview(p.date, p.id));
    on('POST', '/api/dreams/:date/idea/:id/accept', ({ p, body }) => dreams.accept(p.date, p.id, body?.token));
    on('POST', '/api/dreams/:date/idea/:id/dismiss', ({ p }) => dreams.dismiss(p.date, p.id));
    return { settings: dreams.settings };
  },
};
