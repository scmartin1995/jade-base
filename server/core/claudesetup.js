// How a project is set up for Claude Code, read from disk only (no model): per folder its CLAUDE.md, settings files, agents,
// skills, commands, .mcp.json (server names only) and git, plus how many Claude Code sessions that folder has had and when the last
// was. Sessions are counted by claudesessions.js, the only file that opens Claude Code's conversation files; nothing here reads them.
import fs from 'node:fs';
import path from 'node:path';
import { sessionSummary } from './claudesessions.js';
import { expand, readJSON } from './util.js';
import { foldersOf } from './locations.js';

const stat = f => { try { return fs.statSync(f); } catch { return null; } };
const names = (dir, keep) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(keep); } catch { return []; } };
const iso = ms => new Date(ms).toISOString();

/** One folder's set-up. */
export function forFolder(folder) {
  const dir = expand(folder);
  const md = stat(path.join(dir, 'CLAUDE.md'));
  const cl = path.join(dir, '.claude');
  const mcp = stat(path.join(dir, '.mcp.json'));
  const servers = mcp ? Object.keys(readJSON(path.join(dir, '.mcp.json'), {}).mcpServers || {}) : [];
  return {
    folder: dir, exists: !!stat(dir)?.isDirectory(),
    claudeMd: md ? { exists: true, bytes: md.size, mtime: iso(md.mtimeMs) } : { exists: false, bytes: 0, mtime: null },
    settings: { shared: !!stat(path.join(cl, 'settings.json')), local: !!stat(path.join(cl, 'settings.local.json')) },
    agents: names(path.join(cl, 'agents'), e => e.isFile() && e.name.endsWith('.md')).length,
    skills: names(path.join(cl, 'skills'), e => e.isDirectory() && !!stat(path.join(cl, 'skills', e.name, 'SKILL.md'))).length,
    commands: names(path.join(cl, 'commands'), e => e.isFile() && e.name.endsWith('.md')).length,
    mcp: { exists: !!mcp, servers },
    git: !!stat(path.join(dir, '.git')),
    sessions: sessionSummary(dir),
    command: `cd "${dir}" && claude`,
  };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const day = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** The set-up of one folder in plain words, e.g. "Has a CLAUDE.md, 2 agents, 1 skill, 14 Claude Code sessions, last on 3 Nov". */
export function describe(s) {
  if (!s.exists) return 'This folder could not be found.';
  const has = [];
  if (s.claudeMd.exists) has.push('a CLAUDE.md');
  if (s.agents) has.push(plural(s.agents, 'agent'));
  if (s.skills) has.push(plural(s.skills, 'skill'));
  if (s.commands) has.push(plural(s.commands, 'command'));
  if (s.mcp.exists) has.push(s.mcp.servers.length ? `${plural(s.mcp.servers.length, 'connected tool')} (${s.mcp.servers.join(', ')})` : 'a tools file');
  if (s.settings.shared || s.settings.local) has.push('Claude Code settings');
  if (s.git) has.push('git');
  const parts = [has.length ? 'Has ' + has.join(', ') : 'Not set up for Claude Code yet'];
  parts.push(s.sessions ? `${plural(s.sessions.count, 'Claude Code session')}, last on ${day(s.sessions.newest)}` : 'no Claude Code sessions found');
  return parts.join(', ');
}

/** A project's folders, each with its set-up and a plain sentence. */
export function forProject(p) {
  return { project: p.id, folders: foldersOf(p).map(f => { const s = forFolder(f); return { ...s, summary: describe(s) }; }) };
}
