// Which model each automated agent runs on, decided in one place. Used by meetings, the checking agent (skeptic.js) and the pages that
// show it (set-up and Settings), so what the page says is what a run does.
//
// Transcript agent:  its own file's `model:` (trusted agents only, and only if discovery found that model), else Settings, else '' (Claude Code decides).
// Checking agent:    its own file's `model:` (same rule), else Settings "Agent that checks the work", else ONE SIZE UP from the model the Transcript
//                    agent uses (quick -> everyday -> strong). With no size above it, or a model whose size Jade does not recognise, the checker
//                    uses the same model, and the answer says so. Nothing is ever made up: only models discovery found are chosen.
import * as config from './config.js';
import * as models from './models.js';
import * as agentfiles from './agentfiles.js';

const OTHER = 3;   // models.tierOf() answers this for a name that is not a quick, everyday or strong one (a family Jade does not recognise)

const defOf = id => { try { return agentfiles.discover().find(a => a.id === id) || null; } catch { return null; } };
const found = (list, id) => !!id && list.some(m => m.id === id);

/**
 * The model for an agent (by id) whose Settings choice is `setting`. Returns { model, source, note }:
 * source is 'file' (the agent's own file), 'setting', or 'none' (blank: Claude Code's own default applies). note is plain words or ''.
 */
function pinned(id, setting, offer) {
  const def = defOf(id);
  const list = offer.choices || [];
  if (def?.trusted && def.model) {
    if (found(list, def.model)) return { model: def.model, source: 'file', note: '' };
    const why = `The ${def.name || id} agent's file asks for the model "${def.model}", but Jade did not find that model, so it was ignored.`;
    return setting ? { model: setting, source: 'setting', note: why } : { model: '', source: 'none', note: why };
  }
  return setting ? { model: setting, source: 'setting', note: '' } : { model: '', source: 'none', note: '' };
}

/** The model the Transcript agent (or another working agent, by id) runs on. */
export function worker(id = 'transcript', { cfg = config.get(), offer = models.offerable() } = {}) {
  return pinned(id, cfg.agents?.model || '', offer);
}

/**
 * The model the checking agent runs on. `agentModel` may be given to ask "what if the agents used this one" (set-up does, before
 * anything is saved). Returns { model, source, note } where source is 'file', 'setting', 'one-size-up', 'same' or 'none'.
 */
export function checker(opts = {}) {
  const r = pickChecker(opts);
  const pin = pinned(opts.checkerId || 'skeptic', '', opts.offer || models.offerable());   // a ruled-out pin in the agent's file is mentioned whichever rule then applied
  return r.source === 'file' || !pin.note || r.note.includes(pin.note) ? r : { ...r, note: [pin.note, r.note].filter(Boolean).join(' ') };
}
function pickChecker({ workerId = 'transcript', checkerId = 'skeptic', agentModel, cfg = config.get(), offer = models.offerable() } = {}) {
  const own = pinned(checkerId, cfg.agents?.checkerModel || '', offer);
  if (own.model) return own;
  const base = agentModel !== undefined ? { model: agentModel, source: 'setting', note: '' } : worker(workerId, { cfg, offer });
  if (!base.model) return { model: '', source: 'none', note: own.note || 'No model has been chosen for the agents, so the checking agent uses Claude\'s own default too.' };
  const tier = models.tierOf(base.model);
  if (tier >= OTHER) return { model: base.model, source: 'same', note: `Jade does not recognise the size of "${base.model}", so the checking agent uses the same model. Choose one in Settings if you want a different one.` };
  const up = (offer.choices || []).find(m => m.tier > tier && m.tier < OTHER);
  if (!up) return { model: base.model, source: 'same', note: 'There is no larger model than the one the agents use, so the checking agent uses the same one.' };
  return { model: up.id, source: 'one-size-up', note: '' };
}

/** What the set-up page and Settings show: both answers with their reasons. */
export function describe(opts = {}) {
  return { agents: worker('transcript', opts), checker: checker(opts) };
}
