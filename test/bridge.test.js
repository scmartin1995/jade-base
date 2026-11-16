// The Claude bridge: the client script (bridge/jade-bridge.mjs), the MCP server over it (bridge/jade-mcp.mjs) and the routes it
// needs (/api/bridge/*). A real Jade is started on a free random port with its own data folder; nothing touches a live Jade or its data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'bridge', 'jade-bridge.mjs');
const MCP = path.join(ROOT, 'bridge', 'jade-mcp.mjs');
// Ports are asked from the system, never fixed: a fixed port could already be held by another program (or another run of
// this suite), whose server would then answer this test's readiness check with someone else's data.
const freePort = () => new Promise((resolve, reject) => { const l = net.createServer(); l.once('error', reject); l.listen(0, '127.0.0.1', () => { const { port } = l.address(); l.close(() => resolve(port)); }); });
const PORT = await freePort();
const FAKE = await freePort();   // a stand-in Jade run inside this process
const DOWN = await freePort();   // nothing listens here
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-bridge-test-'));
const HOME = path.join(tmp, 'home');
const DATA = path.join(tmp, 'JadeBase');
const FOLDER = path.join(tmp, 'ProjectA-files');
let server;

const env = (extra = {}) => ({ ...process.env, HOME, JADE_HOME: DATA, JADE_CLAUDE_HOME: path.join(tmp, 'claude'), JADE_PORT: String(PORT), JADE_TRANSPORT: 'http', ...extra });
const run = (args, extra = {}) => {
  const r = spawnSync(process.execPath, [CLIENT, ...args], { env: env(extra), encoding: 'utf8', timeout: 60000 });
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 1, 'exactly one line of output: ' + r.stdout + r.stderr);
  return { code: r.status, json: JSON.parse(lines[0]), stderr: r.stderr };
};
// For tests that run a stand-in server inside this process: a synchronous child would block that server from answering.
const runAsync = (args, extra = {}) => new Promise(resolve => {
  const c = spawn(process.execPath, [CLIENT, ...args], { env: env(extra) });
  let out = '', err = '';
  c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; });
  c.on('close', code => { const lines = out.trim().split('\n'); assert.equal(lines.length, 1, 'one line: ' + out + err); resolve({ code, json: JSON.parse(lines[0]), stderr: err }); });
});
// One request on its own connection (agent: false). The in-process fetch pools sockets, and the synchronous child runs in these tests block
// this process for seconds: long enough for the server to close an idle kept-alive socket (5 s), which fetch would then reuse and fail on
// with "other side closed".
const call = (method, p, headers = {}, body) => new Promise((resolve, reject) => {
  const q = http.request({ host: '127.0.0.1', port: PORT, path: p, method, agent: false, headers }, res => {
    const parts = []; res.on('data', c => parts.push(c));
    res.on('end', () => { const text = Buffer.concat(parts).toString('utf8'); resolve({ status: res.statusCode, ok: res.statusCode < 400, text: async () => text, json: async () => JSON.parse(text) }); });
  });
  q.on('error', reject); q.end(body);
});
const get = async p => (await call('GET', p, { 'x-jade': process.env.JADE_TOKEN })).json();
const post = (p, body) => call('POST', p, { 'x-jade': '1', 'content-type': 'application/json' }, JSON.stringify(body));

