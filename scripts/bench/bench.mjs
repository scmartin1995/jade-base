// Measure a Jade checkout. Usage: npm run bench -- [--repo <checkout, default this one>] [--tmp <folder for the throw-away data>] [--idle 130] [--out results.json] [--keep]
// Starts the server from <repo> on a free port, with a temp data folder, a temp HOME and the stand-in `claude` first on PATH; seeds data
// first (seed.mjs); stops the server and deletes the data at the end. Nothing outside --tmp is touched. Needs Linux for /proc numbers.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const repo = path.resolve(arg('repo', path.join(here, '..', '..')));   // default: this checkout
const PARTS = String(arg('parts', 'routes,writes,chat,files,idle')).split(','), has = p => PARTS.includes(p);   // run only some parts: --parts idle
const IDLE_S = Number(arg('idle', 130));
const outFile = path.resolve(arg('out', path.join(os.tmpdir(), 'jade-bench-results.json')));
const root = fs.mkdtempSync(path.join(path.resolve(arg('tmp', os.tmpdir())), 'jade-perf-'));
const TOKEN = 'perf-' + Math.random().toString(36).slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => performance.now();
const stats = a => { const s = [...a].sort((x, y) => x - y); return { n: s.length, median: +s[Math.floor(s.length / 2)].toFixed(1), worst: +s[s.length - 1].toFixed(1), best: +s[0].toFixed(1) }; };
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const R = { when: new Date().toISOString(), node: process.version, repoHead: spawnSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim() };
let child = null, base = '', pid = 0, phase = 'start', probing = true;
const stalls = [];   // any answer to a tiny request that took over 300 ms while the run was going: which phase, how long

const proc = {
  rssMB: () => { try { return +(/VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1] / 1024).toFixed(1); } catch { return null; } },
  cpuMs: () => { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) * 10; } catch { return null; } },   // utime+stime, 10 ms ticks
  watches: () => { let n = 0; try { for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) { try { if (fs.readlinkSync(`/proc/${pid}/fd/${fd}`).includes('inotify')) n += (fs.readFileSync(`/proc/${pid}/fdinfo/${fd}`, 'utf8').match(/^inotify wd:/gm) || []).length; } catch {} } } catch {} return n; },
};
const get = async (p, { auth = true } = {}) => { const t = now(); const r = await fetch(base + p, { headers: auth ? { 'x-jade': TOKEN } : {} }); const b = await r.arrayBuffer(); return { ms: now() - t, status: r.status, bytes: b.byteLength, body: b }; };
const send = async (method, p, body) => { const t = now(); const r = await fetch(base + p, { method, headers: { 'x-jade': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); const j = await r.json().catch(() => null); return { ms: now() - t, status: r.status, json: j }; };

// ---- the event stream, kept open for the whole run
const events = []; const waiters = []; const allMem = []; var T0 = 0;
async function openEvents() {
  const r = await fetch(base + '/api/events', { headers: { 'x-jade': TOKEN } });
  (async () => {
    const dec = new TextDecoder(); let buf = '';
    for await (const c of r.body) {
      buf += dec.decode(c, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        let ev = null; if (frame.startsWith('data: ')) { try { ev = JSON.parse(frame.slice(6)); } catch {} } else if (frame.startsWith(': ping')) ev = { type: 'ping' };
        if (!ev) continue;
        ev.seen = now(); events.push(ev); if (ev.type === 'memory') allMem.push({ atSec: +((ev.seen - T0) / 1000).toFixed(1), ...ev.payload });
        for (const w of [...waiters]) if (w.test(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
      }
    }
  })().catch(() => {});
}
const waitEvent = (test, ms = 20000) => new Promise((resolve, reject) => { const w = { test, resolve }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('timed out waiting for an event')); } }, ms); });

async function stallProbe() { while (probing) { if (phase === 'idle') { await sleep(100); continue; }   // the probe itself costs CPU, so it pauses while idle is measured
     const t = now(); try { await fetch(base + '/api/counts', { headers: { 'x-jade': TOKEN } }).then(r => r.arrayBuffer()); } catch {} const d = now() - t; if (d > 300) stalls.push({ phase, atSec: +((t - T0) / 1000).toFixed(1), ms: Math.round(d) }); await sleep(100); } }
async function lagProbe(ms, every = 20) { const out = []; const end = now() + ms; while (now() < end) { const t = now(); await fetch(base + '/api/counts', { headers: { 'x-jade': TOKEN } }).then(r => r.arrayBuffer()); out.push(now() - t); await sleep(every); } return out; }

