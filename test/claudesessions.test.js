// The reader of Claude Code conversations (server/core/claudesessions.js): which sessions count (by folder, by scope, by age, and
// never Jade's own runs), what a digest keeps (typed messages, replies, tool names and file paths) and what it never does (tool
// output, file contents, thinking, sub-agent lines), the size caps and their notice, and lines it cannot read. Every file here is
// written by hand with invented words, in a temp Claude home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-sessions-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const sessions = await import('../server/core/claudesessions.js');

const projA = path.join(tmp, 'work', 'helios');           // a Jade project's folder
const projSub = path.join(projA, 'reports');               // inside it
const other = path.join(tmp, 'work', 'garden');            // not a Jade project
const lookalike = path.join(tmp, 'work', 'helios-reports');// its Claude folder name starts the same as projA's, but it is another folder
const jadeHome = process.env.JADE_HOME;
const NOW = Date.parse('2026-11-13T12:00:00Z');
const dirOf = folder => path.join(process.env.JADE_CLAUDE_HOME, 'projects', sessions.sessionDirName?.(folder) ?? folder.replace(/[^A-Za-z0-9]/g, '-'));
const ts = (d, h = 9) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;

let n = 0;
const base = (cwd, d, extra = {}) => ({ cwd, sessionId: 's1', timestamp: ts(d), isSidechain: false, entrypoint: 'cli', ...extra, uuid: 'u' + ++n });
const user = (cwd, d, content, extra) => ({ type: 'user', ...base(cwd, d, extra), message: { role: 'user', content } });
const asst = (cwd, d, blocks, extra) => ({ type: 'assistant', ...base(cwd, d, extra), message: { role: 'assistant', content: blocks } });
function write(folder, name, lines, mtime = NOW) {
  const dir = dirOf(folder); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name + '.jsonl');
  fs.writeFileSync(f, lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
  fs.utimesSync(f, mtime / 1000, mtime / 1000);
  return f;
}

// 1. a real-looking session in the project's folder, with everything that must NOT come through
write(projA, 'a1', [
  { type: 'queue-operation', operation: 'enqueue', sessionId: 's1', timestamp: ts(10) },
  user(projA, 10, 'Please draft the weekly status for Helios'),
  user(projA, 10, '<system-reminder>REMINDER-TEXT</system-reminder>', { isMeta: true }),
  user(projA, 10, '<command-name>/model</command-name>'),
  asst(projA, 10, [{ type: 'thinking', thinking: 'SECRET-THINKING', signature: 'x' }]),
  asst(projA, 10, [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: path.join(projA, 'notes', 'plan.md') } }]),
  user(projA, 10, [{ type: 'tool_result', tool_use_id: 't1', content: 'SECRET-TOOL-OUTPUT', is_error: false }], { toolUseResult: { stdout: 'SECRET-TOOL-OUTPUT' } }),
  asst(projA, 10, [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: path.join(projA, 'status.md'), old_string: 'SECRET-FILE-CONTENT', new_string: 'SECRET-FILE-CONTENT-2' } }]),
  asst(projA, 10, [{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'ls', description: 'list' } }]),
  asst(projA, 10, [{ type: 'text', text: 'I drafted the status file.' }]),
  { type: 'user', ...base(projA, 10, { isSidechain: true }), message: { role: 'user', content: 'SIDECHAIN-TEXT' } },
  asst(projA, 10, [{ type: 'text', text: 'SIDECHAIN-REPLY' }], { isSidechain: true }),
  '{this is not json',
  '',
  '[1,2,3]',
  { type: 'something-new', payload: { deep: true }, sessionId: 's1' },
  { type: 'user', ...base(projA, 11), message: { role: 'user', content: { odd: 'shape' } } },
  user(projA, 11, 'Now the same again for Apollo'),
  { type: 'assistant', ...base(projA, 11), isApiErrorMessage: true, message: { role: 'assistant', content: [{ type: 'text', text: 'API-ERROR-TEXT' }] } },
]);
// 2. one in a folder below the project's
write(projSub, 'b1', [user(projSub, 12, 'Summarise the reports folder'), asst(projSub, 12, [{ type: 'text', text: 'Done.' }])]);
// 3. a lookalike: its Claude folder name is the same as the project's plus more, and so is the one for a folder with the same letters
fs.mkdirSync(path.join(tmp, 'work'), { recursive: true });
write(lookalike, 'c1', [user(lookalike, 12, 'LOOKALIKE-TEXT')]);
// 4. a folder that is not a project
write(other, 'd1', [user(other, 12, 'Plan the vegetable beds'), asst(other, 12, [{ type: 'text', text: 'Start with the tomatoes.' }])]);
// 5. Jade's own headless run: its folder is the data folder, and it was started headless
write(jadeHome, 'e1', [user(jadeHome, 12, '# Context\n\n## profile\nJADE-OWN-PROMPT', { entrypoint: 'sdk-cli' })]);
// ...and one that is another Jade's run, started headless from some other folder with the same kind of prompt
write(other, 'e2', [user(other, 12, '# Context\n\n## profile\nOTHER-JADE-PROMPT', { entrypoint: 'sdk-cli' })]);
// 6. an old one: file touched long ago
write(projA, 'f1', [user(projA, 1, 'OLD-TEXT')], NOW - 30 * 864e5);
// 7. a long-running file touched now whose early lines are older than the window
write(projA, 'g1', [user(projA, 1, 'EARLY-IN-A-LONG-SESSION'), user(projA, 12, 'Recent line in the same session')]);

