// Module manifest: see docs/EXTENDING.md. The meeting bin: drop a transcript, get a checked record and action items.
const send = (res, data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };

export default {
  id: 'meetings', name: 'Meetings', icon: 'doc', order: 35,
  desc: 'Drop in a meeting transcript and get the key points, action items and risks, each checked against what was said.',
  nav: [{ route: 'meetings', label: 'Meetings' }],
  views: { meetings: 'meetings.js', meeting: 'meeting.js' },
  projectPanels: [{ id: 'meetings', title: 'Meetings', view: 'meetings-panel.js', order: 20 }],
  defaults: {
    meetings: { accept: 'review', maxRounds: 1, maxBytes: 26214400, maxChars: 400000 },
  },
  async init({ on, jobs, agents }) {
    // loaded here, not at the top: the core file imports the agents loader, which is still loading the manifests when this file is read
    const meetings = await import('../core/meetings.js');
    // the run shows in the activity drawer as a job of the Transcript agent
    jobs.register('meeting', ({ input, signal, log }) => meetings.execute(input.meeting, { signal, log }));
    meetings.setLauncher(async mid => {
      if (agents.get(meetings.AGENT)?.loop !== 'meeting') return meetings.execute(mid);
      const m = meetings.get(mid);
      const j = await jobs.enqueueAndWait({ agent: meetings.AGENT, input: { meeting: mid }, title: `Meeting: ${m?.title || 'transcript'}` });
      if (j && j.status !== 'done' && !['review', 'recorded', 'paused', 'failed'].includes(meetings.get(mid)?.status))
        throw new Error(j.status === 'cancelled' ? 'This run was stopped.' : j.error || 'This run stopped before it finished.');
    });

    on('POST', '/api/meetings/upload', async ({ q, req, res }) => {
      const project = q.get('project'), name = q.get('name');
      if (!project) throw Object.assign(new Error('Choose a project for this meeting.'), { status: 400 });
      if (!name) throw Object.assign(new Error('The file needs a name.'), { status: 400 });
      const transcripts = await import('../core/transcripts.js');
      const file = await transcripts.receive(req, { project, name, res, modified: q.get('modified') });
      send(res, meetings.create({ project, file }));
    }, { raw: true });
    on('GET', '/api/meetings', ({ q }) => meetings.list(q.get('project') || '').map(meetings.summary));
    on('GET', '/api/meetings/:id', ({ p }) => { const m = meetings.get(p.id); if (!m) throw Object.assign(new Error('That meeting is not there any more.'), { status: 404 }); return m; });
    on('PATCH', '/api/meetings/:id', ({ p, body }) => meetings.patch(p.id, body || {}));
    on('POST', '/api/meetings/:id/record', ({ p, body }) => meetings.writeRecord(p.id, { empty: body?.empty === true }));
    on('POST', '/api/meetings/:id/rerun', ({ p }) => meetings.rerun(p.id));
    on('DELETE', '/api/meetings/:id', ({ p }) => meetings.remove(p.id));

    meetings.resume();
    return { list: meetings.list, get: meetings.get };
  },
};