try {
  // ---- seed
  let t = now();
  const s = spawnSync(process.execPath, [path.join(here, 'seed.mjs'), root], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (s.status !== 0) throw new Error('seed failed: ' + s.stderr);
  R.seed = { ms: Math.round(now() - t), ...JSON.parse(s.stdout.trim().split('\n').pop()) };
  const home = path.join(root, 'home'), standLog = path.join(root, 'standin.log');
  const dirSize = d => Number(spawnSync('du', ['-sk', d], { encoding: 'utf8' }).stdout.split('\t')[0]) / 1024;
  R.loadAvgAtStart = os.loadavg(); R.cpus = os.cpus().length; R.seed.dataMB = +dirSize(home).toFixed(1); R.seed.chatsJsonMB = +(fs.statSync(path.join(home, '.state', 'chats.json')).size / 1048576).toFixed(2);
  R.seed.actionsJsonMB = +(fs.statSync(path.join(home, 'actions.json')).size / 1048576).toFixed(2);

  // ---- start
  const port = await freePort(); base = `http://127.0.0.1:${port}`; R.port = port;
  fs.mkdirSync(path.join(root, 'userhome'), { recursive: true });
  const env = { ...process.env, JADE_HOME: home, JADE_CLAUDE_HOME: path.join(root, 'claude'), JADE_PORT: String(port), JADE_TOKEN: TOKEN, HOME: path.join(root, 'userhome'),
    PATH: path.join(here, 'standin') + path.delimiter + process.env.PATH, STANDIN_LOG: standLog, JADE_SHOW_LINK: '0' };
  delete env.CLAUDECODE;
  let serverOut = '';
  const t0 = now(); T0 = t0;
  child = spawn(process.execPath, [path.join(repo, 'server', 'index.js')], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  pid = child.pid;
  child.stdout.on('data', d => { serverOut += d; }); child.stderr.on('data', d => { serverOut += d; });
  let exited = false; child.on('exit', () => { exited = true; });
  let up = 0;
  while (!up) { if (exited) throw new Error('server exited: ' + serverOut); try { const r = await fetch(base + '/api/engines'); if (r.ok) up = now() - t0; } catch {} if (!up) await sleep(5); }
  R.startup = { firstAnswerMs: +up.toFixed(0) };
  await openEvents();
  stallProbe();
  R.startup.rssAtFirstAnswerMB = proc.rssMB();
  phase = 'first 6 s';
  // the first seconds: how long is the server deaf while the memory index, file watchers and engine check start?
  const lag0 = await lagProbe(6000);
  R.startup.lagFirst6s = stats(lag0);
  // wait until the server has settled: no stall for 5 s after the first memory index finished
  phase = 'settling'; while (!allMem.length || now() - T0 < 15000) await sleep(500);
  R.startup.watchesAfterStart = proc.watches();

  // ---- first-call cost of the routes that walk folders (before anything has warmed the 60 s file list)
  phase = 'first calls of folder routes'; R.firstCalls = {};
  for (const p of ['/api/files?q=budget&limit=50', '/api/outputs/ring', '/api/memory/files', '/api/search?q=budget%20review&limit=12', '/api/memory/search?q=budget&k=12']) {
    const r = await get(p); R.firstCalls[p] = { ms: +r.ms.toFixed(1), bytes: r.bytes, status: r.status };
  }

  // ---- every GET route the pages call on load: 30 calls each
  const ids = { note: fs.readdirSync(path.join(home, 'notes'))[0].replace(/\.md$/, '') };
  const routes = ['/api/boot', '/api/engines', '/api/projects', '/api/projects/project-1', '/api/projects/project-2', '/api/actions', '/api/notes', `/api/notes/${ids.note}`, '/api/chats', '/api/chats/c-0',
    '/api/jobs', '/api/counts', '/api/meetings', '/api/meetings?project=project-1', '/api/meetings/m-0', '/api/schedule', '/api/routines', '/api/agents', '/api/skills', '/api/skeptic', '/api/models',
    '/api/permissions', '/api/connectors', '/api/engine/provider', '/api/memory/stats', '/api/memory/facts', '/api/memory/files', '/api/outputs/ring', '/api/outputs',
    '/api/files?project=project-1&limit=8', '/api/files?q=budget&limit=50', '/api/search?q=budget%20review&limit=12', '/api/memory/search?q=budget&k=12', '/api/modules',
    '/api/dashboards', '/api/projects/project-1/dashboards', '/api/dreams', '/api/setup', '/api/config', '/'];
if (has('routes')) {
  phase = 'route loop'; R.routes = {};
  for (const p of routes) {
    const ms = []; let bytes = 0, status = 0;
    for (let i = 0; i < 30; i++) { const r = await get(p); ms.push(r.ms); bytes = r.bytes; status = r.status; }
    R.routes[p] = { ...stats(ms), bytes, status };
  }
  R.memoryAfterLoad = { rssMB: proc.rssMB(), watches: proc.watches() };

}
  // ---- writes
if (has('writes')) {
  phase = 'writes'; R.writes = {};
  const w = async (name, f, n = 10) => { const ms = []; for (let i = 0; i < n; i++) ms.push((await f(i)).ms); R.writes[name] = stats(ms); };
  await w('POST /api/actions (3,000 in the list)', i => send('POST', '/api/actions', { text: `perf action ${i} ${Date.now()}`, project: 'project-3' }));
  await w('POST /api/notes (2,000 notes)', i => send('POST', '/api/notes', { title: `perf note ${i}`, body: 'text', project: 'project-3' }));
  await w('POST /api/chats/c-9 PATCH title (50 chats of 200 turns)', i => send('PATCH', '/api/chats/c-9', { title: 'Chat 9 retitled ' + i }));

}
  // ---- chat: time from sending to the first streamed byte (stand-in engine answers at once)
if (has('chat')) {
  phase = 'chat'; R.chat = { note: 'stand-in engine, first text piece at once; this is Jade\'s own overhead. TTFB = send until the first job:text event reaches an open event stream.' };
  const turn = async (thread, text) => {
    events.length = 0;
    const t1 = now();
    const first = waitEvent(e => e.type === 'job:text', 90000);
    const r = await send('POST', '/api/chat', { message: text, thread });
    const jid = r.json?.id;
    const fe = await first; const isDone = e => e.type === 'job' && e.payload?.id === jid && ['done', 'error', 'cancelled'].includes(e.payload.status);
    const de = events.find(isDone) || await waitEvent(isDone, 90000).catch(() => null);   // it may have arrived already
    return { postMs: +r.ms.toFixed(0), firstByteMs: +(fe.seen - t1).toFixed(0), doneMs: de ? +(de.seen - t1).toFixed(0) : null, status: de?.payload?.status || 'timeout', err: de?.payload?.error || '' };
  };
  R.chat.cold = []; R.chat.warm = [];
  for (const c of ['c-1', 'c-2', 'c-3']) { R.chat.cold.push(await turn(c, 'hello there, this is a cold turn')); R.chat.warm.push(await turn(c, 'and a warm follow-up')); }
  R.chat.newThread = await turn('', 'a brand new conversation');
  const chatsAfter = (await get('/api/chats/c-1')).bytes; R.chat.thread200Bytes = chatsAfter;

}
  // ---- the file list after its 60 s cache lapses, and a change in a project folder (watcher -> memory rebuild)
if (has('files')) {
  phase = 'after cache expiry'; await sleep(61000);
  const r1 = await get('/api/files?q=budget&limit=50'); const r2 = await get('/api/files?q=budget&limit=50');
  R.fileScanAfterCacheExpiry = { firstMs: +r1.ms.toFixed(1), cachedMs: +r2.ms.toFixed(1) };
  const memEv2 = waitEvent(e => e.type === 'memory', 30000).catch(() => null);
  fs.writeFileSync(path.join(root, 'work', 'bigproject', 'area-0', 'perf-change.md'), '# changed\n\nbudget budget\n');
  const lag2 = await lagProbe(6000);
  const m2 = await memEv2; R.reindexAfterOneFileChange = { lagWhileIndexing: stats(lag2), memoryEvent: m2 ? m2.payload : null };

}
  // ---- idle: nothing is happening. What does the server do?
if (has('idle')) {
  phase = 'settle before idle'; await sleep(25000);
  phase = 'idle'; events.length = 0; R.loadAvgAtIdle = os.loadavg(); const cpuSamples = []; const cpu0 = proc.cpuMs(), rss0 = proc.rssMB(), log0 = fs.existsSync(standLog) ? fs.readFileSync(standLog, 'utf8').split('\n').filter(Boolean).length : 0;
  const idleStart = now(); for (let k = 0, last = cpu0; k < IDLE_S / 10; k++) { await sleep(10000); const c = proc.cpuMs(); cpuSamples.push(c - last); last = c; }
  const cpu1 = proc.cpuMs(), logLines = fs.readFileSync(standLog, 'utf8').split('\n').filter(Boolean).slice(log0).map(l => JSON.parse(l));
  const byType = {}; for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;
  R.idle = { seconds: IDLE_S, cpuMs: cpu1 - cpu0, cpuMsPer10s: cpuSamples, cpuPctOfOneCore: +(((cpu1 - cpu0) / (now() - idleStart)) * 100).toFixed(2), rssBeforeMB: rss0, rssAfterMB: proc.rssMB(), eventsByType: byType, watches: proc.watches(),
    claudeProcessesStarted: logLines.map(l => l.args.join(' ')), note: 'timers read from source' };
}
  probing = false; R.loadAvgAtEnd = os.loadavg();
  R.stallSummary = {}; for (const x of stalls) { const a = (R.stallSummary[x.phase] ||= { count: 0, totalMs: 0, maxMs: 0 }); a.count++; a.totalMs += x.ms; a.maxMs = Math.max(a.maxMs, x.ms); }
  R.stalls = stalls; R.memoryEvents = allMem;
  R.finalServerOutput = serverOut.slice(-600);
} catch (e) { R.error = String(e.stack || e); }
finally {
  if (child && !child.killed) { child.kill('SIGTERM'); await sleep(500); if (child.exitCode === null) child.kill('SIGKILL'); }
  if (!arg('keep')) fs.rmSync(root, { recursive: true, force: true });
  fs.writeFileSync(outFile, JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 2));
  console.error('results written to ' + outFile + (arg('keep') ? '; data kept in ' + root : '; temp data removed'));
}