const opts = (o = {}) => ({ now: NOW, folders: [projA], exclude: [jadeHome], ...o });

test('scope "projects": sessions in a project folder or below it, matched by the folder inside the file, not just its name', async () => {
  const r = await sessions.week(opts());
  assert.equal(r.scope, 'projects');
  const t = r.text;
  assert.match(t, /Please draft the weekly status for Helios/);
  assert.match(t, /Summarise the reports folder/);
  assert.doesNotMatch(t, /vegetable beds/);
  assert.doesNotMatch(t, /LOOKALIKE-TEXT/);
  assert.ok(r.skipped.outside >= 1);
});

test('scope "all" reads every folder; scope "off" reads nothing', async () => {
  const all = await sessions.week(opts({ scope: 'all' }));
  assert.match(all.text, /vegetable beds/); assert.match(all.text, /LOOKALIKE-TEXT/); assert.match(all.text, /Please draft the weekly status/);
  const off = await sessions.week(opts({ scope: 'off' }));
  assert.deepEqual([off.scope, off.sessions.length, off.text], ['off', 0, '']);
  const nonsense = await sessions.week(opts({ scope: 'everything' }));
  assert.equal(nonsense.scope, 'off', 'an unknown scope reads nothing');
});

test('Jade\'s own headless runs never count, in either scope, and the digest says how many it left out', async () => {
  for (const scope of ['projects', 'all']) {
    const r = await sessions.week(opts({ scope, folders: [projA, jadeHome] }));
    assert.doesNotMatch(r.text, /JADE-OWN-PROMPT|OTHER-JADE-PROMPT/, scope);
  }
  const all = await sessions.week(opts({ scope: 'all' }));
  assert.ok(all.skipped.jade >= 1);
});

test('the digest keeps typed messages, replies, tool names and file paths, and nothing else', async () => {
  const t = (await sessions.week(opts())).text;
  assert.match(t, /You: Please draft the weekly status for Helios/);
  assert.match(t, /You: Now the same again for Apollo/);
  assert.match(t, /Claude: I drafted the status file\./);
  assert.match(t, /tools used: .*Read x1/); assert.match(t, /Edit x1/); assert.match(t, /Bash x1/);
  assert.match(t, /files touched: .*notes[\\/]plan\.md/); assert.match(t, /status\.md/);
  for (const secret of ['SECRET-THINKING', 'SECRET-TOOL-OUTPUT', 'SECRET-FILE-CONTENT', 'REMINDER-TEXT', 'SIDECHAIN-TEXT', 'SIDECHAIN-REPLY', 'API-ERROR-TEXT', '/model', 'odd'])
    assert.ok(!t.includes(secret), secret + ' must not be in the digest');
  assert.doesNotMatch(t, /old_string|new_string|tool_result|toolUseResult/);
});

test('a session that ends in an error says so; the date is the first day in the window; old lines of a long session are left out', async () => {
  const r = await sessions.week(opts());
  const a1 = r.sessions.find(s => s.id === 'a1');
  assert.equal(a1.error, true);
  assert.equal(a1.date, '2026-11-10');
  assert.match(r.text, /ended with an error/);
  assert.ok(!r.text.includes('OLD-TEXT'), 'a file not touched for 30 days is not read');
  assert.ok(!r.text.includes('EARLY-IN-A-LONG-SESSION'));
  assert.match(r.text, /Recent line in the same session/);
  const b1 = r.sessions.find(s => s.id === 'b1');
  assert.equal(b1.error, false);
});