before(async () => {
  fs.mkdirSync(HOME, { recursive: true });
  fs.mkdirSync(path.join(DATA, 'projects'), { recursive: true });
  fs.mkdirSync(FOLDER, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify({ bridge: { enabled: true }, modules: { routines: true } }));   // off until switched on; Routines is off by default and the routine commands need it
  fs.writeFileSync(path.join(FOLDER, 'coverage-guide.docx'), 'x');
  fs.writeFileSync(path.join(FOLDER, 'other.txt'), 'x');
  fs.writeFileSync(path.join(DATA, 'projects', 'project-a.json'), JSON.stringify({ id: 'project-a', name: 'Project A', folders: [FOLDER] }));
  fs.writeFileSync(path.join(DATA, 'actions.json'), JSON.stringify([
    { id: 'a-one', text: 'Send the plan to Person One', project: 'project-a', due: '2026-12-01', priority: 'normal', status: 'open', createdAt: '2026-11-01T00:00:00Z' },
    { id: 'a-two', text: 'Book the review', project: 'project-b', due: '', priority: 'normal', status: 'open', createdAt: '2026-11-01T00:00:00Z' },
    { id: 'a-three', text: 'Already finished', project: 'project-a', due: '', priority: 'normal', status: 'done', createdAt: '2026-11-01T00:00:00Z' },
  ]));
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: env(), stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('test Jade exited at start-up with code ' + server.exitCode);
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/engines`)).ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('test Jade did not start');
});
after(() => { server?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('--help lists every command, and no arguments or a bad command is exit 2 with one JSON line', () => {
  const h = spawnSync(process.execPath, [CLIENT, '--help'], { encoding: 'utf8' });
  for (const c of ['status', 'actions', 'action-done', 'note-add', 'find', 'outputs', 'output-override', 'routines', 'run', 'job', 'ask', 'handoff']) assert.ok(h.stdout.includes(c), c);
  const bad = run(['nope']);
  assert.equal(bad.code, 2); assert.equal(bad.json.ok, false);
  const missing = run(['find']);
  assert.equal(missing.code, 2); assert.match(missing.json.error, /query is required/);
  assert.equal(run(['actions', '--bogus']).code, 2);
  assert.equal(run(['find', 'x', '--limit', '0']).code, 2);
  assert.equal(run(['output-override', '/x', '--as', 'maybe']).code, 2);
  assert.equal(run(['handoff']).code, 2);
});

test('status gives the counts Jade holds', () => {
  const { code, json } = run(['status']);
  assert.equal(code, 0); assert.equal(json.ok, true); assert.equal(json.source, 'http'); assert.equal(json.jade.reachable, true);
  assert.equal(json.counts.actionsOpen, 2);
  assert.deepEqual(Object.keys(json.counts).sort(), ['actionsOpen']);
});

test('actions filters by project and by open', () => {
  assert.equal(run(['actions']).json.actions.length, 3);
  const mine = run(['actions', '--project', 'project-a', '--open']).json;
  assert.deepEqual(mine.actions.map(a => a.id), ['a-one']);
  assert.deepEqual(Object.keys(mine.actions[0]).sort(), ['due', 'id', 'project', 'status', 'title', 'waitingOn']);
  assert.equal(mine.actions[0].title, 'Send the plan to Person One');
});

test('action-done ticks an action off with a note, and says so for one that is not there', async () => {
  const r = run(['action-done', 'a-two', '--note', 'Booked for Friday']).json;
  assert.deepEqual([r.ok, r.id, r.status], [true, 'a-two', 'done']);
  const saved = (await get('/api/actions')).find(a => a.id === 'a-two');
  assert.equal(saved.status, 'done'); assert.equal(saved.doneNote, 'Booked for Friday');
  const no = run(['action-done', 'a-nope']).json;
  assert.equal(no.ok, false); assert.match(no.error, /No action/);
});

test('note-add keeps quotes, dollar signs and non-ASCII exactly, and never overwrites an earlier note', async () => {
  const text = `Quote "double" and 'single' $(echo hi) \`tick\` $HOME café 日本語 😀`;
  const a = run(['note-add', text, '--project', 'project-a']).json;
  const b = run(['note-add', text]).json;
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.notEqual(a.id, b.id);
  const note = await get('/api/notes/' + a.id);
  assert.equal(note.body.trim(), text); assert.equal(note.project, 'project-a');
  assert.equal(run(['note-add', 'x', '--project', 'no-such']).json.ok, false);
});

test('find lists files by name with the documented fields', () => {
  const r = run(['find', 'coverage', '--limit', '5']).json;
  assert.equal(r.ok, true);
  const hit = r.files.find(f => f.name === 'coverage-guide.docx');
  assert.ok(hit, JSON.stringify(r));
  assert.deepEqual(Object.keys(hit).sort(), ['kind', 'modified', 'name', 'path', 'project', 'score', 'title']);
  assert.equal(hit.title, 'coverage-guide'); assert.equal(hit.project, 'project-a'); assert.match(hit.modified, /^\d{4}-/);
  assert.equal(run(['find', 'zzzznomatch']).json.files.length, 0);
});

