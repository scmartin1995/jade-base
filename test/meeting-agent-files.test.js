// The Transcript agent's files and the sample meetings: they exist, parse, follow the meeting contract, and every quote in the
// expected answers really occurs in its transcript. No model is run here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../server/core/util.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => fs.readFileSync(path.join(root, p), 'utf8');
const SHIPPED = ['key-points', 'action-items', 'risks-issues'];
// every skill on the agent's skills: line: the three shipped ones, and any the developer adds (docs/EXTENDING.md)
const SKILLS = (() => { const l = parseFrontmatter(fs.readFileSync(path.join(root, 'agents/transcript.md'), 'utf8')).data.skills; return Array.isArray(l) ? l : String(l).split(',').map(x => x.trim()); })();
const fixtures = path.join(root, 'test/fixtures/meetings');
const norm = s => s.replace(/\s+/g, ' ');

test('agent file has the contract front matter', () => {
  const { data, body } = parseFrontmatter(rd('agents/transcript.md'));
  assert.equal(data.name, 'jade-transcript');
  assert.ok(data.description);
  assert.ok(!('tools' in data), 'an empty tools line has no documented meaning in Claude Code, so the key is left out');
  assert.match(body, /needs no tools/);
  for (const k of SHIPPED) assert.ok(data.skills.includes(k), `the shipped skill ${k} stays on the skills line`);
  for (const k of data.skills) assert.ok(fs.existsSync(path.join(root, 'agents/transcript/skills', k, 'SKILL.md')), `${k} has a folder with a SKILL.md`);
  assert.equal(data['jade-loop'], 'meeting');
  assert.equal(data['jade-checked'], true);
  assert.ok(data['jade-icon']);
  assert.ok(body.trim().length > 500);
  assert.ok(!('model' in data));
});

test('each skill has a SKILL.md and a schema that fits the contract', () => {
  for (const s of SKILLS) {
    const dir = `agents/transcript/skills/${s}`;
    const { data, body } = parseFrontmatter(rd(`${dir}/SKILL.md`));
    assert.equal(data.name, s);
    assert.ok(data.description && body.trim().length > 300, s);
    const schema = JSON.parse(rd(`${dir}/schema.json`));
    assert.equal(schema.type, 'object');
    assert.deepEqual(schema.required, ['items']);
    const items = schema.properties.items;
    assert.equal(items.type, 'array');
    assert.equal(items.items.type, 'object');
    assert.ok(items.items.required.includes('quote'));
    assert.equal(items.items.properties.quote.type, 'string');
    for (const f of items.items.required) assert.ok(items.items.properties[f], `${s}.${f}`);
    assert.ok(!/oneOf|anyOf|\$ref/.test(JSON.stringify(schema)), `${s} keeps to simple schema words`);
    const x = schema['x-jade'];
    assert.ok(x.heading);
    assert.equal(x.quoteField, 'quote');
    assert.ok(['record', 'actions'].includes(x.saveTo));
    assert.ok(Array.isArray(x.show) && x.show.length);
    for (const f of x.show) assert.ok(items.items.properties[f], `${s} shows ${f}`);
    for (const f of x.longText || []) assert.ok(items.items.properties[f], `${s} longText ${f}`);
    if (x.saveTo === 'actions') {
      for (const k of ['text', 'owner', 'due']) assert.ok(items.items.properties[x.map?.[k]], `${s} maps ${k}`);
      assert.ok(items.items.properties[x.map.dueWords], `${s} maps the words of the deadline`);
      assert.notEqual(x.map.due, x.map.dueWords);
    }
  }
  assert.equal(JSON.parse(rd('agents/transcript/skills/action-items/schema.json'))['x-jade'].saveTo, 'actions');
  assert.equal(JSON.parse(rd('agents/transcript/skills/key-points/schema.json'))['x-jade'].saveTo, 'record');
  assert.equal(JSON.parse(rd('agents/transcript/skills/risks-issues/schema.json'))['x-jade'].saveTo, 'record');
});

test('the checking role text exists and the superseded skill is gone', () => {
  const t = rd('agents/skeptic/against-instructions.md');
  for (const w of ['supported', 'wrong', 'not-asked']) assert.ok(t.includes(w), w);
  assert.ok(!fs.existsSync(path.join(root, 'skills/meeting-to-actions')));
});