test('lines that are not JSON or have a shape it does not know are skipped without stopping the session', async () => {
  const s = await sessions.readSession(path.join(dirOf(projA), 'a1.jsonl'), { sinceMs: NOW - 7 * 864e5 });
  assert.equal(s.messages, 3);
  const empty = write(projA, 'h1', ['{broken', '[]', '{"type":"user"}', '{"type":"user","message":{"content":[null,1,{"type":"text"}]}}', 'plain words']);
  assert.equal(await sessions.readSession(empty, { sinceMs: 0 }), null, 'nothing readable: no digest, no error');
});

test('a session is cut to the per-session size, and the digest says so', async () => {
  const lines = Array.from({ length: 80 }, (_, i) => user(projA, 12, `Question number ${i}: ` + 'x'.repeat(200)));
  write(projA, 'big', lines);
  const r = await sessions.week(opts({ maxCharsPerSession: 1500 }));
  const big = r.sessions.find(s => s.id === 'big');
  assert.ok(big.cut); assert.ok(big.dropped > 50);
  const text = sessions.render(big);
  assert.ok(text.length < 2400, `digest is ${text.length} characters`);
  assert.match(text, /\[cut: \d+ more messages left out to keep this short\]/);
  assert.equal(r.cutSessions >= 1, true);
  fs.rmSync(path.join(dirOf(projA), 'big.jsonl'));
});

test('the whole Claude Code section is cut to the overall size, newest sessions first, and says how many were left out', async () => {
  const r = await sessions.week(opts({ scope: 'all', maxChars: 600 }));
  assert.ok(r.text.length < 1200);
  assert.ok(r.omitted >= 1);
  assert.match(r.text, /\[cut: \d+ older sessions? left out to keep this short\]/);
});

test('files are streamed: a line larger than the limit is skipped, not loaded', async () => {
  const f = write(projA, 'huge', [user(projA, 12, 'before'), '{"type":"user","pad":"' + 'z'.repeat(5 * 1024 * 1024) + '"}', user(projA, 12, 'after')]);
  const s = await sessions.readSession(f, { sinceMs: 0 });
  assert.equal(s.messages, 2);
  fs.rmSync(f);
});

test('IDE selection and opened-file blocks, compaction summaries and pasted keys do not reach the digest', async () => {
  const f = write(projA, 'ide', [
    user(projA, 12, '<ide_opened_file>The user opened the file /x/secret-plan.md in the IDE. FILE-BODY-ONE</ide_opened_file>\nPlease review the budget'),
    user(projA, 12, '<ide_selection>The user selected lines 1-3 from /x/a.py:\nSELECTED-CODE-TWO\n\nThis may or may not be related.</ide_selection>'),
    user(projA, 12, 'This session is being continued from a previous conversation that ran out of context. SUMMARY-THREE'),
    user(projA, 12, 'summary text four', { isCompactSummary: true }),
    user(projA, 12, 'my key is sk-ant-api03-abcdefghijklmnopqrstuv and AKIAIOSFODNN7EXAMPLE, Bearer abcdefgh12345678'),
  ]);
  const s = await sessions.readSession(f, { sinceMs: 0 });
  const text = sessions.render(s);
  assert.match(text, /Please review the budget/);
  for (const bad of ['FILE-BODY-ONE', 'SELECTED-CODE-TWO', 'SUMMARY-THREE', 'summary text four', 'abcdefghijklmnopqrstuv', 'AKIAIOSFODNN7EXAMPLE', 'abcdefgh12345678'])
    assert.ok(!text.includes(bad), bad);
  assert.equal(s.messages, 2);
  fs.rmSync(f);
});

test('a single huge line without a newline does not fill memory, and a very large file is read from its newest part', async () => {
  const dir = dirOf(projA); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'giant.jsonl');
  const fd = fs.openSync(f, 'w');
  fs.writeSync(fd, JSON.stringify(user(projA, 12, 'OLD-START-WORDS')) + '\n');
  const chunk = Buffer.alloc(1024 * 1024, 'z');
  for (let i = 0; i < 70; i++) fs.writeSync(fd, chunk);       // 70 MB with no newline in it: one enormous line
  fs.writeSync(fd, '\n' + JSON.stringify(user(projA, 12, 'NEWEST-WORDS')) + '\n');
  fs.closeSync(fd);
  const before = process.memoryUsage().rss;
  const s = await sessions.readSession(f, { sinceMs: 0 });
  assert.ok(process.memoryUsage().rss - before < 120 * 1024 * 1024, 'memory stayed bounded');
  const text = sessions.render(s);
  assert.match(text, /NEWEST-WORDS/, 'the newest part is read');
  assert.ok(!text.includes('OLD-START-WORDS'), 'the old start of a file over the limit is not');
  assert.equal(s.cut, true);
  fs.rmSync(f);
});