test('routines lists them, run refuses what it should not start, and job reports a job', async () => {
  const r = run(['routines']).json;
  assert.equal(r.ok, true); assert.ok(r.routines.some(x => x.id === 'note-actions'));
  assert.deepEqual(Object.keys(r.routines[0]).sort(), ['id', 'lastRun', 'name', 'schedule']);
  assert.match(run(['run', 'jade']).json.error, /No routine/, 'the chat agent is not a routine');
  assert.match(run(['run', 'worker']).json.error, /No routine/, 'a builder is not a routine');
  assert.match(run(['run', 'dashboard-builder', '--project', 'project-a']).json.error, /No routine/, 'an agent that runs from its own page is not a routine');
  assert.match(run(['run', 'transcript']).json.error, /No routine/);
  assert.match(run(['run', 'no-such']).json.error, /No routine/);
  assert.match(run(['run', 'note-actions']).json.error, /needs note/);
  assert.equal(run(['job', 'j-nope']).json.ok, false);
});

test('with the Routines module off, routines and run say so and start nothing', async () => {
  await post('/api/modules/routines', { enabled: false });
  try {
    assert.match(run(['routines']).json.error, /Routines is switched off/);
    assert.match(run(['run', 'note-actions']).json.error, /Routines is switched off/);
    assert.equal(run(['run', 'note-actions']).json.status, 403);
  } finally { await post('/api/modules/routines', { enabled: true }); }
  assert.equal(run(['routines']).json.ok, true);
});

test('the read-only files way refuses while the bridge is switched off in Jade', () => {
  const off = path.join(tmp, 'off-home');
  fs.mkdirSync(off, { recursive: true });
  fs.writeFileSync(path.join(off, 'config.json'), JSON.stringify({ bridge: { enabled: false } }));
  const r = run(['status'], { JADE_TRANSPORT: 'files', JADE_HOME: off }).json;
  assert.equal(r.ok, false);
  assert.ok(r.tried.some(t => /switched off/.test(t.error)), JSON.stringify(r));
  assert.equal(run(['status'], { JADE_TRANSPORT: 'files', JADE_HOME: DATA }).json.ok, true, 'and answers once it is on');
});

test('ask starts a read-only chat job and returns its id; a wait that runs out still returns the id', async () => {
  const r = run(['ask', 'Which actions are open?']).json;
  assert.equal(r.ok, true); assert.ok(r.jobId); assert.equal('answer' in r, false);
  const job = await get('/api/jobs/' + r.jobId);
  assert.equal(job.agent, 'jade'); assert.equal(job.input.askOnly, true);
  assert.match(job.input.message, /do not create, change or delete any file/);
  await post(`/api/jobs/${r.jobId}/cancel`, {});
  assert.equal(run(['ask', '   ']).code, 2);
});

test('a question from Claude never carries out actions or gets edit rights', async () => {
  process.env.JADE_HOME ||= fs.mkdtempSync(path.join(os.tmpdir(), 'jade-ask-test-')); // never the real data folder
  const agents = await import('../server/core/agents.js');
  const def = agents.get('jade');
  const prep = await agents.prepare(def, { message: 'hi', thread: 'c-test', askOnly: true });
  assert.equal(prep.edits, false);
  const normal = await agents.prepare(def, { message: 'hi', thread: 'c-test' });
  assert.ok(normal.system.length - prep.system.length > 500, 'the action-block guide is left out of a question from Claude');
});

