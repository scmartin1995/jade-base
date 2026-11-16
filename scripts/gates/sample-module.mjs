// Gate: a one-file module dropped into <JADE_HOME>/modules shows up in /api/boot, its route answers and its view is served;
// take the file away and the app boots healthy without it. Temp data folder, temp Claude folder, random port.
import fs from 'node:fs';
import path from 'node:path';
import { GATE_TOKEN, sleep, gateSandbox, startServer } from './lib.mjs';
const COOKIE = { cookie: 'jade=' + GATE_TOKEN };   // the key cookie the start link sets; module view files need it (JADE_TOKEN is sent on every API call)

const sandbox = gateSandbox('jade-sample');   // temp data folder, temp Claude folder, a stand-in `claude` first on PATH
const { home } = sandbox;
const problems = [];
const MOD = path.join(home, 'modules');
fs.mkdirSync(path.join(MOD, 'sample', 'views'), { recursive: true });
fs.writeFileSync(path.join(MOD, 'sample.js'), `export default {
  id: 'sample', name: 'Sample', icon: 'spark', order: 300, desc: 'A gate module.',
  nav: [{ route: 'sample', label: 'Sample' }], views: { sample: 'sample.js' },
  projectPanels: [{ id: 'card', title: 'Sample card', view: 'panel.js', order: 10 }],
  init({ on }) { on('GET', '/api/sample/ping', () => ({ pong: true })); },
};\n`);
fs.writeFileSync(path.join(MOD, 'sample', 'views', 'sample.js'), "export default { title: 'Sample', render(root) { root.textContent = 'sample view'; } };\n");

fs.writeFileSync(path.join(MOD, 'sample', 'views', 'panel.js'), "export default { render(root, ctx, project) { root.textContent = 'panel for ' + project.id; } };\n");

async function run(fn) {
  let server;
  try { server = await startServer({ ...sandbox }); } catch (e) { return problems.push('no /api/boot: ' + e.message); }
  const base = server.base;
  try {
    const boot = await (await fetch(base + '/api/boot', { headers: { 'x-jade': GATE_TOKEN } })).json();
    await fn(base, boot);
    await sleep(200);   // a moment for a late error to reach stderr
    if (/uncaught|unhandled|TypeError|ReferenceError|SyntaxError|ERR_MODULE_NOT_FOUND/i.test(server.stderr())) problems.push('stderr: ' + server.stderr().trim().slice(0, 500));
  } finally { await server.stop(); }
}

try {
  await run(async (base, boot) => {
    const m = boot.modules.find(x => x.id === 'sample');
    if (!m) return problems.push('/api/boot does not list the module');
    if (m.nav?.[0]?.route !== 'sample') problems.push('nav entry missing');
    if (m.init) problems.push('manifest leaked a function');
    const r = await fetch(base + '/api/sample/ping', { headers: { 'x-jade': GATE_TOKEN } });
    if (r.status !== 200 || (await r.json()).pong !== true) problems.push('module route did not answer');
    const v = await fetch(base + '/modules/sample/views/sample.js', { headers: COOKIE });
    if (v.status !== 200 || !/sample view/.test(await v.text())) problems.push('view file not served');
    if (m.projectPanels?.[0]?.view !== 'panel.js') problems.push('projectPanels missing from the manifest');
    const pv = await fetch(base + '/modules/sample/views/panel.js', { headers: COOKIE });
    if (pv.status !== 200 || !/panel for/.test(await pv.text())) problems.push('panel view not served');
    const bad = await fetch(base + '/modules/sample/views/..%2f..%2fsample.js', { headers: COOKIE });
    if (bad.status === 200) problems.push('path escape was served');
    if ((await fetch(base + '/modules/sample/views/x.html', { headers: COOKIE })).status === 200) problems.push('a .html was served');
  });
  fs.rmSync(path.join(MOD, 'sample.js'));
  await run(async (base, boot) => {
    if (boot.modules.some(x => x.id === 'sample')) problems.push('module still listed after removal');
    if ((await fetch(base + '/api/sample/ping', { headers: { 'x-jade': GATE_TOKEN } })).status !== 404) problems.push('route still answers after removal');
    if (!boot.modules.some(x => x.id === 'home')) problems.push('built-in modules missing after removal');
  });
} catch (e) { problems.push(e.message); }
finally { sandbox.cleanup(); }
const pass = !problems.length;
console.log(JSON.stringify({ pass, details: { problems } }));
process.exit(pass ? 0 : 1);
