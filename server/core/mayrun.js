// The one answer to "may this agent or skill run here, and with what rights?". Every way of starting one (a button, a rerun, a schedule,
// a chat, a Claude session through the bridge) and every list of what a chat may name asks here, so a new way to start one cannot forget
// a check and the refusals read the same everywhere.
//
// The rules (the content check is already inside `needsAllowance`: a file or skill folder that has changed since it was allowed counts as not allowed):
//  - an agent of a Jade module that is switched off never runs, whoever asks
//  - an agent or skill from a project folder or a plugin that is not allowed (or changed since) may be started only by the PM's own hand
//    (manual, rerun), and then only as a read-only run; never on its own (schedule, automation, chat, bridge); a skill not allowed never runs at all
//  - a Claude Code agent file with no handler or loop (trusted, not runnable) cannot be run by Jade
// "offer" is not a way to start: it asks whether the thing may be listed to a chat or its skills used, which only needs the allowance.
// This file imports nothing: skills.js uses it, and a module's own file (server/modules/skills.js) imports skills.js while modules.js is
// still finding the modules, so importing modules.js from here would wait on itself. modules.js hands in its two lookups when it loads.
let mods = null;
/** modules.js gives { enabled(id), name(id) }. Until it has, an agent that names a module counts as switched off. */
export const useModules = m => { mods = m; };

/** The ways that mean the PM pressed the button themselves. */
const BY_HAND = new Set(['manual', 'rerun']);

/**
 * mayRun({ agent: def } | { skill }, how) -> { ok, ask, reason, status, message, readOnly, edits }
 *  ok: it may run. ask: it is blocked only because the PM has not allowed it (so the page can offer "Allow").
 *  reason: '' | 'module' | 'allow' | 'runnable'.  readOnly: no edits, no Bash, no schedule and none of its own skills (not allowed yet).
 *  edits: the run may change files. message: the plain-English refusal, with status 403 when it is about an allowance.
 */
export function mayRun(what, how = 'manual') {
  const def = what.agent, sk = what.skill;
  const x = def || sk;
  const readOnly = !!x.needsAllowance;
  const edits = !!def && !readOnly && !!def.edits;
  const no = (reason, message, status, ask = false) => ({ ok: false, ask, reason, status, message, readOnly, edits });
  if (how === 'offer') return readOnly ? no('allow', '', 403, true) : { ok: true, ask: false, reason: '', readOnly, edits };
  if (sk) {
    if (readOnly) return no('allow', `The skill ${sk.name} comes from a project folder or a plugin and has not been allowed${sk.allowChanged ? ' since it changed' : ''}. Allow it on the Skills page first.`, 403, true);
    return { ok: true, ask: false, reason: '', readOnly, edits };
  }
  if (def.module && !mods?.enabled(def.module)) return no('module', `${def.name} belongs to the ${mods?.name(def.module) || def.module} module, which is switched off. Switch it on under Modules first.`);
  if (readOnly && !BY_HAND.has(how)) return no('allow', `${def.name} comes from a project folder or a plugin and has not been allowed${def.allowChanged ? ' since it changed' : ''} to work on its own yet. Allow it on the Agents page first, or run it yourself from there.`, 403, true);
  if (def.runnable === false) return no('runnable', `${def.name} is a Claude Code agent Jade cannot run; use it from Claude Code`);
  return { ok: true, ask: false, reason: '', readOnly, edits };
}
