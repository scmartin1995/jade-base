// The modular panel. Each module is a page and/or background work that can be switched off; switching is live.
// A module is a manifest file: server/modules/*.js (built in) and <JADE_HOME>/modules/*.js (the user's; the same id wins over a built-in).
// Manifests are found once, at boot (a change to either folder restarts the server, see jade.js). See docs/EXTENDING.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as config from './config.js';
import * as router from './router.js';
import { useModules } from './mayrun.js';

export const BUILTIN_DIR = path.join(config.APP_ROOT, 'server', 'modules');
export const userDir = () => path.join(config.JADE_HOME, 'modules');
/** What modules published from init(), by module id: a module reaches another's helpers through this. */
export const services = {};

let found = [];

async function readDir(dir, source) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.startsWith('.')).sort(); } catch { return []; }
  const out = [];
  for (const f of names) {
    try {
      const m = (await import(pathToFileURL(path.join(dir, f)).href)).default;
      if (!m || typeof m.id !== 'string' || !/^[\w-]+$/.test(m.id) || !m.name) throw new Error('a manifest needs an id (letters, digits, - _) and a name');
      out.push({ order: 500, icon: 'cpu', desc: '', ...m, source });
    } catch (e) { console.error(`module ${source}/${f} skipped: ${e.message}`); }
  }
  return out;
}

/** Find the manifests and apply their config defaults. Runs once when this file is first imported. */
export async function discover() {
  const byId = new Map();
  for (const m of [...await readDir(BUILTIN_DIR, 'builtin'), ...await readDir(userDir(), 'user')]) byId.set(m.id, m); // user file wins
  found = [...byId.values()].sort((a, b) => a.order - b.order);
  for (const m of found) if (m.defaults) config.addDefaults(m.defaults);
}
await discover();

/**
 * Run each manifest's init(api) with { on, jobs, agents, store, config, bus, services }. `on` registers routes under the module's own
 * name, and every one of them answers 403 while the module is switched off (a core module has no switch): no module needs its own check.
 * Whatever init returns is published as services[id]. One module failing to start does not stop the others.
 * The core pieces are passed in (not imported here) because agents.js imports this file.
 */
export async function init(core) {
  for (const m of found) {
    if (typeof m.init !== 'function') continue;
    try {
      const out = await m.init({ ...core, on: router.scope('mod:' + m.id, m.core ? undefined : () => requireOn(m.id)), config, services });
      if (out && typeof out === 'object') services[m.id] = out;
    } catch (e) { console.error(`module ${m.id} failed to start: ${e.message}`); }
  }
}

const get = mid => found.find(x => x.id === mid);

export function enabled(mid) {
  const m = get(mid);
  if (!m) return false;
  if (m.core) return true;
  return config.get().modules?.[mid] ?? !m.defaultOff;   // an explicit choice in config.json wins over the module's default
}

/** The one refusal for a switched-off module: a 403 that names the module and says where to turn it on. */
export function requireOn(mid) {
  if (enabled(mid)) return;
  throw Object.assign(new Error(`${get(mid)?.name || mid} is switched off. Turn it on under Modules first.`), { status: 403 });
}
/** `fn`, refused with that 403 while the module is off: for a route that has to live outside the module's own init (api.js). */
export const only = (mid, fn) => router.guard(() => requireOn(mid), fn);

// The manifest as the browser gets it: data only (no init), plus whether it is on.
const plain = m => { const { init, ...rest } = m; return { ...JSON.parse(JSON.stringify(rest)), enabled: enabled(m.id) }; };
export function list() { return found.map(plain); }
useModules({ enabled, name: mid => get(mid)?.name });   // mayrun.js (may this agent run?) asks about switched-off modules

/** The folder a user module's view files are served from, or '' for a module that has none (built-ins keep theirs in public/js/views). */
export function viewsDir(mid) { const m = get(mid); return m?.source === 'user' ? path.join(userDir(), m.id, 'views') : ''; }

export function set(mid, on) {
  const m = get(mid);
  if (!m || m.core) throw new Error('That module cannot be switched off');
  config.save({ modules: { [mid]: !!on } });
}
