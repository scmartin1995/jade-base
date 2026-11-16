// The meeting path end to end, with no real model: a real server on a random port, temp homes, and a stand-in `claude` on
// PATH that answers the locked-down judge calls from the sample meeting's expected.json. Upload, read, extract, check,
// review, record, actions, duplicate; and the judge runs carry no tool permissions and keep the gateway set-up.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeStub } from './helpers/stub.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'test/fixtures/meetings');
const NAME = 'warehouse-weekly-2026-11-10.vtt';
const expected = JSON.parse(fs.readFileSync(path.join(FIX, 'warehouse-weekly-2026-11-10.expected.json'), 'utf8'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-meet-e2e-'));
const bin = path.join(tmp, 'bin'), dump = path.join(tmp, 'dump'), home = path.join(tmp, 'home'), claudeHome = path.join(tmp, 'claude'), folder = path.join(tmp, 'project-folder');
for (const d of [bin, dump, home, claudeHome, folder]) fs.mkdirSync(d, { recursive: true });

// The stand-in: anything that is not a `-p` run (version, auth) is answered with nothing; a judge run is written down
// (argv and env) and answered with JSON made from expected.json, chosen by the shape of the schema it was asked for.
writeStub(bin, 'claude', `const fs = require('node:fs');
const a = process.argv.slice(2);
if (a[0] !== '-p') { if (a[0] === 'auth') process.stdout.write('{}'); process.exit(0); }
const exp = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(FIX, 'warehouse-weekly-2026-11-10.expected.json'))}, 'utf8'));
let prompt = '';
process.stdin.on('data', c => { prompt += c; });
process.stdin.on('end', () => {
  const schema = JSON.parse(a[a.indexOf('--json-schema') + 1]);
  fs.appendFileSync(${JSON.stringify(path.join(dump, 'runs.jsonl'))}, JSON.stringify({ argv: a, env: process.env, prompt }) + '\\n');
  const props = schema.properties || {};
  let out;
  if (props.verdicts) {
    const made = prompt.slice(prompt.lastIndexOf('# What it produced'));
    const items = JSON.parse(made.slice(made.indexOf('[')));
    out = { verdicts: items.map(i => ({ item_id: i.item_id, verdict: 'supported', evidence: i.output.quote, instruction: '', note: '' })), missed: [] };
  } else {
    const f = Object.keys(props.items.items.properties);
    const q = x => ({ ...x });
    let items;
    if (f.includes('kind')) items = exp.risks.map(r => ({ kind: r.kind, text: r.text, impact: '', raised_by: r.raisedBy, quote: r.quote }));
    else if (f.includes('owner')) items = exp.actions.map(r => ({ text: r.text, owner: r.owner, due: r.due, due_date: r.isoDue || '', quote: r.quote }));
    else items = exp.keyPoints.map(r => q({ text: r.text, quote: r.quote }));
    out = { items };
  }
  process.stdout.write(JSON.stringify({ type: 'result', result: '', is_error: false, structured_output: out, modelUsage: { 'stand-in': {} }, total_cost_usd: 0 }) + '\\n');
});
`);

// a gateway set-up, the way Settings keeps it
const GATEWAY = 'http://127.0.0.1:9';
fs.writeFileSync(path.join(home, 'engine.env'), `ANTHROPIC_BASE_URL=${GATEWAY}\nANTHROPIC_AUTH_TOKEN=tok-test\n`);
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ voice: { wake: false } }));

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, JADE_HOME: home, JADE_CLAUDE_HOME: claudeHome, JADE_PORT: String(port) };
for (const k of Object.keys(env)) if (/^(ANTHROPIC_|AWS_|CLAUDE_CODE_|CLAUDECODE)/.test(k)) delete env[k];
const server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
let serverErr = ''; server.stderr.on('data', d => { serverErr += d; });
after(() => { server.kill('SIGTERM'); fs.rmSync(tmp, { recursive: true, force: true }); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let t0 = Date.now(), up = false; !up; await sleep(200)) {
  if (Date.now() - t0 > 20000 || server.exitCode !== null) throw new Error('server did not start: ' + serverErr);
  try { up = (await fetch(base + '/api/boot', { headers: { 'x-jade': process.env.JADE_TOKEN } })).status === 200; } catch { /* not yet */ }
}
const call = async (method, url, body, headers = {}) => {
  const r = await fetch(base + url, { method, headers: { 'x-jade': '1', ...(body && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
};
const runs = () => (fs.existsSync(path.join(dump, 'runs.jsonl')) ? fs.readFileSync(path.join(dump, 'runs.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []);

let project, mid, recordPath;

test('upload a transcript and wait for it to be ready to review', async () => {
  project = (await call('POST', '/api/projects', { name: 'Warehouse move', folders: [folder] })).data;
  assert.ok(project.id);
  const up = await call('POST', `/api/meetings/upload?project=${project.id}&name=${encodeURIComponent(NAME)}`, fs.readFileSync(path.join(FIX, NAME)), { 'content-type': 'application/octet-stream' });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.ok(up.data.id); assert.equal(up.data.duplicateOf, null);
  mid = up.data.id;
  let m;
  for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(200)) {
    m = (await call('GET', `/api/meetings/${mid}`)).data;
    if (['review', 'failed'].includes(m.status)) break;
  }
  assert.equal(m.status, 'review', m.error || JSON.stringify(m.steps));
  assert.equal(m.date, expected.date);
  assert.deepEqual(m.skills.map(s => s.skill), ['key-points', 'action-items', 'risks-issues']);
  assert.equal(m.skills[1].items.length, expected.actions.length);
  for (const s of m.skills) for (const i of s.items) { assert.equal(i.codeCheck.ok, true, `quote not found: ${i.quote}`); assert.equal(i.verdict, 'supported'); }
  const t = path.join(folder, 'Jade', 'Meetings', 'transcripts', NAME);
  assert.ok(fs.existsSync(t), 'the transcript is kept in Meetings/transcripts');
  assert.equal(m.source.path, t);
  const list = (await call('GET', `/api/meetings?project=${project.id}`)).data;
  assert.equal(list.length, 1); assert.equal(list[0].id, mid);
  // the list is a summary: counts, not the items (the single meeting above has them)
  assert.ok(list[0].skills.every(s => !('items' in s) && s.count > 0), 'the list sends a count per kind, not the items');
  assert.equal(list[0].skills.reduce((n, s) => n + s.count, 0), m.skills.reduce((n, s) => n + s.items.length, 0));
  assert.ok(!('steps' in list[0]) && !('missed' in list[0]));
  assert.ok(JSON.stringify(list).length < JSON.stringify(m).length / 2, 'much smaller than the meeting itself');
  for (const k of ['id', 'title', 'status', 'date', 'project', 'counts', 'recordPath', 'source']) assert.ok(k in list[0], k);
});

test('keep some, leave one out, record: the Markdown has only what was kept and the actions point at it', async () => {
  const m = (await call('GET', `/api/meetings/${mid}`)).data;
  const acts = m.skills.find(s => s.skill === 'action-items').items;
  const leftOut = acts[2];
  const changes = m.skills.flatMap(s => s.items).map(i => ({ id: i.id, accepted: i.id !== leftOut.id }));
  const p = await call('PATCH', `/api/meetings/${mid}`, { items: changes });
  assert.equal(p.status, 200);
  const rec = await call('POST', `/api/meetings/${mid}/record`);
  assert.equal(rec.status, 200, JSON.stringify(rec.data));
  recordPath = rec.data.recordPath;
  assert.equal(path.dirname(recordPath), path.join(folder, 'Jade', 'Meetings'));
  assert.match(path.basename(recordPath), new RegExp('^' + expected.date + ' .+\\.md$'));
  const md = fs.readFileSync(recordPath, 'utf8');
  assert.match(md, /^---\n[\s\S]*date: .*2026-11-10/);
  for (const h of ['## Key points', '## Action items', '## Risks and issues']) assert.ok(md.includes(h), h);
  assert.ok(md.includes(expected.actions[0].text));
  assert.ok(!md.includes(leftOut.fields.text), 'the item left out is not in the record');
  assert.equal((await call('GET', `/api/meetings/${mid}`)).data.status, 'recorded');

  const actions = (await call('GET', '/api/actions')).data.filter(a => a.source === recordPath);
  assert.equal(actions.length, expected.actions.length - 1);
  assert.ok(!actions.some(a => a.text.startsWith(leftOut.fields.text)));
  const confirm = actions.find(a => a.text.startsWith(expected.actions[0].text));
  assert.equal(confirm.owner, expected.actions[0].owner);
  assert.equal(confirm.due, expected.actions[0].isoDue);   // the date field the pipeline fills from the words and the meeting date
  assert.equal(confirm.project, project.id);
});

test('the same file again is reported as a duplicate and starts nothing', async () => {
  const before = runs().length;
  const up = await call('POST', `/api/meetings/upload?project=${project.id}&name=${encodeURIComponent(NAME)}`, fs.readFileSync(path.join(FIX, NAME)), { 'content-type': 'application/octet-stream' });
  assert.equal(up.status, 200);
  assert.equal(up.data.duplicateOf, mid);
  await sleep(500);
  assert.equal(runs().length, before, 'no model call for a duplicate');
  assert.equal(fs.readdirSync(path.join(folder, 'Jade', 'Meetings', 'transcripts')).length, 1, 'no second copy kept');
  assert.equal((await call('POST', `/api/meetings/upload?project=${project.id}&name=notes.exe`, Buffer.from('x'))).status, 415);
});

test('the model and the checker are told the meeting date and weekday, and the checker sees one skill per item', () => {
  const all = runs();
  const extract = all.filter(r => r.prompt.includes('--- TRANSCRIPT ---'));
  assert.equal(extract.length, 3);
  for (const r of extract) assert.match(r.prompt, /Meeting date: 2026-11-10 \(Tuesday\)/);
  const checks = all.filter(r => r.prompt.includes('# What it produced'));
  assert.equal(checks.length, 3, 'one check per skill');
  for (const r of checks) {
    assert.match(r.prompt, /Meeting date: 2026-11-10 \(Tuesday\)/);
    assert.equal((r.prompt.match(/# [\w-]+\/SKILL\.md/g) || []).length, 1, 'only the skill that made the items');
  }
});

test('every judge run is locked down and keeps the gateway set-up', () => {
  const all = runs();
  assert.ok(all.length >= 6, 'three skills and three checks');
  // what a judge run looks like on a gateway with nothing chosen, from the frozen parity fixture
  const want = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/provider-parity-gateway.json'), 'utf8')).runs['anthropicGateway | none | empty | judge | ""'];
  const tail = want.argv.slice(want.argv.indexOf('--json-schema') + 2);
  for (const r of all) {
    const a = r.argv;
    assert.equal(a[0], '-p');
    assert.equal(a[a.indexOf('--tools') + 1], '', 'no tools');
    assert.equal(a[a.indexOf('--setting-sources') + 1], '', 'none of the user\'s settings');
    assert.ok(a.includes('--strict-mcp-config') && a.includes('--no-session-persistence'));
    for (const bad of ['--allowedTools', '--allowed-tools', '--dangerously-skip-permissions', '--permission-mode', '--permission-prompt-tool', '--add-dir', '--settings', '--agents'])
      assert.ok(!a.includes(bad), bad + ' must not be passed to a judge run');
    assert.deepEqual(a.slice(a.indexOf('--json-schema') + 2), tail, 'the model argument follows the gateway rules');
    assert.equal(r.env.ANTHROPIC_BASE_URL, GATEWAY);
    assert.equal(r.env.ANTHROPIC_AUTH_TOKEN, 'tok-test');
  }
  assert.equal(serverErr.includes('Uncaught'), false, serverErr);
});
