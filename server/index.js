// Jade server: static UI, JSON API, a server-sent-events stream, and file watchers that push every change live.
// Listens on 127.0.0.1 only. Every request needs a localhost Host (stops DNS rebinding); a write needs the X-Jade
// header to hold the server's secret, and a read of data needs it as header or cookie (core/auth.js), which stops other websites in
// the browser and other programs or users on the computer from driving Jade.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
process.title = 'Jade'; // what ps / Activity Monitor show; on Windows the launcher runs a jade.exe for the same reason
import { pathToFileURL } from 'node:url';
import * as config from './core/config.js';
import * as store from './core/store.js';
import * as memory from './core/memory.js';
import * as jobs from './core/jobs.js';
import * as scheduler from './core/scheduler.js';
import * as skills from './core/skills.js';
import * as engines from './core/engines.js';
import * as warm from './core/warm.js';
import * as models from './core/models.js';
import * as enginehome from './core/enginehome.js';
import * as agents from './core/agents.js';
import * as modules from './core/modules.js';
import * as router from './core/router.js';
import * as auth from './core/auth.js';
import os from 'node:os';
import { bus, emit } from './core/bus.js';
import { debounce, watchTree, guardedWatch } from './core/util.js';
import { readBody } from './core/body.js';
import { staticTarget } from './core/static.js';
import { sseLine } from './core/redact.js';
import { GATE_HTML } from './core/gatepage.js';

const PORT = config.port();
const PUBLIC = path.join(config.APP_ROOT, 'public');
const API_FILE = path.join(config.APP_ROOT, 'server', 'api.js');

config.load();
store.init();
auth.token();          // make the key file now, so a launcher can read it as soon as Jade answers
agents.ensureSoul();   // Jade's soul file (how it speaks): copied once from agents/jade/soul.md, then the user's to edit
jobs.init();

let api = await import(pathToFileURL(API_FILE).href);
await modules.init({ jobs, agents, store, bus });  // after api.js, so a module's routes come after the built-in ones
const reloadApi = debounce(async () => {
  try { api = await import(pathToFileURL(API_FILE).href + '?v=' + Date.now()); emit('toast', { kind: 'info', text: 'API reloaded' }); }
  catch (e) { emit('toast', { kind: 'error', text: 'API reload failed: ' + e.message }); }
}, 150);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// On every answer: no other site may frame Jade (clickjacking), and a file is never guessed to be another type.
// The app page may frame only its own pages (a file preview). A framed page cannot move itself to another address either:
// the page that frames it decides, and this one says same-origin only.
const FRAMES = "frame-ancestors 'self'; frame-src 'self'";
const SAFE = { 'x-content-type-options': 'nosniff', 'content-security-policy': "frame-ancestors 'self'" };

function sendJSON(res, status, data) {
  const s = JSON.stringify(data ?? null);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SAFE });
  res.end(s);
}

function serveStatic(req, res, pathname) {
  const target = staticTarget(pathname, PUBLIC);
  if (target.status) { res.writeHead(target.status, SAFE); return res.end(); }
  const { file, rel } = target;
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    // Privacy switch: with web fonts off, the page never contacts Google Fonts (system fonts are used instead).
    if (rel === '/index.html' && config.get().privacy?.webFonts === false) buf = Buffer.from(String(buf).replace(/^.*fonts\.g(oogleapis|static)\.com.*\n/gm, ''));
    const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', ...SAFE };
    // the page carries the server's secret (see core/auth.js): in a meta tag for the script, and as a cookie for pictures and the event stream
    if (rel === '/index.html') {
      // only a caller that already has the key gets the page that carries it; anyone else gets the plain page with no key in it
      if (!auth.hasCookie(req)) { res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...SAFE }); return res.end(GATE_HTML); }
      buf = Buffer.from(String(buf).replace('<meta name="jade-token" content="">', `<meta name="jade-token" content="${auth.token()}">`)); headers['set-cookie'] = auth.cookie(); headers['content-security-policy'] = FRAMES; headers['cache-control'] = 'no-store'; }
    res.writeHead(200, headers);
    res.end(buf);
  });
}

const clients = new Set();
bus.on('event', ev => {
  const line = sseLine(ev);
  for (const res of clients) res.write(line);
});
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

const localHost = h => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h || '');