test('sample meetings: four formats, sizes, and every expected quote is in its transcript', () => {
  const expecteds = fs.readdirSync(fixtures).filter(f => f.endsWith('.expected.json'));
  assert.equal(expecteds.length, 4);
  const exts = new Set();
  let noActions = 0;
  for (const e of expecteds) {
    const ex = JSON.parse(fs.readFileSync(path.join(fixtures, e), 'utf8'));
    const raw = fs.readFileSync(path.join(fixtures, ex.file), 'utf8');
    const lines = raw.split('\n').length;
    assert.ok(lines >= 60 && lines <= 150, `${ex.file} has ${lines} lines`);
    exts.add(path.extname(ex.file));
    const text = norm(raw);
    const all = [...ex.keyPoints, ...ex.actions, ...ex.risks, ...ex.traps];
    assert.ok(ex.keyPoints.length && ex.traps.length, e);
    for (const it of all) assert.ok(text.includes(norm(it.quote)), `${ex.file}: quote not found: ${it.quote}`);
    for (const a of ex.actions) assert.ok('owner' in a && 'due' in a && a.text, e);
    if (ex.file.startsWith('warehouse')) for (const a of ex.actions) assert.ok(!/Priya/.test(a.text.replace(/^Send the training agency.*/, '')), `no names in an action's text: ${a.text}`);
    for (const r of ex.risks) assert.ok(['risk', 'issue'].includes(r.kind), e);
    if (!ex.actions.length) noActions++;
  }
  assert.deepEqual([...exts].sort(), ['.md', '.txt', '.vtt']);
  assert.equal(noActions, 1);
});

test('the prompts say what they must (speakers, quotes, dates, the checker)', () => {
  const act = rd('agents/transcript/skills/action-items/SKILL.md'), key = rd('agents/transcript/skills/key-points/SKILL.md'), risk = rd('agents/transcript/skills/risks-issues/SKILL.md');
  assert.match(act, /phone number or "Unknown", leave owner empty/);
  assert.match(risk, /phone number or "Unknown"/);
  assert.doesNotMatch(act, /did not object|and did not refuse/);
  assert.doesNotMatch(key, /between 2 and 8|2 to 8/);
  for (const t of [act, key, risk]) assert.match(t, /one turn, without the speaker label/);
  assert.match(act, /due_date/); assert.match(act, /Meeting date/);
  assert.match(risk, /issue if the work is already waiting/);
  assert.match(risk, /consequence/);
  const agent = rd('agents/transcript.md');
  assert.match(agent, /one speaker's words from one turn/);
  const chk = rd('agents/skeptic/against-instructions.md');
  assert.doesNotMatch(chk, /Assume each item has a mistake|When unsure, choose "wrong"|the sentence that does not cover it/);
  assert.match(chk, /nearest sentence/);
  assert.match(chk, /sent back/);
});

test('no model name appears in any agent file', () => {
  const files = [];
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : files.push(path.join(d, f.name)); };
  walk(path.join(root, 'agents/transcript')); files.push(path.join(root, 'agents/transcript.md'), path.join(root, 'agents/skeptic/against-instructions.md'));
  assert.ok(files.length >= 8);
  for (const f of files) assert.ok(!/sonnet|haiku|opus|claude-\d|anthropic\./i.test(fs.readFileSync(f, 'utf8')), f);
});

test('the wording that the real runs showed was missing is in the skills and in the checker\'s rules', () => {
  const act = rd('agents/transcript/skills/action-items/SKILL.md');
  assert.match(act, /hedged and has no date/, 'a hedged promise with no date is not an action');
  assert.match(act, /a condition \("once the budget is confirmed"/, 'a condition is not a due');
  assert.match(rd('agents/transcript/skills/risks-issues/SKILL.md'), /"issue" when the thing is wrong now, or when something that is needed is not done yet/);
  assert.match(rd('agents/transcript/skills/key-points/SKILL.md'), /did the group decide, agree or change something/);
  assert.match(rd('agents/skeptic/against-instructions.md'), /A label the instructions define .* is checked against those definitions/);
});
