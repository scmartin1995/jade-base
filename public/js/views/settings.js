import { effortOptions, EFFORT_HELP } from '../efforts.js';
import { STYLE_BOXES, PROVIDER_FIELDS, wireProviderForm, importClaudeSettings, showDiagnose } from '../providerform.js';
// Settings: one section at a time, chosen from the rail on the left (route: settings/<section>). Everything saves to
// JadeBase/config.json as you change it; the engine's connection goes to JadeBase/engine.env.
const SECTIONS = [
  ['engine', 'Engine', 'cpu', 'How Jade reaches Claude through Claude Code'],
  ['permissions', 'Permissions', 'check', 'What Jade may change, and when it asks first'],
  ['connectors', 'Connectors', 'link', 'Gmail, Calendar, Drive and other apps Claude Code is connected to'],
  ['files', 'Files', 'folder', 'The folders Jade reads, and where your data lives'],
  ['voice', 'Voice', 'mic', 'The wake word, the microphone and spoken replies'],
  ['modules', 'Modules', 'toggle', 'Switch parts of Jade on or off'],
  ['privacy', 'Privacy', 'external', 'What leaves this computer, with a switch for each'],
  ['you', 'You', 'users', 'Your name, Jade\'s name, the wake word'],
  ['look', 'Look', 'sun', 'Theme and colours'],
  ['meetings', 'Meetings and automated agents', 'mic', 'Which models the background agents use, and what happens to meeting results'],
  ['schedule', 'Schedule', 'clock', 'When the agents run on their own'],
  ['updates', 'Updates', 'refresh', 'Whether Jade looks for a newer version of itself, and Claude Code\'s version'],
  ['dreams', 'Dreams', 'moon', 'What Dreams reads, and whether it looks outside the work'],
];

