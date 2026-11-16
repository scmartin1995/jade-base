// How hard the model thinks for work Jade starts by itself (meetings, dashboards, routines, the checking agent). Chats have their own
// setting (chat.effort, or the chat's own choice). The levels are the ones engines.js sends as --effort; '' sends nothing, so the model's
// own default applies. Order of say: the agent's own file (jade-effort), then the setting.
import * as config from './config.js';
import * as agentfiles from './agentfiles.js';
import { EFFORT_LEVELS } from './engines.js';

export const LEVELS = EFFORT_LEVELS;
export const valid = e => (LEVELS.includes(e) ? e : '');
const fileSays = id => { try { return valid(agentfiles.discover().find(a => a.id === id)?.effort); } catch { return ''; } };

/** For an agent job or a model call made for an agent (its definition or its id): the file's jade-effort, else agents.effort, else ''. */
export function forAgent(agent) {
  const id = typeof agent === 'string' ? agent : agent?.id;
  const own = agent && typeof agent === 'object' ? valid(agent.effort) : fileSays(id);
  return own || valid(config.get().agents?.effort);
}

/** For the checking agent: its file's jade-effort, else agents.checkerEffort, else the same as agents.effort. */
export function forChecker(id = 'skeptic') {
  const a = config.get().agents || {};
  return fileSays(id) || valid(a.checkerEffort) || valid(a.effort);
}
