// The one place that knows where Claude Code keeps its files. JADE_CLAUDE_HOME moves it (tests and gates always set it to a temp
// folder); otherwise it is ~/.claude. Nothing else in the agents code builds a path into Claude Code's folders.
import fs from 'node:fs';
import path from 'node:path';
import { expand, readJSON } from './util.js';

export const home = () => expand(process.env.JADE_CLAUDE_HOME || '~/.claude');
export const agentsDir = () => path.join(home(), 'agents');
export const skillsDir = () => path.join(home(), 'skills');

/**
 * Installed Claude Code plugins that ship agents: <home>/plugins/installed_plugins.json maps "name@marketplace" to a list of installs,
 * each with an installPath, and a plugin's agents are <installPath>/agents/*.md (checked against the layout of plugins on a real machine).
 */
export function pluginRoots() {
  const j = readJSON(path.join(home(), 'plugins', 'installed_plugins.json'), {});
  const out = [];
  for (const [key, installs] of Object.entries(j.plugins || {}))
    for (const i of [].concat(installs || [])) if (i?.installPath) out.push({ plugin: key.split('@')[0], root: String(i.installPath) });
  return out;
}
export function pluginAgentDirs() {
  const out = [];
  for (const { plugin, root } of pluginRoots()) {
    const dir = path.join(root, 'agents');
    if (fs.existsSync(dir) && !out.some(o => o.dir === dir)) out.push({ plugin, dir });
  }
  return out;
}