test('handoff writes a brief file with the task, folders, open actions and what done means', () => {
  const r = run(['handoff', '--action', 'a-one']).json;
  assert.equal(r.ok, true);
  assert.ok(r.path.startsWith(path.join(DATA, 'handoffs') + path.sep), r.path);
  assert.ok(r.prompt.includes(r.path) && !r.prompt.includes('\n'));
  const md = fs.readFileSync(r.path, 'utf8');
  assert.match(md, /Send the plan to Person One/); assert.ok(md.includes(FOLDER)); assert.match(md, /What done looks like/); assert.match(md, /jade_action_done/);
  assert.ok(!md.includes('Book the review'), 'only this project\'s open actions');
  const p = run(['handoff', '--project', 'project-a']).json;
  assert.match(fs.readFileSync(p.path, 'utf8'), /Project A/);
  const t = run(['handoff', '--text', 'Draft the coverage guide']).json;
  assert.match(fs.readFileSync(t.path, 'utf8'), /Draft the coverage guide/);
  assert.notEqual(t.path, r.path);
  assert.match(run(['handoff', '--action', 'nope']).json.error, /No action/);
});

test('huge text is refused, not sent', async () => {
  // Windows refuses a command line over about 32,000 characters before the client starts, so the command-line half cannot be tried there
  const cli = process.platform !== 'win32';
  if (cli) { const r = run(['note-add', 'x'.repeat(100001)]); assert.equal(r.code, 2); assert.equal(r.json.ok, false); assert.match(r.json.error, /too long/); }
  const res = await post('/api/bridge/note', { text: 'x'.repeat(100001) });
  assert.equal(res.status, 413);
  if (cli) assert.equal(run(['note-add', 'y'.repeat(90000)]).json.ok, true);
});

test('the server refuses a bridge write without the X-Jade header', async () => {
  for (const p of ['/api/bridge/note', '/api/bridge/handoff', '/api/bridge/ask', '/api/bridge/run']) {
    const res = await call('POST', p, {}, '{}');
    assert.equal(res.status, 403, p);
  }
});

// ---- outputs and the override call belong to the ring stream; here they are tested against a stand-in server
test('outputs and output-override talk to /api/outputs, with X-Jade on the write', async () => {
  const seen = [];
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, xjade: req.headers['x-jade'], body });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') res.end(JSON.stringify({ outputs: [{ path: '/p/a.docx', name: 'a.docx', title: 'a', project: 'project-a', area: 'x', modified: '2026-11-01T00:00:00Z', kind: 'doc', bundle: null, loose: false }] }));
      else res.end(JSON.stringify({ ok: true, ...JSON.parse(body) }));
    });
  });
  await new Promise(r => fake.listen(FAKE, '127.0.0.1', r));
  try {
    const x = { JADE_PORT: String(FAKE) };
    const o = (await runAsync(['outputs', '--limit', '3', '--project', 'project-a'], x)).json;
    assert.equal(o.ok, true); assert.equal(o.outputs[0].name, 'a.docx');
    assert.equal(seen[0].url, '/api/outputs?limit=3&project=project-a');
    const w = (await runAsync(['output-override', '/p/a.docx', '--as', 'not-output'], x)).json;
    assert.deepEqual([w.ok, w.path, w.as], [true, '/p/a.docx', 'not-output']);
    const post1 = seen.find(s => s.method === 'POST');
    assert.equal(post1.xjade, '1'); assert.equal(post1.url, '/api/outputs/override'); assert.deepEqual(JSON.parse(post1.body), { path: '/p/a.docx', as: 'not-output' });
  } finally { fake.close(); }
});

test('every write the client makes carries X-Jade: 1 (checked against a recording stand-in)', async () => {
  const seen = [];
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => { seen.push({ method: req.method, url: req.url, xjade: req.headers['x-jade'] }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'x', status: 'done', jobId: 'j1', path: '/p', prompt: 'p' })); });
  });
  await new Promise(r => fake.listen(FAKE, '127.0.0.1', r));
  try {
    const x = { JADE_PORT: String(FAKE) };
    await runAsync(['action-done', 'a1'], x); await runAsync(['note-add', 'hi'], x); await runAsync(['run', 'dashboard-builder'], x); await runAsync(['ask', 'hi'], x); await runAsync(['handoff', '--text', 'hi'], x);
    const writes = seen.filter(s => s.method !== 'GET');
    assert.equal(writes.length, 5);
    for (const w of writes) assert.equal(w.xjade, '1', w.method + ' ' + w.url);
    for (const s of seen.filter(s => s.method === 'GET')) assert.equal(s.xjade, undefined);
  } finally { fake.close(); }
});

