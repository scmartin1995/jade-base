// Sub-agent work inside one chat reply, tracked the way Claude Code shows it: each hand-off (the Agent tool) is an item with its
// own steps and result. The engine marks them with a tool call named Agent (Task in older versions); everything the sub-agent
// does carries that call's id as parent_tool_use_id, and its end is the matching tool result.
const MAX_AGENTS = 30, MAX_STEPS = 12;   // the panel shows the last 8 steps; the list rides along on every live update, so it stays short

export const isAgentTool = name => name === 'Agent' || name === 'Task';

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const clipText = (s, n) => { s = String(s ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** The text of a tool result, which the engine sends as a string or as a list of text blocks. */
export function resultText(content) {
  const t = Array.isArray(content) ? content.map(c => (typeof c === 'string' ? c : c?.text || '')).join('\n') : String(content ?? '');
  return unwrapHandback(t).replace(/^agentId:.*$/gm, '').replace(/<usage>[\s\S]*?<\/usage>/g, '').trim();
}

/** A sub-agent's report arrives inside the engine's own frame ("[Subagent hand-back] ... The report follows:" and the report
 *  indented by two spaces). The panel shows the report itself, not the frame, which would use up most of the saved text. */
export function unwrapHandback(text) {
  const t = String(text ?? '');
  if (!/^\s*\[Subagent hand-back\]/.test(t)) return t;
  const m = /The report follows:\s*\n/.exec(t);
  if (!m) return t;
  return t.slice(m.index + m[0].length).split('\n').map(l => l.replace(/^ {1,2}/, '')).join('\n');
}

/**
 * Apply one event to the list (changed in place, the list is returned).
 *  { event: 'start', id, type, description, at }    a hand-off began
 *  { event: 'step',  id, tool, detail, at }         the sub-agent used a tool
 *  { event: 'end',   id, ok, result, background, at }  it came back (background: it was only launched, the report comes later)
 */
export function apply(list, ev) {
  if (!ev?.id) return list;
  let a = list.find(x => x.id === ev.id);
  if (ev.event === 'start') {
    if (!a && list.length < MAX_AGENTS) list.push({ id: ev.id, ...(ev.parent && list.some(x => x.id === ev.parent) ? { parent: ev.parent } : {}), type: clip(ev.type || 'general-purpose', 40), description: clip(ev.description, 160), status: 'running', startedAt: ev.at || Date.now(), steps: 0, tools: [] });
  } else if (a && ev.event === 'step') {
    a.steps++;
    a.tools.push({ name: ev.tool, detail: clip(ev.detail, 140) });
    if (a.tools.length > MAX_STEPS) a.tools.shift();
  } else if (a && ev.event === 'end') {
    a.status = ev.background ? 'background' : ev.ok === false ? 'failed' : 'done';
    a.result = clipText(ev.result, 700);
    if (!ev.background) a.endedAt = ev.at || Date.now();
  }
  return list;
}

/** The reply is over: anything still running did not come back (stopped); background ones keep their label. */
export function finish(list, ok) {
  for (const a of list) if (a.status === 'running') { a.status = ok ? 'done' : 'stopped'; a.endedAt = Date.now(); }
  return list;
}

/** What is kept on the finished reply: no step lists, short results. */
export const slim = list => list.map(({ id, parent, type, description, status, steps, result, startedAt, endedAt }) => ({ id, ...(parent ? { parent } : {}), type, description, status, steps, startedAt, ...(endedAt ? { endedAt } : {}), ...(result ? { result: clipText(result, 400) } : {}) }));
