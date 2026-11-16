// Gate: open every route the nav offers (plus #/settings) in headless Chromium over the DevTools protocol and fail on
// console errors, uncaught exceptions, or the app's error states. No packages: Node's global WebSocket and fetch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { ROOT, GATE_TOKEN, sleep, freePort, waitFor, gateSandbox, startServer, stopTree, findBrowser } from './lib.mjs';

// Known console messages the existing app produces and that are tolerated (exact text). Keep this list short.
// Wake word: with voice.wake on (the default) the page fetches an offline speech model into a Web Worker, which fails
// when the model is not downloaded. Seen intermittently on a fresh data folder. Matched on the message text only.
const ALLOW = [
  'log: Error: HTTP error! status: 404',
  "log: Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'done')",
];

// A Chromium-family browser: $CHROMIUM or $CHROME_BIN, else the usual places on Linux, macOS and Windows. With none, the gate
// says so and is skipped (exit 0): it cannot check pages without a browser, and a missing browser is not a broken page.
const CHROMIUM = findBrowser();
const out = (pass, details) => { console.log(JSON.stringify({ pass, details })); };

if (!CHROMIUM) { console.log(JSON.stringify({ pass: true, skipped: true, details: { reason: 'SKIPPED: no Chromium, Chrome or Edge was found. Install one, or set CHROMIUM to its path, to check the pages.' } })); process.exit(0); }

const tmpDirs = [], procs = [];
const sandbox = gateSandbox('jade-pages');   // temp data and Claude folders, and a stand-in `claude` first on PATH: the gate can never start a real one
tmpDirs.push(sandbox.root);
async function cleanup() {
  for (const p of procs) await stopTree(p);
  await sleep(200);
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
}

