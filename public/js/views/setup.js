// First run: a few questions, one at a time. Everything here is a setting afterwards (Settings -> "Run set-up again").
import { runQuestionnaire, choiceCards } from '../questionnaire.js';
import { effortOptions, EFFORT_HELP, EFFORT_CHOICES } from '../efforts.js';
import { STYLE_BOXES, PROVIDER_FIELDS, wireProviderForm, importClaudeSettings, showDiagnose } from '../providerform.js';

const effortLabel = e => (EFFORT_CHOICES.find(([v]) => v === (e || ''))?.[1] || "The model's own default");

/**
 * The last step: ask first, change nothing until the connection check is known to count (a refusal at the end would leave the
 * project and the agents already made, and the next try would make them again), then save, install, add the project once, finish.
 */
export async function finishSetup(a, { api, ui, state, go }) {
  if (!(await api('GET', '/api/setup')).connectionChecked) throw new Error('Jade has not yet heard back from Claude with these settings. Go back to the connection step and run the check again.');
  await api('POST', '/api/config', { name: (a.name || '').trim(), agents: { model: a.model || '', checkerModel: a.checkerModel || '', effort: a.effort?.agents || '' }, chat: { effort: a.effort?.chat || '' } });
  if (a.install === 'yes') await api('POST', '/api/agents/install', {});
  const name = a.project?.name?.trim();
  const have = name && (await api('GET', '/api/projects').catch(() => [])).some(p => p.name === name);   // a second try never adds it again
  if (name && !have) await api('POST', '/api/projects', { name, folders: a.project.folder ? [a.project.folder] : [] });
  await api('POST', '/api/setup/done', {});
  state.boot = await api('GET', '/api/boot');
  ui.toast('You are all set', 'success', 2500);
  go('home');
}

