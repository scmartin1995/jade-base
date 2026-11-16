// Module manifest: see docs/EXTENDING.md. First run: the state of set-up, and the flag that says it is finished.
// Everything else the set-up page does goes through routes that already exist (engine, models, config, agents, projects).
import * as config from '../core/config.js';
import * as provider from '../core/provider.js';
import * as models from '../core/models.js';
import * as store from '../core/store.js';
import * as agentfiles from '../core/agentfiles.js';
import * as connection from '../core/connection.js';
import * as pick from '../core/checker.js';
import { emit } from '../core/bus.js';

/** No secrets: the key is only ever reported as "there is one" and its last four characters. */
export function providerSummary() {
  const d = provider.describe();
  // An install that already has an engine file, or a gateway / Bedrock choice, counts as set up.
  return { style: d.style, mode: d.mode, label: d.label, baseUrl: d.baseUrl, hasKey: d.hasKey, keyHint: d.keyHint, region: d.region, configured: !!d.exists || d.style !== 'plan' };
}

export function state() {
  const c = config.get();
  return {
    done: !!c.setup?.done,
    name: c.name || '',
    provider: providerSummary(),
    models: models.offerable(),
    used: pick.describe(),   // the models the agents and the checking agent will really run on, with the reason
    connectionChecked: connection.passed(),
    agentModels: { model: c.agents?.model || '', checkerModel: c.agents?.checkerModel || '' },
    efforts: { chat: c.chat?.effort || '', agents: c.agents?.effort || '' },
    agents: agentfiles.installStatus(),
    projectCount: (() => { try { return store.listProjects().length; } catch { return 0; } })(),
  };
}

export default {
  id: 'setup', name: 'Set-up', icon: 'gear', order: 900, core: true,
  desc: 'First-run questions: how Claude Code reaches Claude, the models, your name and a first project.',
  views: { setup: 'setup.js' },
  defaults: { setup: { done: false } },
  init({ on }) {
    on('GET', '/api/setup', () => state());
    // What the checking agent would use if the agents used ?agent=<model> (set-up asks this before anything is saved); no ?agent= means what is saved.
    on('GET', '/api/setup/checker', ({ q }) => pick.checker(q.has('agent') ? { agentModel: q.get('agent') } : {}));
    on('POST', '/api/setup/done', ({ body }) => {
      // Finishing needs a real answer from Claude with these very settings, checked here and not only in the browser.
      if (body?.done !== false && !connection.passed())
        throw Object.assign(new Error('Jade has not yet heard back from Claude with these settings. Go back to the connection step and run the check again.'), { status: 409 });
      config.save({ setup: { done: body?.done === false ? false : true } });
      emit('data', { kind: 'setup' });
      return state();
    });
    return { state };
  },
};
