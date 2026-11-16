// Runs scheduled agents, skill automations and the memory reindex. Schedules are plain strings:
//   "every 30m" · "every 2h" · "daily 08:00" · "weekdays 08:30" · "mon,thu 16:00"
// If the computer was asleep at the scheduled time, the run happens when Jade next sees it (up to 12 hours late).
import path from 'node:path';
import * as config from './config.js';
import * as agents from './agents.js';
import * as skills from './skills.js';
import * as jobs from './jobs.js';
import * as memory from './memory.js';
import * as modules from './modules.js';
import { mayRun } from './mayrun.js';
import * as store from './store.js';
import { readJSON, writeJSON } from './util.js';
import { emit } from './bus.js';

const FILE = () => path.join(config.STATE, 'schedule.json');
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CATCH_UP_MS = 12 * 3600e3;

export function parse(s) {
  s = String(s || '').trim().toLowerCase();
  if (!s || s === 'off') return null;
  let m = /^every\s+(\d+)\s*(m|min|h|hr|d)/.exec(s);
  if (m) return { every: +m[1] * ({ m: 60e3, min: 60e3, h: 3600e3, hr: 3600e3, d: 864e5 }[m[2]]) };
  m = /^(daily|weekdays|weekends|[a-z,\s]+?)\s+(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  let days = [0, 1, 2, 3, 4, 5, 6];
  if (m[1] === 'weekdays') days = [1, 2, 3, 4, 5];
  else if (m[1] === 'weekends') days = [0, 6];
  else if (m[1] !== 'daily') days = m[1].split(/[,\s]+/).map(d => DAYS.indexOf(d.slice(0, 3))).filter(d => d >= 0);
  return { days, h: +m[2], min: +m[3] };
}

/** The most recent time this schedule should have fired, at or before now. */
function lastSlot(rule, now = new Date()) {
  for (let back = 0; back < 8; back++) {
    const d = new Date(now); d.setDate(d.getDate() - back); d.setHours(rule.h, rule.min, 0, 0);
    if (d <= now && rule.days.includes(d.getDay())) return d.getTime();
  }
  return 0;
}

export function nextRun(s, now = new Date()) {
  const rule = parse(s);
  if (!rule) return null;
  if (rule.every) return null;
  for (let fwd = 0; fwd < 8; fwd++) {
    const d = new Date(now); d.setDate(d.getDate() + fwd); d.setHours(rule.h, rule.min, 0, 0);
    if (d > now && rule.days.includes(d.getDay())) return d.toISOString();
  }
  return null;
}

function due(key, s, last) {
  const rule = parse(s);
  if (!rule) return false;
  const now = Date.now();
  if (rule.every) return !last[key] || now - last[key] >= rule.every;
  // First time a clock schedule is seen (fresh install, new agent): start counting from now, don't catch up.
  if (!last[key]) { last[key] = now; return false; }
  const slot = lastSlot(rule);
  return slot && last[key] < slot && now - slot < CATCH_UP_MS;
}

export function tasks() {
  const c = config.get();
  const out = [];
  // Scheduled agents are Routines: nothing runs on a timer until that module is switched on, and an agent from a project folder or a
  // plugin only after the PM has allowed that agent (Agents page).
  const routines = modules.enabled('routines');
  for (const a of routines ? agents.list() : []) {
    const sched = c.schedules?.[a.id] ?? a.schedule;
    if (!sched || sched === 'off' || !mayRun({ agent: a }, 'schedule').ok) continue;
    out.push({ key: 'agent:' + a.id, kind: 'agent', id: a.id, name: a.name, schedule: sched, perProject: a.input === 'project' });
  }
  if (modules.enabled('skills')) {
    for (const s of skills.list()) if (s.automationOn && s.enabled && mayRun({ skill: s }, 'automation').ok) out.push({ key: 'skill:' + s.name, kind: 'skill', id: s.name, name: s.name, schedule: s.automation, perProject: s.perProject });
  }
  out.push({ key: 'memory', kind: 'memory', id: 'memory', name: 'Memory reindex', schedule: `every ${Math.max(5, Number(c.memory?.reindexMinutes) || 15)}m` });
  const last = readJSON(FILE(), {});
  return out.map(t => ({ ...t, lastRun: last[t.key] ? new Date(last[t.key]).toISOString() : null, nextRun: nextRun(t.schedule) }));
}

function fire(t) {
  const projects = () => store.listProjects().filter(p => !p.archived);
  if (t.kind === 'memory') return void memory.rebuild({ maxAgeMs: 60e3 });   // not again straight after the start-up pass
  if (t.kind === 'agent') {
    if (t.perProject) for (const p of projects()) jobs.enqueue({ agent: t.id, input: { project: p.id }, trigger: 'schedule' });
    else jobs.enqueue({ agent: t.id, input: {}, trigger: 'schedule' });
  }
  if (t.kind === 'skill') {
    if (t.perProject) for (const p of projects()) jobs.enqueue({ agent: 'skill-runner', input: { skill: t.id, project: p.id }, trigger: 'automation' });
    else jobs.enqueue({ agent: 'skill-runner', input: { skill: t.id }, trigger: 'automation' });
  }
}

export function tick() {
  const last = readJSON(FILE(), {});
  let changed = false;
  for (const t of tasks()) {
    const seen = !!last[t.key];
    if (!due(t.key, t.schedule, last)) { if (!seen && last[t.key]) changed = true; continue; }
    last[t.key] = Date.now();
    changed = true;
    try { fire(t); } catch (e) { emit('toast', { kind: 'error', text: `${t.name}: ${e.message}` }); }
  }
  if (changed) { writeJSON(FILE(), last); emit('schedule', {}); }
}

/** Start the schedule; returns a function that stops it. The timers never keep a process alive on their own. */
export function start() {
  const first = setTimeout(tick, 4000), every = setInterval(tick, 60e3);
  first.unref?.(); every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}
