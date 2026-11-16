// Gate: the server boots on a temp data folder, serves the UI, and throws nothing.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, GATE_TOKEN, sleep, gateSandbox, startServer } from './lib.mjs';

const listJs = d => fs.readdirSync(path.join(ROOT, 'public', d)).filter(f => !f.startsWith('.'));
const sandbox = gateSandbox('jade-smoke');   // temp data and Claude folders, and a stand-in `claude` first on PATH: never the real ones
const problems = [];
let server = null, port = 0;
try { server = await startServer({ ...sandbox }); port = server.port; } catch (e) { problems.push('GET /api/boot did not return 200 JSON within 20 s: ' + e.message); }
const base = server?.base || '';
const stderrOf = () => server?.stderr() || '';
const exitedNow = () => server?.exited() ?? true;
async function stop() { await server?.stop(); sandbox.cleanup(); }
let checked = 0;
try {
  const boot = server ? await (await fetch(base + '/api/boot', { headers: { 'x-jade': GATE_TOKEN } })).json() : null;
  if (boot) {
    const urls = ['/', ...listJs('js/views').map(f => '/js/views/' + f), ...listJs('css').map(f => '/css/' + f)];
    for (const u of urls) {
      checked++;
      try { const r = await fetch(base + u, { headers: { cookie: 'jade=' + GATE_TOKEN } }); await r.arrayBuffer(); if (r.status !== 200) problems.push(`${u} -> ${r.status}`); }
      catch (e) { problems.push(`${u} -> ${e.message}`); }
    }
  }
  if (boot) {
    // the key is given only to a caller that has it
    const bare = await fetch(base + '/');
    if ((await bare.text()).includes(GATE_TOKEN) || bare.headers.get('set-cookie')) problems.push('the page without the key leaked it');
    const link = await fetch(base + '/?key=' + GATE_TOKEN, { redirect: 'manual' });
    if (link.status !== 200 || link.headers.get('location') || !/refresh/.test(await link.text()) || !/HttpOnly/.test(link.headers.get('set-cookie') || '')) problems.push('the start link did not set the cookie and move on');
    const app = await fetch(base + '/', { headers: { cookie: 'jade=' + GATE_TOKEN } });
    if (!(await app.text()).includes(`content="${GATE_TOKEN}"`)) problems.push('the page with the cookie lacks the key');
  }
  await sleep(300);   // a moment for a late error to reach stderr (there is no event to wait on for "nothing went wrong")
  if (/uncaught|unhandled|TypeError|ReferenceError|SyntaxError|ERR_MODULE_NOT_FOUND|Cannot find module/i.test(stderrOf())) problems.push('server stderr: ' + stderrOf().trim().slice(0, 800));
  else if (exitedNow()) problems.push('server exited early');
} catch (e) { problems.push(e.message); }
finally { await stop(); }
const pass = !problems.length;
console.log(JSON.stringify({ pass, details: { port, urlsChecked: checked, problems } }));
process.exit(pass ? 0 : 1);