export default {
  title: 'Set-up',
  async render(root, ctx) {
    const { api, ui, state, go } = ctx;
    const { esc, icon } = ui;
    const info = await api('GET', '/api/setup');
    const mem = { passed: false, models: null };

    // ---- a) how Claude Code reaches Claude: the same form as Settings -> Engine
    const providerStep = {
      id: 'provider', type: 'custom', label: 'How does Claude Code reach Claude?',
      help: 'Most people use their own Claude plan. At work you may be given an address and a key instead (a company gateway or Amazon Bedrock).',
      review: v => (v === 'gateway' ? 'A company gateway or Amazon Bedrock' : 'My Claude plan'),
      render(box, { set, refresh }) {
        let prov = info.provider, dirty = false, form;
        const e = state.boot.engines;
        const paint = async () => {
          prov = await api('GET', '/api/engine/provider').catch(() => prov);
          box.innerHTML = `${STYLE_BOXES(prov, e)}${PROVIDER_FIELDS(prov)}
            <div class="row wrap" style="gap:10px;margin-top:12px"><button type="button" class="btn sm ghost" data-diagnose>${icon('doc', 14)}Diagnose</button></div>`;
          form = wireProviderForm(box, prov, st => { set(st); dirty = true; });
          set(form.style());
          box.addEventListener('input', () => { dirty = true; });
          box.querySelector('[data-import-claude]')?.addEventListener('click', async () => { if (await importClaudeSettings(api)) { mem.passed = false; mem.saved = true; refresh(); } });
          box.querySelector('[data-diagnose]').onclick = () => showDiagnose(api).catch(err => ui.toast(err.message, 'error'));
        };
        const painted = paint();
        // The form is saved when the person goes on, exactly as Settings saves it.
        providerStep._save = async () => {
          await painted;   // the form is drawn only after the settings have been read; pressing Next sooner waits for it
          if (!dirty && (info.provider.configured || mem.saved)) return;
          await api('POST', '/api/engine/provider', form.data());
          mem.saved = true; mem.passed = false; dirty = false;
        };
      },
      async validate() { await providerStep._save?.(); return ''; },
    };

    // ---- b) one real question to Claude; set-up cannot go on until it is answered
    const testStep = {
      id: 'test', type: 'custom', label: 'Checking the connection',
      help: 'Jade sends one short question to Claude to make sure everything works.',
      review: () => 'Claude answered',
      render(box, { set }) {
        let gone = false;
        const run = async () => {
          mem.passed = false;
          box.innerHTML = `<div class="small dim">${icon('refresh', 14)} Asking Claude a short question…</div>`;
          let r;
          try { r = await api('POST', '/api/engine/test'); } catch (err) { r = { ok: false, error: err.message, provider: '' }; }
          if (gone) return;
          if (r.ok) {
            mem.passed = true; set('ok');
            box.innerHTML = `<div class="small" style="color:var(--green)">${icon('check', 14)} Claude answered in ${(r.ms / 1000).toFixed(1)} seconds${r.model ? ' · ' + esc(r.model) : ''}. You can go on.</div>`;
            return;
          }
          set(undefined);
          let report = '';
          try { report = (await api('POST', '/api/engine/diagnose')).report; } catch (err) { report = err.message; }
          if (gone) return;
          box.innerHTML = `<div class="small" style="color:var(--warn)">${icon('x', 14)} Claude did not answer${r.error ? ': ' + esc(r.error) : ''}.</div>
            <p class="small dim">Go back and check the address and key, or send the report below to whoever is helping you.</p>
            <pre class="output" data-report style="white-space:pre-wrap;max-height:40vh;overflow:auto;font-size:12px">${esc(report)}</pre>
            <div class="row" style="gap:8px"><button type="button" class="btn sm" data-copy>${icon('copy', 13)}Copy the report</button><button type="button" class="btn sm primary" data-retry>${icon('refresh', 13)}Try again</button></div>`;
          box.querySelector('[data-copy]').onclick = () => { ui.copy(report); ui.toast('Copied', 'success', 1200); };
          box.querySelector('[data-retry]').onclick = run;
        };
        run();
        return () => { gone = true; };
      },
      validate: () => (mem.passed ? '' : 'Jade cannot go on until Claude has answered. Try again, or go back and change how it connects.'),
    };

    // ---- c) the models: only what discovery reports
    const modelStep = (id, label, help, pick) => ({
      id, type: 'custom', label, help, required: true, requiredText: 'No models were found, so there is nothing to choose yet.',
      review: v => (v ? (mem.labels?.[v] || v) : 'Not chosen'),
      render(box, { value, set, answers }) {
        const load = async () => {
          box.innerHTML = '<div class="tiny muted">Looking for the models Claude can use…</div>';
          try { mem.models = await api('POST', '/api/models/refresh'); } catch { mem.models = await api('GET', '/api/models').catch(() => ({ choices: [] })); }
          const all = mem.models.choices || [];
          const list = all.map(m => ({ value: m.id, label: m.label, help: m.tierName ? m.tierName + ' model' : '' }));
          mem.labels = Object.fromEntries(list.map(o => [o.value, o.label]));
          if (!list.length) {
            let report = '';
            try { report = (await api('POST', '/api/engine/diagnose')).report; } catch (err) { report = err.message; }
            set(undefined);
            box.innerHTML = `<div class="small" style="color:var(--warn)">${icon('x', 14)} No models were found.</div>
              <p class="small dim">Jade only offers models that Claude reports. If you use a company gateway or Amazon Bedrock, press Back and check the address and key, then try again. If that does not help, send this report to whoever is helping you.</p>
              <pre class="output" style="white-space:pre-wrap;max-height:40vh;overflow:auto;font-size:12px">${esc(report)}</pre>
              <div class="row" style="gap:8px"><button type="button" class="btn sm" data-copy>${icon('copy', 13)}Copy the report</button><button type="button" class="btn sm primary" data-retry>${icon('refresh', 13)}Retry</button></div>`;
            box.querySelector('[data-copy]').onclick = () => { ui.copy(report); ui.toast('Copied', 'success', 1200); };
            box.querySelector('[data-retry]').onclick = load;
            return;
          }
          // The checking agent's choice comes from the server, which holds the one rule (one size above the agents' model) that runs use too.
          let rule = null;
          if (id === 'checkerModel') rule = await api('GET', `/api/setup/checker?agent=${encodeURIComponent(answers.model || '')}`).catch(() => null);
          const chosen = list.some(o => o.value === value) ? value : id === 'checkerModel' ? (rule?.model || answers.model || '') : pick(mem.models.defaults || {});
          set(chosen);
          box.innerHTML = '<div data-note></div><div data-cards></div>';
          choiceCards(box.querySelector('[data-cards]'), list, chosen, set);
          if (rule?.note) box.querySelector('[data-note]').innerHTML = `<p class="small dim" style="margin:0 0 10px">${esc(rule.note)}</p>`;
        };
        load();
      },
    });
    const agentModel = modelStep('model', 'Which model should the automated agents use?', 'These do the reading and sorting in the background. The smallest model is chosen for you; you can change it any time in Settings.', (d) => d.agent);
    const checkerModel = modelStep('checkerModel', 'Which model should the checking agent use?', 'A second agent checks the first one\'s work. It is best with a more capable model, so the next size up is chosen for you.',
      () => '');

    // ---- c2) how hard the models think: both start at the model's own default
    const effortStep = {
      id: 'effort', type: 'custom', label: 'How hard should Jade think?',
      help: `${EFFORT_HELP} You can change either one any time in Settings.`,
      review: v => `Chats: ${effortLabel(v?.chat)} · Automated work: ${effortLabel(v?.agents)}`,
      render(box, { value, set }) {
        const v = { chat: value?.chat || '', agents: value?.agents || '' };
        box.innerHTML = `<div class="form"><label class="field">In chats<select data-effort="chat">${effortOptions(v.chat)}</select></label>
          <label class="field">In automated work (meetings, dashboards, agents)<select data-effort="agents">${effortOptions(v.agents)}</select></label></div>`;
        box.querySelectorAll('[data-effort]').forEach(sel => { sel.onchange = () => { v[sel.dataset.effort] = sel.value; set({ ...v }); }; });
        set({ ...v });
      },
    };

    // ---- d) name
    const nameStep = { id: 'name', type: 'text', label: 'What should Jade call you?', help: 'Optional. It is used in greetings.', placeholder: 'Your name' };

    // ---- e) Jade's agents in Claude Code
    const installStep = {
      id: 'install', type: 'custom', label: 'Add Jade\'s agents to Claude Code?',
      help: 'These are small helpers that read and check your work. Once added, they also show up in Claude Code itself. A file you have changed is never overwritten.',
      required: true, requiredText: 'Choose whether to add them. Nothing is added until you say yes.',
      review: v => (v === 'no' ? 'Not now' : 'Yes, add them'),
      validate: v => (v === 'yes' || v === 'no' ? '' : 'Choose whether to add them. Nothing is added until you say yes.'),
      render(box, { value, set }) {
        const st = info.agents;
        const names = st.agents.map(a => `<li>${esc(a.name)}</li>`).join('');
        box.innerHTML = `<div class="small dim" style="margin-bottom:8px">They will be written to <span class="mono">${esc(st.claudeHome)}</span>${st.state === 'installed' ? ' (they are already there)' : ''}:</div>
          <ul class="small" style="margin:0 0 18px 18px;color:var(--fg-soft)">${names}</ul><div data-cards></div>`;
        const v = value || ''; if (v) set(v);
        choiceCards(box.querySelector('[data-cards]'), [{ value: 'yes', label: 'Yes, add them' }, { value: 'no', label: 'Not now', help: 'You can add them later from the Agents page.' }], v, set);
      },
    };

    // ---- f) first project
    const projectStep = {
      id: 'project', type: 'custom', label: 'Your first project',
      help: 'A project is a piece of work with its own folder. You can skip this and add one later.',
      review: v => (v?.name ? v.name + (v.folder ? ' · ' + v.folder : '') : 'Skipped'),
      render(box, { value, set }) {
        const v = { name: value?.name || '', folder: value?.folder || '' };
        const paint = () => {
          box.innerHTML = `<label class="field">Project name<input type="text" data-name value="${esc(v.name)}" placeholder="For example: Riverside school" autocomplete="off"></label>
            <div class="folder-row" style="margin-top:12px">${icon('folder', 17)}<div class="grow" style="min-width:0"><div class="mono small ellipsis" style="color:var(--fg-soft)">${esc(v.folder || 'No folder chosen yet')}</div></div>
            <button type="button" class="btn sm" data-pick>${icon('folder', 13)}${v.folder ? 'Choose a different folder' : 'Choose its folder'}</button></div>`;
          box.querySelector('[data-name]').oninput = e => { v.name = e.target.value; set({ ...v }); };
          box.querySelector('[data-pick]').onclick = async () => { const f = await ui.chooseFolder(api, { title: 'Choose the project folder' }); if (f) { v.folder = f; set({ ...v }); paint(); } };
        };
        paint(); set({ ...v });
      },
    };

    const questions = [providerStep, testStep, agentModel, checkerModel, effortStep, nameStep, installStep, projectStep];
    root.innerHTML = '<div class="setup-wrap"><div class="setup-head"><h1>Welcome to Jade</h1><p class="small dim">A few questions to get you started. It takes about two minutes.</p></div><div data-q></div></div>';
    const answers = { name: info.name, model: info.agentModels.model, checkerModel: info.agentModels.checkerModel, effort: { chat: info.efforts?.chat || '', agents: info.efforts?.agents || '' }, install: '', provider: info.provider.style };
    runQuestionnaire(root.querySelector('[data-q]'), {
      title: 'Set-up', questions, answers, api, doneLabel: 'Finish set-up',
      onCancel: () => go('home'),
      onDone: a => finishSetup(a, { api, ui, state, go }),
    });
  },
};