test('Jade down: ok:false, one JSON line, exit 0, no stack trace', () => {
  const r = run(['status'], { JADE_PORT: String(DOWN), JADE_TRANSPORT: 'http' });
  assert.equal(r.code, 0); assert.equal(r.json.ok, false); assert.equal(r.json.jade.reachable, false); assert.equal(r.stderr, '');
  assert.ok(!/\n\s+at /.test(JSON.stringify(r.json)));
});

test('the files way answers read-only commands from the data folder when Jade is down', () => {
  const x = { JADE_PORT: String(DOWN), JADE_TRANSPORT: 'http,files' };
  const s = run(['status'], x).json;
  assert.equal(s.ok, true); assert.equal(s.source, 'files'); assert.equal(s.jade.reachable, false); assert.equal(typeof s.counts.actionsOpen, 'number');
  const a = run(['actions', '--open', '--project', 'project-a'], x).json;
  assert.equal(a.source, 'files'); assert.deepEqual(a.actions.map(i => i.id), ['a-one']);
  const f = run(['find', 'coverage'], x).json;
  assert.equal(f.source, 'files'); assert.ok(f.files.some(i => i.name === 'coverage-guide.docx'));
  assert.equal(run(['routines'], x).json.ok, false);
  assert.equal(run(['outputs'], x).json.ok, false);
});

test('write commands refuse the files way, and change nothing on disk', () => {
  const before = fs.readFileSync(path.join(DATA, 'actions.json'), 'utf8');
  const notesBefore = fs.readdirSync(path.join(DATA, 'notes')).length;
  const x = { JADE_PORT: String(DOWN), JADE_TRANSPORT: 'files' };
  for (const args of [['action-done', 'a-one'], ['note-add', 'hello'], ['run', 'dashboard-builder'], ['ask', 'hi'], ['handoff', '--text', 'hi'], ['output-override', '/p', '--as', 'output']]) {
    const r = run(args, x);
    assert.equal(r.code, 0); assert.equal(r.json.ok, false, args[0]); assert.match(r.json.error, /Jade is not running|cannot be done without it/, args[0]);
    assert.ok(r.json.tried.every(t => t.via === 'files'));
  }
  assert.equal(fs.readFileSync(path.join(DATA, 'actions.json'), 'utf8'), before);
  assert.equal(fs.readdirSync(path.join(DATA, 'notes')).length, notesBefore);
  assert.ok(!fs.existsSync(path.join(DATA, 'handoffs', 'nonexistent')));
});

test('transport order: http first; a dead http falls to powershell then files; JADE_TRANSPORT limits the list', () => {
  const up = run(['status'], { JADE_TRANSPORT: 'http,powershell,files' }).json;
  assert.equal(up.source, 'http');
  const down = run(['status'], { JADE_PORT: String(DOWN), JADE_TRANSPORT: 'http,powershell,files' }).json;
  // powershell is tried second; whether or not it exists here, the answer must end at files, and the log must show the order
  assert.equal(down.source, 'files');
  const only = run(['status'], { JADE_PORT: String(DOWN), JADE_TRANSPORT: 'powershell' }).json;
  assert.equal(only.ok, false); assert.deepEqual(only.tried.map(t => t.via), ['powershell']);
});

test('the powershell way carries quotes, dollar signs and non-ASCII through untouched (needs powershell.exe; skipped without it)', async t => {
  const probe = spawnSync('powershell.exe', ['-NoProfile', '-Command', '1'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return t.skip('powershell.exe is not available here');
  const got = [];
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => { got.push({ url: req.url, xjade: req.headers['x-jade'], body }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'n1' })); });
  });
  await new Promise(r => fake.listen(FAKE, '127.0.0.1', r));
  try {
    const text = `a "b" 'c' $(Get-Date) \`d\` $env:USERNAME %PATH% café 日本語 😀; & echo pwned`;
    const r = await runAsync(['note-add', text], { JADE_PORT: String(FAKE), JADE_TRANSPORT: 'powershell' });
    assert.equal(r.json.ok, true, JSON.stringify(r.json)); assert.equal(r.json.source, 'powershell');
    assert.equal(got[0].xjade, '1'); assert.equal(got[0].url, '/api/bridge/note');
    assert.equal(JSON.parse(got[0].body).text, text);
  } finally { fake.close(); }
});