const onRequest = async (req, res) => {
  // A request target such as "//" is not a URL; answer it rather than let the throw end the process.
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  if (!localHost(req.headers.host)) { res.writeHead(421); return res.end('Jade only answers on localhost'); }

  // The start link: the right key sets the cookie and moves on to the plain address, so the key does not stay in the address bar or the
  // history. A wrong or missing key gets exactly what a request with no key gets (the page below, which carries nothing).
  // It answers with a small page, not a redirect: a start link opened from a local file counts as another site, and the browser holds back a
  // SameSite=Strict cookie on a redirect that follows. The page's own move to "/" starts on this address, so the cookie goes with it.
  // No script: a zero-second refresh replaces this history entry.
  if (url.pathname === '/' && url.searchParams.has('key') && (req.method === 'GET' || req.method === 'HEAD') && auth.keyOk(url.searchParams.get('key'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': auth.cookie(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'self'" });
    return res.end(req.method === 'HEAD' ? undefined : '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=/"><title>Opening Jade</title><p>Opening Jade...</p>\n');
  }
  // Reading the user's data needs the secret too (the page's cookie or header). Only the launcher's "is it running" check is open.
  const open = url.pathname === '/api/engines' && req.method === 'GET' && !auth.okRead(req);
  if (open) return sendJSON(res, 200, { running: true });   // nothing else: no paths, names or provider details
  if (url.pathname.startsWith('/api/') && req.method === 'GET' && !auth.okRead(req)) return sendJSON(res, 401, { error: 'Missing or wrong Jade key. Open Jade from the link it showed when it started.' });
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', ...SAFE });
    res.write(`data: ${JSON.stringify({ type: 'hello', payload: { pid: process.pid }, at: Date.now() })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  // A raw route answers before the body is read: it gets the stream and the response (uploads, served pages). The CSRF check still applies.
  const rawHit = router.match(req.method, url.pathname, true);
  if (!rawHit && !url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  // A page or file served by a route outside /api/ (a module's own files) can carry project data: it needs the key as well.
  if (rawHit && req.method === 'GET' && !url.pathname.startsWith('/api/') && !auth.okRead(req)) { res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8', ...SAFE }); return res.end('Open Jade from the link it showed when it started.'); }

  if (req.method !== 'GET' && !auth.okWrite(req)) return sendJSON(res, 403, { error: 'Missing or wrong X-Jade token' });
  if (rawHit) {
    try { await rawHit.fn({ p: rawHit.p, q: url.searchParams, req, res }); }
    catch (e) { if (!res.headersSent) sendJSON(res, e.status || 500, { error: String(e.message || e) }); else res.end(); }
    return;
  }
  let body = null;
  if (req.method !== 'GET') {
    const limit = router.jsonLimit(config.get());
    const got = await readBody(req, limit);
    if (got.aborted) return;
    if (got.over) {
      // answered now; the rest of the body is read and thrown away so the connection is not reset under the client (see readBody)
      if (!req.readableEnded) req.resume();
      return sendJSON(res, 413, { error: `Request body is over the ${limit} byte limit` });
    }
    const raw = got.buf.toString('utf8');
    if (raw) { try { body = JSON.parse(raw); } catch { return sendJSON(res, 400, { error: 'Bad JSON' }); } }
  }
  try {
    const out = await api.handle(req, res, url, body || {});
    if (!res.headersSent) sendJSON(res, 200, out);
  } catch (e) {
    if (!res.headersSent) sendJSON(res, e.status || 500, { error: String(e.message || e) });
  }
};
// A failure in one request answers that request (500) and nothing more. This is the last stop for whatever the code above did not expect.
const server = http.createServer((req, res) => {
  onRequest(req, res).catch(e => {
    console.error('request failed:', req.method, String(req.url).split('?')[0], e?.stack || e);
    try { if (!res.headersSent) sendJSON(res, 500, { error: 'Something went wrong in Jade. Try again.' }); else res.destroy(); } catch { /* the connection is gone */ }
  });
});
server.on('clientError', (e, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* gone */ } });
// Nothing a single request, a timer or a child process does may end the server (it would drop the jobs that are running). Logged, not hidden.
process.on('uncaughtException', e => console.error('uncaught error (the server keeps running):', e?.stack || e));
process.on('unhandledRejection', e => console.error('unhandled promise failure (the server keeps running):', e?.stack || e));

// ---- watchers: everything is live
const watchDir = (dir, fn) => watchTree(dir, f => fn(null, f));

// UI files: CSS swaps in place, JS views re-import, HTML reloads.
const assetChanged = new Map(), assetText = new Map();
// what every page file says now, so the first read of one after start is not taken for a change either
try { for (const f of fs.readdirSync(PUBLIC, { recursive: true })) { const file = String(f).split(path.sep).join('/'); if (/\.(css|js|html|svg|webmanifest)$/.test(file)) try { assetText.set(file, fs.readFileSync(path.join(PUBLIC, file), 'utf8')); } catch {} } } catch {}
watchDir(PUBLIC, (ev, f) => {
  const file = String(f).split(path.sep).join('/');
  if (!/\.(css|js|html|svg|webmanifest)$/.test(file) || /(^|\/)\./.test(file)) return; // ignore editor temp/swap files
  // a read is not a change (on Windows it updates the last-access time, which fs.watch reports): without this check the open
  // window reloaded itself whenever a page file was merely read
  let now = null; try { now = fs.readFileSync(path.join(PUBLIC, file), 'utf8'); } catch {}
  if (now !== null && assetText.has(file) && assetText.get(file) === now) return;
  assetText.set(file, now);
  clearTimeout(assetChanged.get(file));
  assetChanged.set(file, setTimeout(() => emit('asset', { file }), 80));
});
const apiNow = () => { try { return fs.readFileSync(API_FILE, 'utf8'); } catch { return null; } };
let apiText = apiNow();
watchDir(path.join(config.APP_ROOT, 'server'), (ev, f) => { if (String(f) !== 'api.js') return; const now = apiNow(); if (now !== null && now === apiText) return; apiText = now; reloadApi(); });
// Data written by hand (or by another tool) shows up immediately.
const dataChanged = debounce(kind => emit('data', { kind }), 250);
// engine.env edited by hand: new provider on the next run. ~/.claude.json: a connector added in `claude` shows up here.
// Only a real change to its contents counts. On Windows, reading a file can update its last-access time, which fs.watch reports
// as a change; Jade reads engine.env every time it starts a chat process, so that "change" stopped every chat mid-reply
// ("Worker stopped" a second after sending).
const envText = () => { try { return fs.readFileSync(path.join(config.JADE_HOME, 'engine.env'), 'utf8'); } catch { return ''; } };
let lastEnv = envText();
const providerChanged = debounce(() => { const now = envText(); if (now === lastEnv) return; lastEnv = now; warm.shutdown(); engines.refresh(); }, 400);
const claudeChanged = debounce(() => engines.refresh(), 1500);
const watchClaudeJson = () => { try { guardedWatch(config.claudeJson(), null, claudeChanged, { onClose: () => { const t = setTimeout(watchClaudeJson, 10000); t.unref?.(); } }); } catch {} };
watchClaudeJson();
watchDir(config.JADE_HOME, (ev, f) => {
  const rel = String(f).split(path.sep);
  if (rel[0] === '.state' || String(f).endsWith('.tmp')) return;
  if (rel[0] === 'config.json') { config.load(); emit('config', {}); return; }
  if (rel[0] === 'engine.env') { providerChanged(); return; }
  if (rel[0] === 'agents') { emit('agents', {}); return; }
  if (rel[0] === 'skills') { emit('skills', {}); return; }
  dataChanged(rel[0].replace(/\.json$/, ''));
});
watchDir(path.join(config.APP_ROOT, 'agents'), () => emit('agents', {}));
for (const d of skills.watchDirs()) watchDir(d, debounce(() => emit('skills', {}), 300));
enginehome.start();   // the user's agents and skills, visible to Claude Code when it runs with its private config folder

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Jade is running on port ${PORT}.`);
  // The start link carries the key, so it goes to a terminal only: never to a pipe or file (a launcher's log), and once per start of Jade.
  if ((process.stdout.isTTY || process.env.JADE_SHOW_LINK === '1') && process.env.JADE_LINK_SHOWN !== '1') console.log(`Open Jade: ${auth.startLink(PORT)}`);
  if (process.send) process.send({ ready: true, port: PORT });
  setTimeout(() => { memory.rebuild(); memory.watch(); }, 200);
  setTimeout(() => engines.detect(), 50);
  models.start();  // which models this endpoint offers, refreshed now and then
  setInterval(() => engines.refresh(), 10 * 60e3);
  scheduler.start();
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.error(`Port ${PORT} is busy. Is Jade already running? Set JADE_PORT to use another port.`); process.exit(3); }
  throw e;
});