const problems = [], checked = [];
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { await cleanup(); process.exit(1); });
const overall = setTimeout(async () => { problems.push('gate timed out after 150 s'); await cleanup(); out(false, { routesChecked: checked, problems }); process.exit(1); }, 150000);
try {
  const { home, claudeHome } = sandbox;
  // Keep the wake word off so the gate never downloads a speech model from the internet.
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ voice: { wake: false }, modules: { dreams: true } }));   // Dreams is off by default: the gate switches it on so its page and settings are checked
  // A temp Claude Code home with one user agent and one user skill, so the Agents and Skills pages render real cards (never the real ~/.claude).
  fs.mkdirSync(path.join(claudeHome, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'agents', 'gate-agent.md'), '---\nname: gate-agent\ndescription: Gate test agent\ntools: Read\nskills: [gate-skill]\n---\nYou are a test agent.\n');
  // ...and a plugin's agent, which Jade lists and runs only read-only until the PM allows it: the page offers the allowance
  const gatePlug = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-pages-plugin-')); tmpDirs.push(gatePlug);
  fs.mkdirSync(path.join(gatePlug, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(gatePlug, 'agents', 'gate-plug.md'), '---\nname: gate-plug\ndescription: Gate plugin agent\ntools: Read, Bash\njade-edits: true\njade-schedule: every 1h\n---\nYou are a plugin agent.\n');
  fs.mkdirSync(path.join(claudeHome, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'gate@market': [{ scope: 'user', installPath: gatePlug }] } }));
  fs.mkdirSync(path.join(claudeHome, 'skills', 'gate-skill'), { recursive: true });
  fs.writeFileSync(path.join(claudeHome, 'skills', 'gate-skill', 'SKILL.md'), '---\nname: gate-skill\ndescription: Gate test skill\n---\n# Gate skill\nDo the thing.\n');
  // Seeded for the Meetings and Dashboards pages: a project and two meetings (one to review, one already recorded).
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/gates/fixtures/meetings.json'), 'utf8'));
  fs.mkdirSync(path.join(home, 'projects'), { recursive: true }); fs.mkdirSync(path.join(home, '.state', 'meetings'), { recursive: true });
  // The project has a folder, so a dashboard specification can sit in <folder>/Jade/Dashboards, with actions, a meeting record and a file to draw from.
  const dfx = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/gates/fixtures/dashboard.json'), 'utf8'));
  const projFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-pages-proj-')); tmpDirs.push(projFolder);
  const dashFile = path.join(projFolder, 'Jade', 'Dashboards', 'Gate view.json');
  fs.mkdirSync(path.dirname(dashFile), { recursive: true }); fs.mkdirSync(path.join(projFolder, 'Jade', 'Meetings'), { recursive: true });
  fs.writeFileSync(dashFile, JSON.stringify(dfx.spec));
  fs.writeFileSync(path.join(projFolder, 'plan.md'), '# Plan\nThe plan.');
  fs.writeFileSync(path.join(projFolder, 'Jade', 'Meetings', '2026-11-03 Gate review.md'), `---\ndate: 2026-11-03\ntitle: Gate review\n---\n## Key points\n\n- ${dfx.evil}\n\n## Action items\n\n- Send the plan\n\n## Risks and issues\n\n- A risk\n`);
  const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  fs.writeFileSync(path.join(projFolder, 'Jade', 'actions.json'), JSON.stringify([
    { id: 'ga1', text: dfx.evil, project: 'apollo', owner: 'Ann', due: day(3), status: 'open', createdAt: new Date().toISOString() },
    { id: 'ga2', text: 'Overdue thing', project: 'apollo', owner: 'Bo', due: day(-4), status: 'open', createdAt: new Date().toISOString() },
    { id: 'ga3', text: 'Finished thing', project: 'apollo', owner: 'Ann', due: '', status: 'done', createdAt: new Date().toISOString() }]));
  for (const pr of fx.projects) fs.writeFileSync(path.join(home, 'projects', pr.id + '.json'), JSON.stringify({ description: '', owner: '', folders: pr.id === 'apollo' ? [projFolder] : [], links: [], tags: [],
    dashboards: pr.id === 'apollo' ? [{ id: 'gate-dash', name: 'Gate view', answers: {}, path: dashFile, builtAt: new Date().toISOString() }, { id: 'gate-old', name: 'Old page', answers: {}, path: path.join(projFolder, 'Jade', 'Dashboards', 'Old page.html'), builtAt: new Date().toISOString() }] : [], ...pr }));
  fs.writeFileSync(path.join(projFolder, 'Jade', 'Dashboards', 'Old page.html'), '<html><body>old</body></html>');
  for (const m of fx.meetings) fs.writeFileSync(path.join(home, '.state', 'meetings', m.id + '.json'), JSON.stringify(m));
  // A night of Dreams, with ideas of two kinds, one already dismissed, for the Dreams page.
  fs.writeFileSync(path.join(home, '.state', 'dreams.json'), JSON.stringify({ nights: [{ date: '2026-11-12', summary: 'A week of weekly summaries.', at: '2026-11-12T02:30:00.000Z', read: { claude: 'projects', web: false, days: 7 }, ideas: [
    { id: '2026-11-12-0', status: 'new', kind: 'agent', title: 'Weekly summary writer', detail: 'Writes the weekly summary.', suggestion: 'Try it on Friday', evidence: 'asked for the summary on the 10th and again on the 12th', project: '', draft: { name: 'weekly-summary-writer', description: 'Writes the weekly summary', prompt: 'Write the summary.' } },
    { id: '2026-11-12-1', status: 'dismissed', kind: 'doc', title: 'How the summary is made', detail: '', suggestion: '', evidence: 'done by hand on the 10th', project: '', draft: { title: 'Summary', body: 'x' } }] }] }));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-pages-chrome-')); tmpDirs.push(profile);
  const serverStart = Date.now();
  const server = await startServer({ ...sandbox, detached: true });   // waits until /api/boot answers; throws with the server's own words if it does not
  procs.push(server.child);
  const base = server.base;
  const boot = await (await fetch(base + '/api/boot', { headers: { 'x-jade': GATE_TOKEN } })).json();
  const serverErr = () => server.stderr();

  // Routes the nav offers: the nav entries of every enabled module in /api/boot (the dock is built from them).
  const routes = [...new Set((boot.modules || []).filter(m => m.enabled).flatMap(m => (m.nav || []).map(n => n.route)))].filter(id => id !== 'voice' && id !== 'dreams');   // dreams is added after the hooks, below
  if (!routes.includes('settings')) routes.push('settings');

  const dport = await freePort();
  const chrome = spawn(CHROMIUM, ['--headless=new', `--remote-debugging-port=${dport}`, `--user-data-dir=${profile}`, '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-features=BackForwardCache', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true });
  procs.push(chrome);

  const wsUrl = await waitFor(async () => {
    if (chrome.exitCode !== null) throw new Error('the browser exited');
    const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
    return list.find(t => t.type === 'page')?.webSocketDebuggerUrl || null;
  }, { timeout: 20000, interval: 250, message: 'the browser DevTools endpoint to come up' });

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools websocket failed')); });
  let id = 0; const pending = new Map(); let current = '';
  const events = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
    const fmt = a => a.value !== undefined ? String(a.value) : (a.description || a.type);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') events.push({ route: current, text: 'console.error: ' + m.params.args.map(fmt).join(' ') });
    else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; events.push({ route: current, text: 'uncaught: ' + (d.exception?.description || d.text) }); }
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') events.push({ route: current, text: 'log: ' + m.params.entry.text });
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJS = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

  const STATE = `(() => { const v = document.querySelector('#view .view-inner'); const bar = document.querySelector('#nav-progress');
    return { n: v ? v.children.length : -1, text: v ? v.innerText.slice(0, 400) : '', busy: !!(bar && bar.classList.contains('on')) }; })()`;
  const BAD = /Something broke|Page not found/;

  // Pages that are not in the nav, and the hooks each page must show (selectors that must exist, text that must appear).
  const FAKE_MODELS = path.join(home, '.state', 'models.json');
  const HOOKS = {
    meetings: { has: ['[data-intake]', 'select[data-project]', '[data-bin]', '[data-bin-input]', '[data-list] a.mtg-row[data-meeting="mt-review"]', '[data-list] a.mtg-row[data-meeting="mt-done"]'] },
    'meeting/mt-review': { has: ['[data-meeting-head] [data-title]', '[data-meeting-head] [data-date]', '[data-meeting-head] [data-attendees]', '[data-shortcuts]', '[data-skill]', '[data-item][data-verdict]', '[data-keep]', '[data-leave]', 'blockquote.mtg-quote', '[data-bar] [data-pending]', '[data-bar] [data-record]'] },
    'meeting/mt-done': { has: ['[data-bar] [data-open-file]', '[data-bar] [data-reveal-file]', '[data-rerun]', '[data-delete]'] },
    dashboards: { has: ['[data-proj="apollo"]', '[data-new="apollo"]'] },
    'dashboards?new=apollo': { has: ['.qn'] },
    setup: { has: ['.setup-wrap', '[data-q] *'], text: /Welcome to Jade/ },
    // the server's own first model search (20 s after it starts) rewrites the model list (it asks the stand-in `claude`, which knows none): wait for it, then state "none found" ourselves
    'settings/meetings': { before: async () => { await sleep(Math.max(0, serverStart + 22000 - Date.now())); fs.writeFileSync(FAKE_MODELS, JSON.stringify({ at: 'x', current: '', aliases: [], models: [] })); }, has: ['select[data-k="agents.model"]', 'select[data-k="meetings.accept"]'], text: /No models were found/ },
    'settings/meetings?found': { before: async () => { await sleep(Math.max(0, serverStart + 22000 - Date.now())); fs.writeFileSync(FAKE_MODELS,  // the server's own first model search runs 20 s after it starts and rewrites this file; wait for it so it cannot land after the fake list
       JSON.stringify({ at: 'x', current: '', aliases: ['gate-model-one', 'gate-model-two'], models: ['gate-model-one', 'gate-model-two'] })); },
      has: ['select[data-k="agents.model"] option[value="gate-model-one"]', 'select[data-k="agents.checkerModel"] option[value="gate-model-two"]'], noText: /No models were found/ },
  };
  // Dreams (switched on above) is checked last too: a slower step before the two model-list steps would push them past the server's first model search
  HOOKS.dreams = { has: ['[data-dream]', '[data-accept]', '[data-dismiss]', '.eyebrow'], text: /nowhere else[\s\S]*Weekly summary writer[\s\S]*Seen in: asked for the summary[\s\S]*Create this agent/ };
  HOOKS['settings/dreams'] = { has: ['select[data-k="dreams.claude"]', 'input[data-k="dreams.web"]', 'input[data-k="dreams.days"]', 'input[data-k="dreams.maxCharsPerSession"]', 'input[data-k="dreams.maxChars"]'], text: /what was typed to Claude and what Claude answered/ };
  // the drawn dashboard: every layout, model words and data shown as text, and no overflow at three widths (last for the same reason)
  HOOKS['dashboards?open=apollo~gate-dash'] = { has: ['.dash-doc', '.dash-sec[data-layout="headline"] .stat', '.dash-sec[data-layout="table"] table.t', '.dash-sec[data-layout="grouped"] .dash-group', '.dash-sec[data-layout="bars"] svg rect',
      '.dash-sec[data-layout="timeline"] .dash-tl-row', '.dash-sec[data-layout="due"] .item', '.dash-sec[data-layout="text"] p', '.dash-sec[data-layout="meetings"] .dash-meeting', '[data-sections] [data-remove]', '[data-change]'],
      text: /Gate view <b>bold<\/b>[\s\S]*Overdue thing[\s\S]*<script>window\.__pwn=1<\/script>[\s\S]*Gate review/, noText: /could not be drawn/, after: async () => {
        const bad = await evalJS(`(() => { const d = document.querySelector('.dash-doc'); const out = [];
          if (d.querySelector('script, img, iframe, object, embed, form, style, link, meta')) out.push('markup from a model or data string became an element');
          if (window.__pwn !== undefined) out.push('a script from the data ran');
          if ([...d.querySelectorAll('a[href]')].some(a => !a.getAttribute('href').startsWith('#/'))) out.push('a link leaves the app');
          return out; })()`);
        for (const b of bad || []) problems.push(`#/dashboards?open: ${b}`);
        for (const w of [1280, 820, 390]) {
          await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(300);
          const o = await evalJS(`(() => { const d = document.querySelector('.dash-doc'); return { doc: d.scrollWidth - d.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth }; })()`);
          if (o.doc > 1 || o.page > 1) problems.push(`#/dashboards?open: sideways overflow at ${w} px wide (${JSON.stringify(o)})`);
        }
        await send('Emulation.clearDeviceMetricsOverride');
      } };
  HOOKS['agents/gate-plug'] = { has: ['[data-allow-box]', '[data-allow]'], text: /not allowed to work on its own/ };   // last, so it cannot disturb the model-list steps before it
  for (const r of Object.keys(HOOKS)) if (!routes.includes(r)) routes.push(r);   // (the dashboard page above is checked after the Dashboards list, before the model-list steps)
  const REAL = r => r.replace('?found', '');

  // The launcher's own way in: the real local file server/core/opener.js writes, opened as a file:// address. A navigation that starts on a
  // file page is cross-site for the browser, so this is where a SameSite=Strict cookie goes missing. Must land on the app, not the gate page.
  {
    const fileUrl = execFileSync(process.execPath, ['-e', `import('${pathToFileURL(path.join(ROOT, 'server/core/opener.js')).href}').then(m => console.log(m.openerUrl(${new URL(base).port})))`],
      { env: { ...process.env, JADE_HOME: home, JADE_CLAUDE_HOME: claudeHome, JADE_TOKEN: GATE_TOKEN }, encoding: 'utf8' }).trim();
    await send('Page.navigate', { url: fileUrl });
    let seen = null;
    for (let t0 = Date.now(); Date.now() - t0 < 10000; await sleep(200)) { try { seen = await evalJS(`({ url: location.href, shell: !!document.querySelector('#view'), gate: /Jade is running/.test(document.body.innerText) })`); if (seen.shell && seen.url.startsWith(base)) break; } catch { /* loading */ } }
    if (!seen?.shell || seen.gate) problems.push('start from a local file: the gate page was shown instead of the app');
    if (seen && seen.url.includes('key=')) problems.push('start from a local file: the address bar still holds the key');
    checked.push('start-from-file');
  }
  // open the page the way a person does: through the start link, which sets the key cookie and moves on to the plain address
  await send('Page.navigate', { url: `${base}/?key=${GATE_TOKEN}` });
  for (let t0 = Date.now(); Date.now() - t0 < 10000; await sleep(200)) { try { if (await evalJS(`location.pathname === '/' && !location.search && !!document.querySelector('#view')`)) break; } catch { /* loading */ } }
  for (const route of routes) {
    current = route;
    await HOOKS[route]?.before?.();
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(100);
    await send('Page.navigate', { url: `${base}/#/${REAL(route)}` });
    let st = null, ok = false;
    for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(250)) {
      try { st = await evalJS(STATE); } catch { continue; }
      if (st && st.n > 0 && !st.busy) { ok = true; break; }
    }
    if (!ok) { problems.push(`#/${route}: view did not render within 15 s`); checked.push(route); continue; }
    await sleep(700);   // let late renders and errors land
    st = await evalJS(STATE);
    if (route === 'agents' && !(await evalJS(`document.querySelector('#view .view-inner').innerText`)).includes('gate-agent')) problems.push('#/agents: the user agent from the temp Claude home is not shown');
    if (route === 'skills') {   // the user skill sits on the Claude Code tab; its card must name the agent that uses it
      await evalJS(`[...document.querySelectorAll('[data-tab]')].find(b => b.dataset.tab === 'claude')?.click()`); await sleep(500);
      const t = await evalJS(`document.querySelector('#view .view-inner').innerText`);
      if (!t.includes('gate-skill') || !/used by/.test(t)) problems.push('#/skills: the user skill or its "used by" line is missing');
    }
    const hk = HOOKS[route];
    if (hk) {
      for (const sel of hk.has || []) if (!(await evalJS(`!!document.querySelector(${JSON.stringify(sel)})`))) problems.push(`#/${route}: missing ${sel}${sel === '.dash-doc' ? ' (page says: ' + st.text.replace(/\s+/g, ' ').slice(0, 160) + ')' : ''}`);
      const all = await evalJS(`document.querySelector('#view .view-inner').innerText + ' ' + [...document.querySelectorAll('#view option')].map(o => o.textContent).join(' ')`);
      if (hk.text && !hk.text.test(all)) problems.push(`#/${route}: expected text ${hk.text} is not shown`);
      if (hk.noText && hk.noText.test(all)) problems.push(`#/${route}: text ${hk.noText} should not be shown`);
    }
    await hk?.after?.();
    if (BAD.test(st.text)) problems.push(`#/${route}: error state shown: ${st.text.replace(/\s+/g, ' ').slice(0, 200)}`);
    checked.push(route);
  }
  current = '';
  ws.close();

  for (const e of events) if (!ALLOW.includes(e.text)) problems.push(`#/${e.route}: ${e.text.slice(0, 300)}`);
  if (/uncaught|unhandled/i.test(serverErr())) problems.push('server stderr: ' + serverErr().trim().slice(0, 500));
} catch (e) {
  problems.push(e.message);
} finally {
  await cleanup();
}
clearTimeout(overall);
const pass = !problems.length;
out(pass, { routesChecked: checked, problems });
process.exit(pass ? 0 : 1);