export default {
  title: 'Settings',
  refreshOn: ['config', 'schedule', 'memory', 'engines', 'update'],
  async render(root, ctx) {
    const { api, ui, state, voice } = ctx;
    const { esc, icon } = ui;
    const c = state.boot.config;
    const e = state.boot.engines;
    const dreamsOn = !!state.boot.modules.find(m => m.id === 'dreams')?.enabled;
    const SECS = SECTIONS.filter(([id]) => id !== 'dreams' || dreamsOn);   // the Dreams section is there only while the module is on
    const sec = SECS.some(([id]) => id === ctx.params[0]) ? ctx.params[0] : (this._sec || 'engine');
    this._sec = sec;
    const need = id => sec === id;
    const [schedule, modelStatus, mem, prov, connectors, perm, setupInfo, upd] = await Promise.all([
      need('schedule') ? api('GET', '/api/schedule') : [],
      need('voice') ? api('GET', '/api/voice/model-status').catch(() => ({})) : {},
      need('files') ? api('GET', '/api/memory/stats').catch(() => ({ folders: [] })) : { folders: [] },
      need('engine') || need('connectors') || need('privacy') ? api('GET', '/api/engine/provider').catch(() => ({ style: 'plan', mode: 'subscription', label: '', extra: [] })) : { style: 'plan', mode: 'subscription', label: '' },
      need('connectors') || need('privacy') ? api('GET', '/api/connectors').catch(() => []) : [],
      need('permissions') ? api('GET', '/api/permissions').catch(() => ({ mode: 'irreversible', modes: {}, pending: [], zones: { free: [], protected: [] }, changes: [] })) : null,
      need('meetings') ? api('GET', '/api/setup').catch(() => null) : null,   // the models the agents will really use, decided on the server
      need('updates') ? api('GET', '/api/updates').catch(() => ({ ...(state.boot.update || {}), claude: '' })) : null,
    ]);
    const vs = voice.status();
    const pill = (ok, yes, no) => `<span class="chip ${ok ? 'on' : ''}" style="height:22px">${ok ? icon('check', 12) : icon('x', 12)}${esc(ok ? yes : no)}</span>`;
    const mods = state.boot.modules.filter(m => !m.core);
    const agentsFor = id => state.boot.agents.filter(a => a.module === id && !a.hidden).map(a => a.name);
    const group = (title, body, { note = '', action = '' } = {}) => `<section class="card setting-group"><div class="card-head"><h2>${esc(title)}</h2>${action}</div>${note ? `<p class="small dim" style="margin:-4px 0 12px">${note}</p>` : ''}${body}</section>`;
    const rowSwitch = (title, desc, k, on, extra = '') => `<div class="item row" style="padding:10px 0"><div class="grow"><div class="title" style="color:var(--fg-soft)">${title}</div><div class="tiny muted">${desc}</div></div><label class="switch"><input type="checkbox" data-k="${k}" data-bool ${on ? 'checked' : ''} aria-label="${esc(title)}" ${extra}><span></span></label></div>`;
    const models = state.boot.models?.choices || [];
    const noModels = 'No models were found. <a href="#" data-diagnose-link>Run Diagnose</a>';   // shown wherever a model list would be, when it is empty
    const current = SECS.find(([id]) => id === sec);

    let body = '';
    if (sec === 'engine') {
      const claudeOk = e.claude.installed && (prov.style !== 'plan' || e.claude.loggedIn !== false);
      body = group('1 · Claude Code', `
          <div class="list">
            <div class="item"><div class="main-col"><div class="title">Claude Code</div><div class="meta">${esc(e.claude.bin || 'not found on PATH')}</div></div>${pill(e.claude.installed, 'installed', 'missing')}${e.claude.installed ? (prov.style !== 'plan' ? pill(true, prov.mode === 'gateway' ? 'via gateway' : 'via Amazon Bedrock', '') : pill(e.claude.loggedIn, 'signed in', 'run: claude auth login')) : ''}</div>
          </div>
          ${!e.claude.installed ? `<div class="small" style="color:var(--warn);margin-top:8px">Install Claude Code: <code>npm i -g @anthropic-ai/claude-code</code>, then sign in.</div>` : ''}`,
        { note: 'Jade drives Claude Code headless, on the plan you already have.', action: `<button class="btn sm ghost" data-recheck>${icon('refresh', 14)}Re-check</button>` })
      + group('2 · How Claude Code reaches Claude', `
          ${STYLE_BOXES(prov, e)}
          ${PROVIDER_FIELDS(prov)}
          <div class="row wrap" style="gap:10px;align-items:center;margin-top:12px"><button class="btn sm primary" data-save-provider>${icon('check', 14)}${prov.style === 'plan' ? 'Save' : 'Check and save'}</button><button class="btn sm ghost" data-test-provider ${claudeOk ? '' : 'disabled'}>${icon('play', 14)}Check the connection</button><button class="btn sm ghost" data-diagnose ${e.claude.installed ? '' : 'disabled'}>${icon('doc', 14)}Diagnose</button><span class="tiny muted">${prov.style === 'plan' ? 'Check sends one short question to Claude.' : `Written to <code>${esc(prov.file || 'engine.env')}</code> (mode 600). Jade never signs in to AWS itself.`}</span></div>`,
        { note: 'Where the questions go. At work, paste the address and key from your gateway team; everything else is optional.' })
      + group('3 · Models here', `
          <div class="row wrap" style="gap:6px">${models.length ? models.slice(0, 16).map(m => `<span class="chip ${m.id === models.find(x => x.note === 'current')?.id ? 'on' : ''}" title="${esc(m.note)}">${esc(m.label)}</span>`).join('') + (models.length > 16 ? `<span class="tiny muted">+${models.length - 16} more</span>` : '') : `<span class="small" style="color:var(--warn)">${noModels}</span>`}</div>
          <div class="tiny muted" style="margin-top:8px">${state.boot.models?.current ? `Current: ${esc(state.boot.models.current)} · ` : ''}${(state.boot.models?.notes || []).map(esc).join(' ') || 'Read from Claude Code and from the endpoint\'s own list.'}</div>`,
        { note: 'What this endpoint offers, discovered rather than typed in. The chat\'s model chip offers the same list.', action: `<button class="btn sm ghost" data-models-refresh>${icon('refresh', 13)}Refresh</button>` })
      + group('4 · Defaults', `
          <div class="form">
          <div class="two"><label class="field">Default Claude model <small>${models.length ? 'for new chats; pick per chat from the chip' : noModels}</small><select data-k="models.claude">${[['', models.length ? 'Automatic (the everyday model Jade finds)' : 'No models found'], ...models.map(m => [m.id, m.label])].filter(([v], i, a) => a.findIndex(x => x[0] === v) === i).map(([v, l]) => `<option value="${esc(v)}" ${(c.models.claude || '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}${c.models.claude && !models.some(m => m.id === c.models.claude) ? `<option value="${esc(c.models.claude)}" selected>${esc(c.models.claude)}</option>` : ''}</select></label>
          <label class="field">Agents at once <small>chats never wait behind agents</small><select data-k="concurrency" data-num>${[1, 2, 3, 4].map(n => `<option ${n === c.concurrency ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div></div>`)
      + group('How hard Jade thinks', `<div class="form">
          <label class="field">In chats <small>for one chat you can change it from the model menu under the message</small><select data-k="chat.effort">${effortOptions(c.chat?.effort)}</select></label>
          <label class="field">In automated work (meetings, dashboards, agents) <small>reading transcripts, building dashboards and the routines that run on their own</small><select data-k="agents.effort">${effortOptions(c.agents?.effort)}</select></label>
          <label class="field">For the agent that checks the work <small>blank means the same as automated work</small><select data-k="agents.checkerEffort">${effortOptions(c.agents?.checkerEffort, 'Same as automated work')}</select></label></div>`,
        { note: `${esc(EFFORT_HELP)} An agent's own file can set its own level with <code>jade-effort</code>, and that wins for that agent.` });
    } else if (sec === 'permissions') {
      body = group('Mode', `<div class="grid g2" style="gap:10px">${Object.entries(perm.modes).map(([k, m]) => `<label class="mod-row choice ${perm.mode === k ? '' : 'off'}">
            <input type="radio" name="perm-mode" value="${k}" ${perm.mode === k ? 'checked' : ''}>
            <div class="grow"><div class="title" style="font-weight:500;color:var(--fg-bright)">${esc(m.label)}${k === 'irreversible' ? ' <span class="tiny muted">recommended</span>' : ''}</div><div class="tiny muted">${esc(m.desc)}</div></div></label>`).join('')}</div>
          ${perm.pending.length ? `<div class="small" style="margin-top:12px;color:var(--warn)">${perm.pending.length} question${perm.pending.length === 1 ? '' : 's'} waiting for you: ${perm.pending.map(p => esc(p.label)).join(' · ')}</div>` : ''}`,
        { note: 'In chat and when running a skill, Jade edits like Claude Code: it creates and edits files and runs commands. Every change is logged; edits keep the previous version.' })
      + group('Where Jade may create and edit files', `
          <div class="mono small" style="color:var(--fg-soft)">~ (everything in your home folder)</div>
          ${(c.permissions?.roots || []).map(r => `<div class="row" style="gap:6px"><div class="mono small ellipsis grow" style="color:var(--fg-soft)" title="${esc(r)}">${esc(r)}</div><button class="btn sm ghost icon danger" data-rm-root="${esc(r)}" aria-label="Remove ${esc(r)}">${icon('x', 12)}</button></div>`).join('')}
          <div class="tiny muted" style="margin-top:8px">Edits anywhere here keep the previous version; deleting asks first. Jade's own working files (<span class="mono">${esc(perm.zones.free.slice(0, 2).map(z => z.replace(state.boot.userHome, '~')).join(', '))}</span>) never ask. Everything else on the computer is refused.</div>`,
        { action: `<button class="btn sm ghost" data-add-root>${icon('plus', 13)}Add folder</button>`, note: 'Add a folder for another drive or a network share.' })
      + group(`Recent changes by Jade (${perm.changes.length})`, `<div class="list" data-changes>${perm.changes.slice(0, 25).map(ch => `<div class="item" style="padding:6px 0"><div class="main-col"><div class="small ellipsis" style="color:var(--fg-soft)">${esc(ch.label)}</div><div class="tiny muted">${esc(ui.ago(ch.at))} · ${esc(ch.decision)}${ch.note ? ' · ' + esc(ch.note) : ''}</div></div>
              ${ch.backup ? `<button class="btn sm ghost" data-restore="${esc(ch.id)}">${icon('refresh', 13)}Restore</button>` : ''}</div>`).join('') || '<div class="tiny muted">Nothing yet.</div>'}</div>`, { note: 'Restore puts a kept version back; today\'s version is kept too.' });
    } else if (sec === 'connectors') {
      body = group('Connected through Claude Code', `<div class="list">
            ${connectors.map(x => `<div class="item"><div class="main-col"><div class="title">${esc(x.name)}</div><div class="meta">${x.id === 'web' ? 'WebSearch and WebFetch, only when a question asks for the web' + (x.bedrock ? ' · WebSearch is not available on Bedrock' : '') : (x.official ? 'claude.ai connector' : 'MCP server, registered in Claude Code for you') + (x.curated ? ' · read-only tools only' : ' · all of its tools, attached only when you name it in a chat')}</div></div>
              ${x.id === 'web' ? '' : pill(x.connected, 'connected', x.status || 'not connected')}
              <label class="switch"><input type="checkbox" data-conn="${esc(x.id)}" ${x.enabled ? 'checked' : ''} aria-label="Let Jade use ${esc(x.name)}"><span></span></label>
              ${!x.official && x.id !== 'web' ? `<button class="btn sm ghost icon danger" data-rm-conn="${esc(x.full)}" title="Remove from Claude Code" aria-label="Remove ${esc(x.name)}">${icon('x', 14)}</button>` : ''}</div>`).join('')}
            ${!connectors.filter(x => x.id !== 'web').length ? `<div class="item"><div class="main-col"><div class="meta">${e.claude.installed ? 'No connectors yet. Add one on claude.ai or by URL.' : 'Install Claude Code to use connectors.'}</div></div></div>` : ''}
          </div>
          ${prov.style !== 'plan' ? `<p class="small" style="margin-top:10px;color:var(--warn)">While Claude Code uses ${prov.mode === 'gateway' ? 'a gateway' : 'Amazon Bedrock'}, it switches claude.ai connectors (Gmail, Calendar, Drive, Dropbox…) off: they belong to a claude.ai sign-in. MCP servers added by URL keep working, as do local files.</p>` : ''}`,
        { note: `Everything Claude Code is connected to (<code>claude mcp list</code>). Set one up once and it shows in Claude and in Jade; the switch says whether Jade may use it${e.checking ? ' · checking…' : ''}. claude.ai connectors are managed on <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">claude.ai → Settings → Connectors</a>.`, action: `<button class="btn sm primary" data-add-conn>${icon('plus', 14)}Add connector</button>` })
      + group('Built in', `<div class="list">
            <div class="item"><div class="main-col"><div class="title">Local files</div><div class="meta">${esc(c.memory.folders.join(' · ') || 'none added yet')}</div></div>${pill(true, 'built in', '')}</div></div>`);
    } else if (sec === 'files') {
      body = group('Folders Jade reads', `<div>${c.memory.folders.map(f => { const st = (mem.folders || []).find(x => x.folder === f); return `<div class="folder-row">${icon('folder', 17)}
            <div class="grow" style="min-width:0"><div class="mono small ellipsis" style="color:var(--fg-soft)">${esc(f)}</div>
            <div class="tiny ${st?.exists ? 'muted' : ''}" style="${st?.exists ? '' : 'color:var(--warn)'}">${st?.exists ? `${st.files} file${st.files === 1 ? '' : 's'} indexed` : 'folder not found'}</div></div>
            <button class="btn sm ghost icon danger" data-rm-folder="${esc(f)}" title="Stop reading this folder" aria-label="Remove ${esc(f)}">${icon('x', 14)}</button></div>`; }).join('') || '<div class="tiny muted">No folders added yet.</div>'}</div>
          <p class="tiny muted" style="margin:10px 0 0">For a single project's documents, open the project and use <b>Edit → Project folders</b>. Reads ${esc(c.memory.extensions.join(', '))} files; other types still show up by name.</p>`,
        { note: 'Notes, plans, meeting minutes, an Obsidian vault, a OneDrive or Dropbox folder. Sub-folders are included. Jade remembers by reading these and answers from them. None are set until you add one; project folders are always read.', action: `<button class="btn sm primary" data-add-folder>${icon('plus', 14)}Add folder</button>` })
      + group('Folder Jade keeps a project\'s material in', `<div class="form"><label class="field">Folder name <small>made inside the project's first folder</small><input data-k="storage.folderName" value="${esc(c.storage?.folderName ?? 'Jade')}" placeholder="Jade" maxlength="60"></label></div>`,
        { note: 'A project\'s notes, actions, meetings and dashboards are kept in a folder with this name inside its first project folder, so they sit with the project\'s own files. Changing the name does not move anything already saved: rename that folder yourself to match.' })
      + group('Where Jade saves what it makes', `<div class="folder-row">${icon('folder', 17)}
            <div class="grow" style="min-width:0"><div class="mono small ellipsis" style="color:var(--fg-soft)">${esc(c.output?.folder || state.boot.paths.deliverables || 'Jade\'s own folder')}</div>
            <div class="tiny muted">${c.output?.folder ? 'Your folder. Jade puts new files in a sub-folder, never loose at its top level.' : 'Jade\'s own folder (the default).'}</div></div>
            <button class="btn sm" data-pick-output>${icon('folder', 13)}Choose a folder</button>
            ${c.output?.folder ? `<button class="btn sm ghost" data-clear-output title="Go back to Jade's own folder">Use Jade's folder</button>` : ''}</div>`,
        { note: 'New files Jade makes for a project with no folder of its own go here: dashboards, documents, exports. A project with a folder keeps its files there, and edits to your existing files happen in place with the earlier version kept. Files already made are not moved.' })
      + group('Keeping it tidy', `${rowSwitch('Delete pasted pictures once they are written up', 'A picture pasted into a chat is a copy of something you already have. When Jade has written what it shows into a file, the copy is deleted. Say "keep the image" in the message to keep one. Other attachments are removed after 30 days.', 'chat.releaseImages', c.chat?.releaseImages !== false)}`)
      + group('Your data', `<p class="small dim" style="margin:0">Everything lives in <code>${esc(state.boot.paths.home)}</code> as plain files: projects (JSON), notes (Markdown), actions, memory, your skills and agents. Back it up or sync it like any folder. Set <code>JADE_HOME</code> to keep it somewhere else. Where Jade may <i>write</i> is under <a href="#/settings/permissions">Permissions</a>.</p>`);
    } else if (sec === 'voice' && !state.boot.modules.find(m => m.id === 'voice')?.enabled) {
      // nothing here is listening: with Voice off, the microphone controls would read as if it were
      body = group('Voice is switched off', `<p class="small dim" style="margin:0 0 10px">The microphone is not in use and nothing is being listened to. To use the wake word and spoken replies, switch Voice on under Modules.</p><a class="btn sm primary" href="#/settings/modules">Open Modules</a>`);
    } else if (sec === 'voice') {
      body = group('Listening', `
          ${rowSwitch(`Listen for “${esc(c.wakeWord)}”`, 'The microphone stays on while Jade is open. Everything is recognised on this computer. Esc cancels an accidental wake.', 'voice.wake', c.voice.wake)}
          <div style="margin-top:6px"><div class="mic-meter" title="Microphone level"><div class="mic-bar" data-level></div></div><div class="tiny muted" style="margin-top:4px">Microphone check: say something and the bar should move. If it doesn't, pick another microphone below.</div></div>
          ${vs.micDenied ? `<button class="btn primary" data-mic-retry style="margin-top:10px">${icon('mic', 15)}Allow the microphone</button>` : ''}
          <div class="form" style="margin-top:12px"><div class="two">
            <label class="field">Microphone<select data-k="voice.deviceId" data-mics><option value="">System default</option></select></label>
            <label class="field">Sensitivity <small>how clearly the wake word must be heard</small><select data-k="voice.sensitivity">
              <option value="relaxed" ${c.voice.sensitivity === 'relaxed' ? 'selected' : ''}>Relaxed: wakes easily, may wake by mistake now and then</option>
              <option value="normal" ${!c.voice.sensitivity || c.voice.sensitivity === 'normal' ? 'selected' : ''}>Normal</option>
              <option value="strict" ${c.voice.sensitivity === 'strict' ? 'selected' : ''}>Strict: only a clear “hey jade”</option></select></label></div></div>
          ${vs.error && !vs.micDenied ? `<div class="tiny" style="color:var(--warn);margin-top:8px">${esc(vs.error)}</div>` : ''}`,
        { note: `<span class="mono" style="color:${vs.mode === 'wake' || vs.mode === 'command' ? 'var(--cyan)' : vs.micDenied ? 'var(--warn)' : 'var(--muted)'}">${vs.mode === 'wake' ? '● listening for “' + esc(c.wakeWord) + '”' : vs.mode === 'command' ? '● hearing you' : vs.micDenied ? 'microphone blocked' : c.voice.wake ? 'starting…' : 'not listening'}</span> · listening is Jade's resting state; the window you are using is the one that listens.` })
      + group('Recognition and replies', `<div class="form"><div class="two">
            <label class="field">Recognition engine<select data-k="voice.engine">
              <option value="auto" ${c.voice.engine === 'auto' ? 'selected' : ''}>Auto: browser speech, offline fallback</option>
              <option value="webspeech" ${c.voice.engine === 'webspeech' ? 'selected' : ''}>Browser speech (Chrome, Edge, Safari)</option>
              <option value="vosk" ${c.voice.engine === 'vosk' ? 'selected' : ''}>Offline, on-device (Vosk)</option></select></label>
            <div class="field">Offline model <small>40 MB, downloaded once, runs on this computer</small><div class="row wrap small" style="gap:8px;margin-top:4px">${(() => { const m = modelStatus.small || {}; return `<span class="chip ${m.ready ? 'on' : ''}">${m.ready ? 'downloaded' : m.downloading ? 'downloading…' : 'not downloaded'}</span>${!m.ready && !m.downloading ? `<button class="btn sm" data-dl-model="small">${icon('download', 13)}Download</button>` : ''}`; })()}</div></div></div></div>
          ${rowSwitch('Speak replies', 'For requests you made by voice. Uses your system\'s voices.', 'voice.speak', c.voice.speak)}
          <details style="margin-top:6px"><summary class="tiny muted" style="cursor:pointer">What Jade heard recently</summary>
            <div class="stack" style="gap:4px;margin-top:8px" data-heard>${voice.lastHeard().slice(0, 8).map(h => `<div class="tiny mono" style="color:${h.woke ? 'var(--cyan)' : 'var(--fg-dim)'}">${h.woke ? '◆ woke · ' : h.mode === 'command' ? '→ request · ' : '· '}${esc(h.text)}</div>`).join('') || '<div class="tiny muted">Nothing yet. Say a few words.</div>'}</div></details>`);
    } else if (sec === 'modules') {
      body = group('Modules', `<div class="list">${mods.map(m => `<div class="mod-row ${m.enabled ? '' : 'off'}">
            <div class="ico">${icon(m.icon, 17)}</div>
            <div class="grow" style="min-width:0"><div class="title" style="font-weight:500;color:var(--fg-bright)">${esc(m.name)}</div><div class="tiny muted">${esc(m.desc)}${agentsFor(m.id).length ? ` · ${esc(agentsFor(m.id).join(', '))}` : ''}</div></div>
            <label class="switch"><input type="checkbox" data-mod="${esc(m.id)}" ${m.enabled ? 'checked' : ''} aria-label="${esc(m.name)}"><span></span></label></div>`).join('')}</div>`,
        { note: `${mods.filter(m => m.enabled).length} of ${mods.length} on. Switch off what you don't use; the data stays.` });
    } else if (sec === 'privacy') {
      body = group('What leaves this computer', `<div class="list">
            <div class="item"><div class="main-col"><div class="title">Your questions, and the context Jade builds for them</div><div class="meta">To Claude (${esc(prov.label || 'your plan')}). Includes the parts of your files an agent reads. Change it under Engine.</div></div></div>
            <div class="item"><div class="main-col"><div class="title">Connectors</div><div class="meta">Gmail, Calendar, Drive and the rest are called by Claude Code only when a question needs them. Each has its switch under Connectors.</div></div></div>
            <div class="item"><div class="main-col"><div class="title">Web search</div><div class="meta">Claude Code's WebSearch and WebFetch, only for questions that ask for the web.</div></div>
              <label class="switch"><input type="checkbox" data-conn="web" ${connectors.find(x => x.id === 'web')?.enabled ? 'checked' : ''} aria-label="Allow web search"><span></span></label></div>
            <div class="item"><div class="main-col"><div class="title">Fonts</div><div class="meta">Fraunces, Geist and Unbounded from Google Fonts. Off uses system fonts; takes effect on reload.</div></div>
              <label class="switch"><input type="checkbox" data-k="privacy.webFonts" data-bool ${c.privacy?.webFonts !== false ? 'checked' : ''} aria-label="Load web fonts"><span></span></label></div>
            <div class="item"><div class="main-col"><div class="title">Claude bridge</div><div class="meta">Lets a Claude Code session read your actions and add notes through Jade (see bridge/README.md). Off until you switch it on, and it still needs the secret Jade keeps in its data folder.</div></div>
              <label class="switch"><input type="checkbox" data-k="bridge.enabled" data-bool ${c.bridge?.enabled ? 'checked' : ''} aria-label="Allow the Claude bridge"><span></span></label></div>
            <div class="item"><div class="main-col"><div class="title">Update check</div><div class="meta">Every six hours git asks GitHub whether this copy of Jade is behind (details under Updates). Nothing about you or your work is sent.</div></div>
              <label class="switch"><input type="checkbox" data-k="updates.check" data-bool ${c.updates?.check !== false ? 'checked' : ''} aria-label="Look for a newer version of Jade"><span></span></label></div>
            <div class="item"><div class="main-col"><div class="title">Offline voice model</div><div class="meta">A 40 MB speech model downloaded once, when you ask for it under Voice. Your voice itself is recognised on this computer.</div></div></div>
          </div>
          <p class="tiny muted" style="margin-top:10px">Claude Code processes started by Jade run with <code>CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1</code>: no auto-update, telemetry or error reports from them.</p>`,
        { note: `Jade listens on 127.0.0.1 and keeps its own records (chats, projects, settings, caches) as files in <code>${esc(state.boot.paths.home)}</code>; what it makes for you goes where you chose under Files. These are the only things that go out. Jade has no analytics and reports nothing anywhere.` });
    } else if (sec === 'you') {
      body = group('You', `<div class="form"><div class="two"><label class="field">Your name<input data-k="name" value="${esc(c.name)}" placeholder="Used in greetings"></label>
          <label class="field">Assistant name<input data-k="assistantName" value="${esc(c.assistantName)}"></label></div>
          <label class="field">Wake word <small>say it, then your request (“Hey Jade, what's due this week?”)</small><input data-k="wakeWord" value="${esc(c.wakeWord)}"></label></div>`);
    } else if (sec === 'look') {
      body = group('Window', `<div class="form"><label class="field">When Jade starts, open it in<select data-k="window">
          <option value="app" ${c.window !== 'tab' ? 'selected' : ''}>Its own window (no address bar or tabs)</option>
          <option value="tab" ${c.window === 'tab' ? 'selected' : ''}>A tab in my browser</option></select></label></div>`,
        { note: 'Used the next time you start Jade. Needs Chrome, Edge, Chromium or Brave for its own window; with none of them, or in Firefox or Safari, Jade opens a tab. <code>JADE_WINDOW=tab</code> or <code>--tab</code> overrides this.' })
      + group('Theme', `<p class="help">Jade uses its built-in Osaka Jade look.</p>
          <div class="row" style="gap:6px;margin-top:8px">${['accent', 'cyan', 'background', 'lighter_background', 'foreground', 'bright_foreground', 'magenta', 'yellow', 'red'].map(k => `<span title="${k}" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--line-hi);background:${esc(state.boot.theme[k])}"></span>`).join('')}</div>`);
    } else if (sec === 'meetings') {
      const modelPick = (key, label, help) => { const cur = c.agents?.[key] || '';
        return `<label class="field">${label} <small>${help}</small><select data-k="agents.${key}">${[['', models.length ? 'Not chosen (Jade decides)' : 'No models were found'], ...models.map(m => [m.id, m.label])].filter(([v], i, a) => a.findIndex(x => x[0] === v) === i)
          .map(([v, l]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}${cur && !models.some(m => m.id === cur) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ''}</select></label>`; };
      const usedNote = u => {   // what a run will really use, so a blank choice is not a mystery
        if (!u) return '';
        const say = (who, r) => `${who}: ${r.model ? esc(r.model) : 'Claude\'s own default'}${r.source === 'one-size-up' ? ' (one size above the agents)' : ''}${r.note ? ` — ${esc(r.note)}` : ''}`;
        return `<br>In use now. ${say('Agents', u.agents)}. ${say('Checking agent', u.checker)}.`;
      };
      body = group('Models for the automated agents', `<div class="form"><div class="two">
          ${modelPick('model', 'Agents that do the work', models.length ? 'reads and sorts, for example meeting transcripts' : noModels)}
          ${modelPick('checkerModel', 'Agent that checks the work', models.length ? 'left as “Not chosen”, it is one size above the agents’ model' : noModels)}</div></div>`,
        { note: `Only models Claude reports are listed. They are found for you; nothing is typed in.${usedNote(setupInfo?.used)}` })
      + group('Meeting results', `<div class="form"><label class="field">When a meeting has been read <small>what happens to the results</small><select data-k="meetings.accept">
          <option value="review" ${(c.meetings?.accept || 'review') === 'review' ? 'selected' : ''}>I look through the results and tick what to keep</option>
          <option value="auto" ${c.meetings?.accept === 'auto' ? 'selected' : ''}>Keep everything the checking agent supported</option></select></label></div>`)
      + group('Long transcripts', `<div class="form"><label class="field">Longest transcript Jade will read <small>in characters; about 55,000 make an hour of talk</small><input type="number" min="10000" step="10000" data-k="meetings.maxChars" data-num value="${esc(c.meetings?.maxChars || 400000)}"></label></div>`,
        { note: 'Jade cannot find out how much text each model can take in, so it uses this fixed limit instead. A transcript longer than this is not read at all: Jade stops and asks you to split it into shorter parts. Raise it only if your model copes with very long text.' })
      + group('Set-up', `<p class="small dim" style="margin:0 0 10px">Go through the first-run questions again: how Claude Code connects, the models, your name and a first project.</p><button class="btn sm" data-rerun-setup>${icon('refresh', 13)}Run set-up again</button>`);
    } else if (sec === 'dreams') {
      const dc = c.dreams || {};
      const scope = dc.claude || 'projects';
      body = group('What Dreams reads from Claude Code', `<div class="form"><label class="field">Which Claude Code conversations <small>Dreams reads what was typed to Claude and what Claude answered, to find work that repeats. It never reads what tools returned, the contents of files, or Claude's thinking.</small><select data-k="dreams.claude">
          <option value="projects" ${scope === 'projects' ? 'selected' : ''}>Only conversations in my Jade projects' folders</option>
          <option value="all" ${scope === 'all' ? 'selected' : ''}>Every Claude Code conversation on this computer</option>
          <option value="off" ${scope === 'off' ? 'selected' : ''}>None: only Jade's own work</option></select></label></div>`,
        { note: 'This text is sent to the model you have chosen for Jade\'s automated agents (the one Claude Code reaches through your plan, Bedrock or gateway), and nowhere else. Jade\'s own background runs are never counted as your conversations.' })
      + group('Looking outside the work', `${rowSwitch('Let Dreams search the web', 'Off by default. When on, Dreams may search for new methods and tools that could help, using general terms only: never your name, your company, your projects or your files. When off, it has no web tools and brings back no outside ideas.', 'dreams.web', dc.web === true)}`)
      + group('How much it reads', `<div class="form"><div class="two">
          <label class="field">Days to look back <small>the last week by default</small><input type="number" min="1" max="30" data-k="dreams.days" data-num value="${esc(dc.days || 7)}"></label>
          <label class="field">Most text from one conversation <small>in characters; longer ones are cut, and the cut is marked</small><input type="number" min="500" step="500" data-k="dreams.maxCharsPerSession" data-num value="${esc(dc.maxCharsPerSession || 6000)}"></label></div>
          <label class="field">Most text from Claude Code in all <small>in characters; older conversations beyond this are left out, and that is marked</small><input type="number" min="2000" step="5000" data-k="dreams.maxChars" data-num value="${esc(dc.maxChars || 60000)}"></label></div>`,
        { note: 'The nightly run happens only when both Dreams and Routines are switched on under Modules. Dream now on the Dreams page works whenever Dreams is on.' });
    } else if (sec === 'updates') {
      const u = upd || {};
      const n = u.behind || 0;
      const say = {   // where this copy stands, in plain words (server/core/updates.js names the states)
        current: 'Jade is up to date.',
        behind: `${n} new change${n === 1 ? ' is' : 's are'} waiting on GitHub.`,
        diverged: 'This copy of Jade has changes of its own that GitHub does not have, so it cannot update itself. Ask whoever set it up.',
        unreachable: 'GitHub could not be reached at the last check. Jade tries again later.',
        'not-git': 'This copy of Jade was not installed with git, so it cannot look for updates. Download new versions from GitHub.',
        'no-upstream': 'This copy of Jade does not follow a branch on GitHub, so there is nothing to compare it with.',
        'no-branch': 'This copy of Jade is not on a branch, so there is nothing to compare it with.',
        gone: 'The branch this copy of Jade follows could not be found on GitHub (it may have been deleted).',
        'no-git': 'git is not installed on this computer, so Jade cannot look for updates. Download new versions from GitHub.',
        'not-trusted': 'git will not work in this copy of Jade because the folder belongs to another user account on this computer.',
      }[u.state] || 'Not checked yet.';
      body = group('Jade', `
          <div class="item row" style="padding:6px 0 10px"><div class="grow"><div class="title" style="color:var(--fg-bright)">${esc(say)}</div><div class="tiny muted">${u.checkedAt ? `Last checked ${esc(ui.ago(u.checkedAt))}` : 'Not checked since Jade started'}${u.branch ? ` · following ${esc(u.branch)}` : ''}</div></div></div>
          ${u.state === 'behind' && u.latest?.length ? `<div class="small" style="margin:0 0 10px"><div class="tiny muted" style="margin-bottom:4px">What changed</div><ul style="margin:0;padding-left:18px">${u.latest.map(s => `<li>${esc(s)}</li>`).join('')}</ul>${n > u.latest.length ? `<div class="tiny muted">and ${n - u.latest.length} more</div>` : ''}</div>` : ''}
          <div class="row wrap" style="gap:10px;align-items:center">${u.state === 'behind' ? `<button class="btn sm primary" data-update-now>${icon('refresh', 14)}Update now</button>` : ''}<button class="btn sm ghost" data-update-check>${icon('refresh', 14)}Check now</button></div>
          ${rowSwitch('Look for a newer version', 'Every six hours, and a minute after Jade starts, Jade asks GitHub whether its copy is behind. Only Jade\'s own address on GitHub is contacted; nothing about you or your work is sent.', 'updates.check', c.updates?.check !== false)}`,
        { note: 'Update now brings this copy level with GitHub. It never overwrites changes made in this copy; if it would, it stops and says why. Jade restarts by itself afterwards, once nothing is running.' })
      + group('Node', `<div class="item"><div class="main-col"><div class="title">Node ${esc(state.boot.node?.version || '')}</div><div class="meta">${state.boot.node?.warning ? `<span style="color:var(--warn)">${esc(state.boot.node.warning)}</span>` : `Supported. Jade needs Node ${esc(state.boot.node?.min || '')} or newer; Node itself is updated outside Jade.`}</div></div></div>`)
      + group('Claude Code', `<div class="item"><div class="main-col"><div class="title">Claude Code ${u.claude ? esc(u.claude) : ''}</div><div class="meta">${e.claude.installed ? 'Jade turns off Claude Code\'s own automatic updates for the work it starts. To update Claude Code, run <code>claude update</code> in a terminal now and then.' : 'Claude Code was not found on this computer. See Engine.'}</div></div></div>`);
    } else if (sec === 'schedule') {
      body = group('When the agents run', `<div class="table-wrap"><table class="t"><thead><tr><th>What</th><th>When</th><th>Last run</th><th>Next</th></tr></thead><tbody>
            ${schedule.map(t => `<tr><td>${esc(t.name)} <span class="tiny muted">${esc(t.kind)}${t.perProject ? ' · per project' : ''}</span></td><td class="mono small">${esc(t.schedule)}</td><td class="small">${t.lastRun ? esc(ui.ago(t.lastRun)) : '—'}</td><td class="small">${t.nextRun ? esc(new Date(t.nextRun).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })) : t.schedule.startsWith('every') ? 'rolling' : '—'}</td></tr>`).join('')}
          </tbody></table></div>`, { note: state.boot.modules.find(m => m.id === 'routines')?.enabled ? 'Missed runs catch up within 12 hours. Change any of these on the Routines page.' : 'Missed runs catch up within 12 hours. Agents do not run on their own until Routines is switched on under Modules.' });
      body = `<div class="card" style="margin-bottom:12px;padding:12px 14px">${icon('clock', 14)} Schedules are set on <a href="#/routines">Routines</a>: routines, skill automations, the agents' schedules and Jade's upkeep, all in one place.</div>` + body;
    }

    root.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">Preferences</div><h1>Settings</h1><p>Changes save as you make them.</p></div>
      </div>
      <div class="settings-layout">
        <nav class="settings-rail" aria-label="Settings sections">${SECS.map(([id, l, ic]) => `<button class="${sec === id ? 'on' : ''}" data-sec="${id}">${icon(ic, 15)}<span>${esc(l)}</span></button>`).join('')}</nav>
        <div class="settings-body">
          <div class="settings-title"><h2>${icon(current[2], 20)}${esc(current[1])}</h2><p class="dim">${esc(current[3])}</p></div>
          ${body}
        </div>
      </div>`;

    // ---- behaviour
    root.querySelectorAll('[data-sec]').forEach(b => b.onclick = () => { this._sec = b.dataset.sec; ctx.go('settings/' + b.dataset.sec); });
    const set = (path, value) => {
      const patch = {}; let o = patch; const keys = path.split('.');
      keys.slice(0, -1).forEach(k => { o = o[k] = {}; });
      o[keys.at(-1)] = value;
      return api('POST', '/api/config', patch).then(() => ui.toast('Saved', 'success', 1000)).catch(err => ui.toast(err.message, 'error'));
    };
    root.querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', () => set(el.dataset.k, el.hasAttribute('data-bool') ? el.checked : el.hasAttribute('data-num') ? Number(el.value) : el.value)));
    root.querySelectorAll('input[name="perm-mode"]').forEach(r => r.onchange = async () => {
      try { await api('POST', '/api/permissions/mode', { mode: r.value }); ui.toast(`Permissions: ${perm.modes[r.value]?.label || r.value}`, 'success', 2000); this.render(root, ctx); } catch (err) { ui.toast(err.message, 'error'); }
    });
    root.querySelector('[data-add-root]')?.addEventListener('click', async () => {
      const f = await ui.chooseFolder(api, { title: 'Choose a folder Jade may edit' });
      if (!f) return;
      const roots = c.permissions?.roots || [];
      if (roots.includes(f)) return ui.toast('Already allowed', 'info');
      await api('POST', '/api/config', { permissions: { roots: [...roots, f] } }); ui.toast('Jade may now edit ' + f, 'success');
    });
    root.querySelectorAll('[data-rm-root]').forEach(b => b.onclick = async () => { await api('POST', '/api/config', { permissions: { roots: (c.permissions?.roots || []).filter(x => x !== b.dataset.rmRoot) } }); });
    root.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
      if (!await ui.confirmBox('Restore this version?', 'Today\'s version is kept too, so this can be undone.', 'Restore')) return;
      try { const r = await api('POST', `/api/changes/${b.dataset.restore}/restore`); ui.toast(`Restored ${r.path}`, 'success'); this.render(root, ctx); } catch (err) { ui.toast(err.message, 'error'); }
    });
    root.querySelector('[data-pick-output]')?.addEventListener('click', async () => {
      const f = await ui.chooseFolder(api, { title: 'Choose where Jade saves what it makes' });
      if (!f) return;
      await api('POST', '/api/config', { output: { folder: f }, permissions: { roots: [...new Set([...(c.permissions?.roots || []), f])] } });
      ui.toast('Jade will save new files in ' + f, 'success');
    });
    root.querySelector('[data-clear-output]')?.addEventListener('click', async () => { await api('POST', '/api/config', { output: { folder: '' } }); });
    root.querySelector('[data-add-folder]')?.addEventListener('click', async () => {
      const f = await ui.chooseFolder(api, { title: 'Choose a folder for Jade to read' });
      if (!f) return;
      if (c.memory.folders.includes(f)) return ui.toast('Jade already reads ' + f, 'info');
      await api('POST', '/api/config', { memory: { folders: [...c.memory.folders, f] } });
      ui.toast('Jade will read ' + f, 'success');
    });
    root.querySelectorAll('[data-rm-folder]').forEach(b => b.onclick = async () => {
      if (await ui.confirmBox('Stop reading this folder?', b.dataset.rmFolder + ' will no longer be searched. Nothing is deleted.', 'Stop reading')) await api('POST', '/api/config', { memory: { folders: c.memory.folders.filter(x => x !== b.dataset.rmFolder) } });
    });
    root.querySelectorAll('[data-mod]').forEach(cb => cb.onchange = async () => {
      try { await api('POST', `/api/modules/${cb.dataset.mod}`, { enabled: cb.checked }); } catch (err) { ui.toast(err.message, 'error'); cb.checked = !cb.checked; }
    });
    root.querySelector('[data-rerun-setup]')?.addEventListener('click', async () => {
      try { await api('POST', '/api/setup/done', { done: false }); state.boot = await api('GET', '/api/boot'); ctx.go('setup'); } catch (err) { ui.toast(err.message, 'error'); }
    });
    root.querySelector('[data-update-check]')?.addEventListener('click', async ev => {
      ev.currentTarget.disabled = true;
      try { const s = await api('POST', '/api/updates/check'); state.boot.update = s; ui.toast(s.state === 'behind' ? 'A newer Jade is on GitHub' : s.state === 'current' ? 'Jade is up to date' : 'Checked', 'info', 2000); }
      catch (err) { ui.toast(err.message, 'error'); }
      this.render(root, ctx);
    });
    root.querySelector('[data-update-now]')?.addEventListener('click', async ev => {
      const b = ev.currentTarget; b.disabled = true; b.innerHTML = `${icon('refresh', 14)}Updating…`;
      try { const r = await api('POST', '/api/updates/apply'); if (!r.ok) ui.toast(r.reason, 'error', 9000); }
      catch (err) {   // no answer at all: the server may have restarted into the new version before it answered
        if (err instanceof TypeError) { ui.toast('Jade is restarting with the new version', 'info', 4000); return; }
        ui.toast(err.message, 'error', 9000);
      }
      this.render(root, ctx);
    });
    root.querySelector('[data-recheck]')?.addEventListener('click', async ev => { ev.currentTarget.disabled = true; await api('GET', '/api/engines?refresh=1'); state.boot = await api('GET', '/api/boot'); this.render(root, ctx); });

    // the engine's connection: plan or gateway, saved to engine.env, checked with one real question
    const form = wireProviderForm(root, prov, st => { const s = root.querySelector('[data-save-provider]'); if (s) s.innerHTML = icon('check', 14) + (st === 'plan' ? 'Save' : 'Check and save'); });
    const provStyle = () => form.style(), provData = () => form.data();
    const check = async () => {
      const r = await api('POST', '/api/engine/test');
      if (r.ok) ui.toast(`Claude answered in ${(r.ms / 1000).toFixed(1)} s${r.model ? ' · ' + r.model : ''} · ${r.provider}`, 'success', 6000); else ui.toast(`No reply via ${r.provider}: ${r.error}`, 'error', 9000);
      return r.ok;
    };
    root.querySelector('[data-save-provider]')?.addEventListener('click', async ev => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = provStyle() === 'plan' ? 'Saving…' : 'Checking…';
      try { await api('POST', '/api/engine/provider', provData()); if (provStyle() !== 'plan') await check(); else ui.toast('Back on your Claude plan', 'success'); state.boot = await api('GET', '/api/boot'); this.render(root, ctx); }
      catch (err) { ui.toast(err.message, 'error'); b.disabled = false; b.innerHTML = icon('check', 14) + (provStyle() === 'plan' ? 'Save' : 'Check and save'); }
    });
    root.querySelector('[data-test-provider]')?.addEventListener('click', async ev => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Checking…';
      try { await check(); } catch (err) { ui.toast(err.message, 'error'); }
      b.disabled = false; b.innerHTML = icon('play', 14) + 'Check the connection';
    });
    root.querySelector('[data-import-claude]')?.addEventListener('click', async () => {
      if (!await importClaudeSettings(api)) return;
      try { await check(); state.boot = await api('GET', '/api/boot'); this.render(root, ctx); } catch (err) { ui.toast(err.message, 'error', 8000); }
    });
    root.querySelector('[data-diagnose]')?.addEventListener('click', async ev => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Diagnosing…';
      try { await showDiagnose(api);
      } catch (err) { ui.toast(err.message, 'error'); }
      b.disabled = false; b.innerHTML = icon('doc', 14) + 'Diagnose';
    });
    root.querySelectorAll('[data-diagnose-link]').forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); showDiagnose(api).catch(err => ui.toast(err.message, 'error')); }));
    root.querySelector('[data-models-refresh]')?.addEventListener('click', async ev => {
      const b = ev.currentTarget; b.disabled = true;
      try { state.boot.models = await api('POST', '/api/models/refresh'); this.render(root, ctx); } catch (err) { ui.toast(err.message, 'error'); b.disabled = false; }
    });

    // connectors: switches, removal of user-added servers, and adding one (claude.ai, or an MCP server by URL)
    root.querySelectorAll('[data-conn]').forEach(cb => cb.onchange = async () => {
      try { await api('POST', `/api/connectors/${encodeURIComponent(cb.dataset.conn)}`, { enabled: cb.checked }); } catch (err) { ui.toast(err.message, 'error'); cb.checked = !cb.checked; }
    });
    root.querySelectorAll('[data-rm-conn]').forEach(b => b.onclick = async () => {
      if (!await ui.confirmBox('Remove this connector?', `${b.dataset.rmConn} will be removed from Claude Code for your user (claude mcp remove).`, 'Remove', 'danger')) return;
      try { await api('POST', '/api/connectors/remove', { name: b.dataset.rmConn }); ui.toast('Removed', 'success'); } catch (err) { ui.toast(err.message, 'error'); }
    });
    root.querySelector('[data-add-conn]')?.addEventListener('click', () => ui.modal({
      title: 'Add a connector', wide: true,
      body: `<p class="small dim" style="margin-top:0">Set a connector up once and it shows in Claude and in Jade.</p>
        <div class="list">
          <div class="item"><div class="main-col"><div class="title">An app on claude.ai</div><div class="meta">Gmail, Google Calendar, Drive, Dropbox, Notion, Slack and more: official connectors you sign in to on claude.ai. Claude Code gets them automatically and Jade re-checks for a few minutes after you open the page.</div></div><button type="button" class="btn sm primary" data-open-claude>${icon('external', 14)}Open claude.ai</button></div>
        </div>
        <form class="form" style="margin-top:14px">
          <div class="title" style="color:var(--fg-soft)">…or an MCP server by URL</div>
          <div class="tiny muted" style="margin-bottom:8px">Registered with Claude Code for your user (<code>claude mcp add --scope user</code>), so it appears in <code>claude</code> too. If the server needs a sign-in, run <code>claude</code> once and type <code>/mcp</code>. All of its tools are offered to Jade; switch it on in the list afterwards.</div>
          <div class="two"><label class="field">Name<input name="name" placeholder="e.g. my-server" pattern="[A-Za-z0-9][A-Za-z0-9_-]*" autocomplete="off"></label>
          <label class="field">Server URL<input name="url" placeholder="https://… (from the service's MCP docs)" autocomplete="off"></label></div>
        </form>`,
      actions: [{ label: 'Add server', kind: 'primary', icon: 'plus', onClick: async data => {
        if (!data.name || !data.url) { ui.toast('Name and URL are needed for an MCP server', 'info'); return false; }
        try { await api('POST', '/api/connectors/add', data); ui.toast(`${data.name} added. It shows in claude too.`, 'success'); } catch (err) { ui.toast(err.message, 'error'); return false; }
      } }],
      onMount: (wrap, close) => { wrap.querySelector('[data-open-claude]').onclick = () => { window.open('https://claude.ai/settings/connectors', '_blank', 'noopener'); close(null); let n = 0; const t = setInterval(() => { api('GET', '/api/engines?refresh=1').catch(() => {}); if (++n >= 10) clearInterval(t); }, 20000); ui.toast('Connect the app on claude.ai; Jade will notice it', 'info', 5000); }; },
    }));

    // voice: live microphone level, the microphone list, model download, a retry after a blocked mic
    if (this._onLevel) window.removeEventListener('jade:level', this._onLevel);   // one listener at a time, not one per redraw
    const onLevel = this._onLevel = ev => { const b = root.querySelector('[data-level]'); if (!b) return window.removeEventListener('jade:level', onLevel); b.style.width = Math.round(ev.detail * 100) + '%'; };
    window.addEventListener('jade:level', onLevel);
    if (sec === 'voice') voice.microphones().then(list => { const sel = root.querySelector('[data-mics]'); if (!sel || !list.length) return; sel.innerHTML = '<option value="">System default</option>' + list.map(m => `<option value="${esc(m.id)}" ${m.id === c.voice.deviceId ? 'selected' : ''}>${esc(m.label)}</option>`).join(''); });
    root.querySelector('[data-mic-retry]')?.addEventListener('click', () => voice.retry());
    root.querySelectorAll('[data-dl-model]').forEach(b => b.onclick = async () => {
      b.disabled = true; b.textContent = 'Downloading…';
      try { await api('POST', '/api/voice/model', { size: b.dataset.dlModel }); ui.toast(`${b.dataset.dlModel} voice model ready`, 'success'); } catch (err) { ui.toast(err.message, 'error'); }
      this.render(root, ctx);
    });
  },
};