// ---- MCP
const rpc = (lines, extra = {}) => {
  const r = spawnSync(process.execPath, [MCP], { env: env(extra), input: lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n', encoding: 'utf8', timeout: 60000 });
  return r.stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
};

test('MCP: handshake, tool list with schemas, notifications ignored, and a tool call over stdio', () => {
  const out = rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'jade_actions', arguments: { project: 'project-a', open: true } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'jade_status', arguments: {} } },
  ]);
  assert.deepEqual(out.map(o => o.id), [1, 2, 3, 4], 'one reply per request, none for the notification');
  assert.equal(out[0].result.protocolVersion, '2025-06-18'); assert.ok(out[0].result.capabilities.tools); assert.equal(out[0].result.serverInfo.name, 'jade');
  const names = out[1].result.tools.map(t => t.name).sort();
  assert.deepEqual(names, ['jade_action_done', 'jade_actions', 'jade_ask', 'jade_find', 'jade_handoff', 'jade_job', 'jade_note_add', 'jade_output_override', 'jade_outputs', 'jade_routines', 'jade_run', 'jade_status']);
  for (const t of out[1].result.tools) { assert.equal(t.inputSchema.type, 'object'); assert.ok(t.description.length > 10 && t.description.length < 120); assert.ok(!/\n/.test(t.description)); }
  assert.ok(!names.some(n => /send|delete|remove|edit|write/.test(n)), 'no send, delete or edit tool');
  const acts = JSON.parse(out[2].result.content[0].text);
  assert.equal(out[2].result.isError, false); assert.deepEqual(acts.actions.map(a => a.id), ['a-one']);
  assert.equal(JSON.parse(out[3].result.content[0].text).counts.actionsOpen, 1);
});

test('MCP: errors are answers, not crashes (unknown tool, unknown method, bad JSON, bad arguments, Jade down)', () => {
  const out = rpc([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'jade_send_mail', arguments: {} } },
    { jsonrpc: '2.0', id: 2, method: 'resources/list' },
    '{ not json',
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'jade_find', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'jade_find', arguments: { query: 'x', surprise: 1 } } },
    { jsonrpc: '2.0', id: 5, method: 'ping' },
    [1, 2],
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'jade_status' } },
  ], { JADE_PORT: String(DOWN) });
  const by = id => out.find(o => o.id === id);
  assert.equal(by(1).error.code, -32602); assert.equal(by(2).error.code, -32601);
  assert.ok(out.some(o => o.error?.code === -32700 && o.id === null));
  assert.equal(by(3).result.isError, true); assert.match(JSON.parse(by(3).result.content[0].text).error, /query is required/);
  assert.equal(by(4).result.isError, true);
  assert.deepEqual(by(5).result, {});
  assert.ok(out.some(o => o.error?.code === -32600));
  assert.equal(by(6).result.isError, true); assert.equal(JSON.parse(by(6).result.content[0].text).jade.reachable, false);
});

test('MCP: a write tool call goes through to Jade', async () => {
  const out = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'jade_action_done', arguments: { id: 'a-one', note: 'done via mcp' } } }]);
  const r = JSON.parse(out[0].result.content[0].text);
  assert.deepEqual([r.ok, r.id, r.status], [true, 'a-one', 'done']);
  assert.equal((await get('/api/actions')).find(a => a.id === 'a-one').doneNote, 'done via mcp');
});

test('the tool list is small enough to carry every session', () => {
  const out = rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  const chars = JSON.stringify(out[0].result.tools).length;
  assert.ok(chars < 6000, 'tool list is ' + chars + ' characters');
});
