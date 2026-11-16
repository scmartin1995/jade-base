// The meeting workflow: a dropped transcript is read, each skill of the Transcript agent is run on it, the result is checked by code
// and by the checking agent, sent back once if needed, and written as a record once the PM has accepted what to keep. Code never
// knows what an action item or a risk is: what to extract lives in the agent's files, and the shape of each result in its schema.json.
import fs from 'node:fs';
import path from 'node:path';
import * as config from './config.js';
import * as store from './store.js';
import * as agents from './agents.js';
import * as judge from './judge.js';
import * as effort from './effort.js';
import * as pick from './checker.js';
import * as files from './files.js';
import * as memory from './memory.js';
import * as skeptic from './skeptic.js';
import { emit } from './bus.js';
import { id as newId, readJSON, writeJSON, writeText, safeName } from './util.js';
import { PARTS } from './locations.js';
import * as record from './meetingrecord.js';
import { guessTitle as titleFromName } from './transcripts.js';

export const AGENT = 'transcript';
const DEFAULTS = { accept: 'review', maxRounds: 1 };
const cfg = () => ({ ...DEFAULTS, ...(config.get().meetings || {}) });
const DIR = () => path.join(config.STATE, 'meetings');
const FILE = mid => path.join(DIR(), String(mid).replace(/[^\w-]/g, '') + '.json');
const fail = (status, message) => Object.assign(new Error(message), { status });
const nowIso = () => new Date().toISOString();
/** The statuses of a meeting that is being worked on right now (the rest: review, recorded, paused, failed). */
export const ACTIVE = ['queued', 'reading', 'extracting', 'checking', 'repairing'];

// ---------------------------------------------------------------- storage
export const get = mid => readJSON(FILE(mid), null);
export function list(project) {
  let names = [];
  try { names = fs.readdirSync(DIR()).filter(f => f.endsWith('.json')); } catch { return []; }
  return names.map(f => readJSON(path.join(DIR(), f), null)).filter(m => m && (!project || m.project === project))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
/** What the lists of meetings carry: each kind of item with its count, not the items, the steps or the checker's missed list (the single meeting has them). */
export const summary = ({ skills, missed, steps, ...m }) => ({ ...m, skills: skills.map(({ items, ...s }) => ({ ...s, count: items.length })), missedCount: (missed || []).length });
export const slim = m => ({ ...m, skills: m.skills.map(s => ({ ...s, items: s.items.map(({ evidence, ...i }) => i) })) });
function save(m) {
  m.updatedAt = nowIso();
  writeJSON(FILE(m.id), m);
  emit('data', { kind: 'meetings' });
  return m;
}
function need(mid) {
  const m = get(mid);
  if (!m) throw fail(404, 'That meeting is not there any more.');
  return m;
}

// transcripts.js is another module's file; tests hand in a small stand-in
let transcriptsMod = null;
export function use({ transcripts } = {}) { transcriptsMod = transcripts || null; }
const transcripts = async () => transcriptsMod || (transcriptsMod = await import('./transcripts.js'));

// ---------------------------------------------------------------- a small JSON Schema check (type, required, enum, items, properties)
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
export function validate(v, schema, at = 'the answer') {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.type) {
    const want = [].concat(schema.type), t = typeOf(v);
    if (!want.some(w => w === t || (w === 'number' && t === 'integer'))) return `${at} should be ${want.join(' or ')}`;
  }
  if (schema.enum && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(v))) return `${at} should be one of ${schema.enum.join(', ')}`;
  if (Array.isArray(v) && schema.items) for (let i = 0; i < v.length; i++) { const e = validate(v[i], schema.items, `${at}[${i}]`); if (e) return e; }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of schema.required || []) if (!(k in v)) return `${at} is missing "${k}"`;
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in v) { const e = validate(v[k], s, `${at}.${k}`); if (e) return e; }
    if (schema.additionalProperties === false) for (const k of Object.keys(v)) if (!(k in (schema.properties || {}))) return `${at} has "${k}", which is not allowed`;
  }
  return null;
}

// ---------------------------------------------------------------- the run
const readText = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();

/** The agent and the skills it owns, each with its schema and the x-jade notes on how to show and save it. */
function loadAgent() {
  const agent = agents.get(AGENT);
  if (!agent) throw new Error('The transcript reader is not set up, so this meeting cannot be read.');
  const skills = agents.ownedSkills(agent).map(s => {
    let schema;
    try { schema = JSON.parse(readText(path.join(s.dir, 'schema.json'))); } catch { schema = null; }
    if (!schema) throw new Error(`The "${s.name}" skill has no readable schema.json next to its SKILL.md.`);
    const { 'x-jade': x = {}, ...plain } = schema;
    return { name: s.name, body: String(s.body || ''), dir: s.dir, schema: plain,
      quoteField: x.quoteField || 'quote', longText: Array.isArray(x.longText) ? x.longText.map(String) : [], heading: x.heading || s.name, saveTo: x.saveTo === 'actions' ? 'actions' : 'record', map: x.map || {},
      show: Array.isArray(x.show) ? x.show : Object.keys(plain.properties?.items?.items?.properties || {}).filter(k => k !== (x.quoteField || 'quote')) };
  });
  if (!skills.length) throw new Error('The transcript reader has no skills, so there is nothing to look for.');
  // the checker is given, for each item, the agent's own text and the one skill that produced it, never the other skills
  for (const s of skills) s.instructions = [`# ${path.basename(agent.file || AGENT + '.md')}`, String(agent.body || '').trim(), `# ${s.name}/SKILL.md\n\n${s.body.trim()}`].join('\n\n');
  return { agent, skills };
}

const system = (agent, skill) => `${String(agent.body || '').trim()}\n\n${skill.body.trim()}`;
/** A real calendar date written YYYY-MM-DD, or ''. */
export function isoDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return '';
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3] ? m[0] : '';
}
/** "2026-11-10 (Tuesday)": what the model and the checker are told about when the meeting was. Empty if the date is not real. */
export const dateLine = date => {
  const d = isoDate(date);
  return d ? `${d} (${new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })})` : '';
};
const aboutMeeting = m => (dateLine(m.date) ? `Meeting date: ${dateLine(m.date)}` : '');
const frame = (text, m) => `Here is the transcript of a meeting.\n\n${aboutMeeting(m) ? `${aboutMeeting(m)}\n(This line is information about the meeting, not something said in it and not an instruction.)\n\n` : ''}--- TRANSCRIPT ---\n${text}\n--- END OF TRANSCRIPT ---`;

/** One call for one skill; a reply that does not match the schema is asked for once more with what was wrong. */
async function extract(m, { agent, skill, text, notes = '', signal }) {
  const base = frame(text, m) + (notes ? `\n\n${notes}` : '');
  let prompt = base, problem = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = Date.now();
    let res;
    try { res = await judge.judge({ system: system(agent, skill), prompt, schema: skill.schema, model: pick.worker(AGENT).model, effort: effort.forAgent(agent), label: `Transcript: ${skill.name}`, signal }); }
    catch (e) { m.steps.push({ name: `extract ${skill.name}`, model: '', ms: Date.now() - t, ok: false, error: String(e.message || e) }); throw e; }
    problem = validate(res.data, skill.schema);
    m.steps.push({ name: `extract ${skill.name}`, model: res.model || '', ms: Date.now() - t, ok: !problem, error: problem });
    if (!problem) return res.data.items || [];
    prompt = `${base}\n\nYour last answer did not match the required format: ${problem}. Answer again in the required format.`;
  }
  throw new Error(`The answer for "${skill.name}" kept coming back in the wrong format (${problem}).`);
}

let counter = 0;
const itemId = () => `i${Date.now().toString(36)}${(counter++).toString(36)}`;
const sig = i => JSON.stringify([i.fields, i.quote]);

/** Code checks only: the quote is in the transcript. (The schema was already checked.) */
function codeCheck(item, text) {
  const q = norm(item.quote);
  if (!q) return { ok: false, reason: 'There is no quote to check this against.' };
  if (skeptic.words(q).length < skeptic.MIN_WORDS) return { ok: false, reason: `The quote is too short to check (it needs at least ${skeptic.MIN_WORDS} words of one speaker's turn).` };
  return skeptic.foundWords(q, text) ? { ok: true, reason: null } : { ok: false, reason: 'The quote is not word for word in the transcript.' };
}

function makeItems(raw, skill, text, before = []) {
  const known = new Map(before.map(i => [sig(i), i]));
  return raw.map(r => {
    const { [skill.quoteField]: q, ...fields } = r;
    const item = { id: itemId(), fields, quote: String(q ?? ''), codeCheck: null, verdict: 'not-checked', note: '', evidence: '', instruction: '', accepted: null };
    const old = known.get(sig(item));
    if (old) return old;   // unchanged by a repair round: keeps its verdict
    item.codeCheck = codeCheck(item, text);
    if (!item.codeCheck.ok) item.note = item.codeCheck.reason;
    item.fresh = true;
    return item;
  });
}

/**
 * Ask the checking agent about the items that passed the code checks and have no verdict yet, one call per skill so that each call
 * holds only the agent's text and that skill. `always` asks even when a skill has nothing new to check (to look for missed items).
 * Returns what was missed, and records on ctx.dropped how many "missed" entries per skill had no real quote.
 */
async function agentCheck(m, ctx, which, skills, always) {
  const t = Date.now();
  const calls = skills.map(skill => ({ skill, todo: which.filter(w => w.skill === skill && w.item.fresh && w.item.codeCheck?.ok) })).filter(c => always || c.todo.length);
  const checkModel = pick.checker().model;   // one place decides: the agent's file, Settings, or one size up from the Transcript agent
  const results = await Promise.allSettled(calls.map(({ skill, todo }) => skeptic.verifyAgainstInstructions({ workflowId: AGENT, instructions: skill.instructions, source: ctx.text, context: aboutMeeting(m),
    model: checkModel, effort: effort.forChecker(), signal: ctx.signal,
    items: todo.map(({ item }) => ({ item_id: item.id, skill: skill.name, quote: item.quote, output: { ...item.fields, [skill.quoteField]: item.quote } })) })));
  const badR = results.find(r => r.status === 'rejected');
  if (badR) {
    const e = results.find(r => r.status === 'rejected' && r.reason?.limit)?.reason || badR.reason;
    m.steps.push({ name: 'check', model: '', ms: Date.now() - t, ok: false, error: String(e.message || e) });
    throw e;
  }
  m.steps.push({ name: 'check', model: results[0]?.value.model || '', ms: Date.now() - t, ok: true, error: null });
  const missed = [];
  ctx.last = calls.map(c => c.skill.name);
  calls.forEach(({ skill, todo }, k) => {
    const r = results[k].value;
    for (const { item } of todo) { const v = r.verdicts[item.id]; Object.assign(item, { verdict: v.verdict, note: v.note, evidence: v.evidence, instruction: v.instruction }); }
    ctx.dropped[skill.name] = r.missedDropped || 0;
    missed.push(...r.missed.map(x => ({ ...x, skill: skill.name })));
  });
  for (const { item } of which) delete item.fresh;
  return missed;
}

// what goes back for the one repair round: what the checker disputed, and what failed the code check (with the reason)
const disputed = i => i.verdict === 'wrong' || i.verdict === 'not-asked' || i.codeCheck?.ok === false;
const label = i => `"${i.quote}" (${Object.entries(i.fields).map(([k, v]) => `${k}: ${v}`).join('; ')})`;
const whyBack = i => (i.codeCheck?.ok === false ? `the quote could not be used: ${i.codeCheck.reason}` : i.verdict === 'wrong' ? 'not supported by the transcript' : 'not what the instructions ask for');
const droppedTotal = ctx => Object.values(ctx.dropped).reduce((n, x) => n + x, 0);

function counts(m) {
  const all = m.skills.flatMap(s => s.items);
  return { passed: all.filter(i => i.verdict === 'supported' && !i.corrected).length, corrected: all.filter(i => i.verdict === 'supported' && i.corrected).length,
    notChecked: all.filter(i => i.verdict === 'not-checked').length, ...(all.some(i => i.addedByPM) ? { added: all.filter(i => i.addedByPM).length } : {}) };
}

async function run(m, { signal, log }) {
  const status = (s, extra = {}) => { m.status = s; Object.assign(m, extra); save(m); log?.(`${s}\n`); };
  m.steps = []; m.error = null; m.pausedUntil = null; m.skills = []; m.missed = []; m.missedDropped = 0;
  status('reading');
  const t0 = Date.now();
  const read = await (await transcripts()).read(m.source.path);
  m.steps.push({ name: 'read', model: '', ms: Date.now() - t0, ok: !!read.ok, error: read.ok ? null : read.reason });
  if (!read.ok) return status('failed', { error: read.reason || 'The transcript could not be read.' });
  const text = read.text;
  m.title = m.titleEdited ? m.title : (read.title || m.title);
  m.date = m.dateEdited ? m.date : (read.date || m.date);
  if (!m.attendeesEdited && read.attendees?.length) m.attendees = read.attendees;
  const { agent, skills } = loadAgent();

  status('extracting');
  const settled = await Promise.allSettled(skills.map(skill => extract(m, { agent, skill, text, signal })));
  const bad = settled.find(s => s.status === 'rejected');
  if (bad) throw settled.find(s => s.status === 'rejected' && s.reason?.limit)?.reason || bad.reason;
  m.skills = skills.map((s, i) => ({ skill: s.name, heading: s.heading, saveTo: s.saveTo, show: s.show, map: s.map, quoteField: s.quoteField, longText: s.longText, items: makeItems(settled[i].value, s, text) }));
  const byName = new Map(skills.map(s => [s.name, s]));
  const pairs = () => m.skills.flatMap(s => s.items.map(item => ({ item, skill: byName.get(s.skill) })));
  const ctx = { text, signal, dropped: {} };

  status('checking');
  m.missed = await agentCheck(m, ctx, pairs(), skills, true);
  m.missedDropped = droppedTotal(ctx);
  m.counts = counts(m); save(m);

  for (let round = 1; round <= Math.max(0, Number(cfg().maxRounds) || 0); round++) {
    const again = m.skills.filter(s => s.items.some(disputed));
    if (!again.length) break;
    status('repairing');
    const results = await Promise.allSettled(again.map(s => {
      const skill = byName.get(s.skill);
      const notes = ['A reviewer checked your earlier answer for this skill and left these notes. Answer again.',
        ...s.items.filter(disputed).map(i => `- ${label(i)}: ${whyBack(i)}. ${i.codeCheck?.ok === false ? '' : i.note}${i.instruction ? ` Instruction: "${i.instruction}"` : ''}`),
        ...m.missed.filter(x => x.skill === s.skill).map(x => `- Missed: ${x.text} ("${x.quote}")`)].join('\n');
      return extract(m, { agent, skill, text, notes, signal });
    }));
    const badR = results.find(r => r.status === 'rejected');
    if (badR) throw results.find(r => r.status === 'rejected' && r.reason?.limit)?.reason || badR.reason;
    again.forEach((s, i) => {
      const old = s.items;
      s.items = makeItems(results[i].value, byName.get(s.skill), text, old);
      for (const it of s.items) if (it.fresh) it.corrected = true;
    });
    status('checking');
    const rechecked = skills.filter(sk => again.some(s => s.skill === sk.name));
    const extra = await agentCheck(m, ctx, pairs().filter(p => rechecked.includes(p.skill)), rechecked, false);
    const done = new Set(ctx.last);
    m.missed = [...m.missed.filter(x => !done.has(x.skill)), ...extra];
    m.missedDropped = droppedTotal(ctx);
    m.counts = counts(m); save(m);
  }
  m.counts = counts(m);
  status('review');
  if (cfg().accept === 'auto') {
    for (const s of m.skills) for (const i of s.items) i.accepted = i.codeCheck?.ok && i.verdict === 'supported' ? true : i.accepted;
    save(m);
    writeRecord(m.id);
  }
}

/** Run one meeting from the saved transcript. Never throws: the outcome is the meeting's status. */
export async function execute(mid, { signal, log } = {}) {
  const m = get(mid);
  if (!m) return { ok: false };
  try { await run(m, { signal, log }); return { ok: true }; }
  catch (e) {
    if (e?.limit) {
      pausedUntil = e.until ? new Date(e.until).getTime() : Date.now() + 36e5;
      m.status = 'paused'; m.pausedUntil = new Date(pausedUntil).toISOString(); m.error = 'The usage limit was reached. This will carry on by itself when it resets.';
      m.skills = []; m.missed = [];
      save(m); queue.unshift(mid);
      return { ok: false, paused: true };
    }
    m.status = 'failed'; m.skills = []; m.missed = [];
    m.error = signal?.aborted ? 'This run was stopped.' : plain(e);
    save(m);
    return { ok: false };
  }
}
const plain = e => String(e?.message || e || 'Something went wrong.').replace(/^Error:\s*/, '').slice(0, 300);

// ---------------------------------------------------------------- one at a time, and waiting out a usage limit
const queue = [];
let active = null, pausedUntil = 0, timer = null, waiting = [];
let launcher = mid => execute(mid);
/** How a run is started (the module makes it a job so it shows in the activity drawer). Called with the meeting id; returns a promise. */
export function setLauncher(fn) { launcher = fn || (mid => execute(mid)); }

export function enqueue(mid) {
  if (active !== mid && !queue.includes(mid)) queue.push(mid);
  setImmediate(pump);
}
async function pump() {
  if (active || !queue.length) { if (!active) settle(); return; }
  const wait = pausedUntil - Date.now();
  if (wait > 0) { clearTimeout(timer); timer = setTimeout(pump, Math.min(wait + 50, 2 ** 31 - 1)); timer.unref?.(); return; }
  active = queue.shift();
  const mid = active;
  try { await launcher(mid); }
  catch (e) { const m = get(mid); if (m && !['review', 'recorded', 'paused'].includes(m.status)) { m.status = 'failed'; m.error = plain(e); save(m); } }
  finally {
    const m = get(mid);
    if (m && ACTIVE.includes(m.status)) { m.status = 'failed'; m.error = m.error || 'This run stopped before it finished.'; save(m); }
    active = null;
    setImmediate(pump);
  }
}
function settle() { if (!active && !queue.length) { const w = waiting; waiting = []; w.forEach(f => f()); } }
/** Resolves when nothing is running and nothing is waiting to start (a run waiting out a usage limit still waits). */
export const idle = () => (!active && !queue.length ? Promise.resolve() : new Promise(r => waiting.push(r)));
/** Stop waiting for a usage limit to reset and try now. */
export function resumeNow() { pausedUntil = 0; clearTimeout(timer); setImmediate(pump); }
export const isActive = mid => active === mid;

/** On start-up: anything that was in the middle when Jade stopped goes round again; a paused one waits for its time. */
export function resume() {
  for (const m of list().reverse()) {
    if (m.status === 'paused' && m.pausedUntil) pausedUntil = Math.max(pausedUntil, new Date(m.pausedUntil).getTime());
    if (ACTIVE.includes(m.status) || m.status === 'paused') enqueue(m.id);
  }
}

// ---------------------------------------------------------------- the API's operations
/** A readable title from a file name: no extension, no date (the record carries it), no "zoom" tag, a capital first letter. The person can change it at review. */
export const guessTitle = name => titleFromName(name, { capitalise: true, fallback: 'Meeting' });

/** Make a meeting from a saved transcript (the result of transcripts.receive) and start it, unless it is a copy of one already done. */
export function create({ project, file }) {
  if (file.duplicateOf) return { id: file.duplicateOf, duplicateOf: file.duplicateOf };
  const mid = newId('m');
  const m = { id: mid, project, title: guessTitle(file.name), date: new Date().toISOString().slice(0, 10), attendees: [], source: { name: file.name, path: file.path, hash: file.hash },
    status: 'queued', error: null, pausedUntil: null, skills: [], missed: [], counts: { passed: 0, corrected: 0, notChecked: 0 }, steps: [], recordPath: null, createdAt: nowIso(), updatedAt: nowIso() };
  save(m);
  enqueue(mid);
  return { id: mid, duplicateOf: null };
}

// ---- editing: what a person may put into an item is held to the skill's own schema (text, or a list of text)
const skillOf = name => { try { return loadAgent().skills.find(s => s.name === name) || null; } catch { return null; } };
const itemSchemaOf = skill => skill?.schema?.properties?.items?.items || null;
const plainValue = v => typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'string'));
function checkFields(fields, skill) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw fail(400, 'The fields should be a set of names with text.');
  const props = itemSchemaOf(skill)?.properties;
  for (const [k, v] of Object.entries(fields)) {
    if (!plainValue(v)) throw fail(400, `"${pretty(k)}" should be text, or a list of text.`);
    if (!props) continue;
    if (k === skill.quoteField || !(k in props)) throw fail(400, `"${pretty(k)}" is not something this kind of item has.`);
    const e = validate(v, props[k], `"${pretty(k)}"`);
    if (e) throw fail(400, e);
  }
}
/** A "possibly missed" item the person adds by hand: checked against the skill's schema, marked as theirs, with no checker verdict. */
function addItem(m, add) {
  if (!add || typeof add !== 'object') throw fail(400, 'Say which kind of item to add and what it says.');
  const section = m.skills.find(s => s.skill === add.skill);
  const skill = section && skillOf(add.skill);
  if (!skill) throw fail(400, 'That kind of item is not available, so nothing was added.');
  const schema = itemSchemaOf(skill), props = schema?.properties || {};
  let given = add.fields === undefined ? {} : add.fields;
  if (add.text !== undefined) {   // the words of a "possibly missed" entry go in the skill's text field (x-jade map.text, else the first plain-text field shown)
    const target = skill.map?.text || (skill.show || []).find(k => props[k]?.type === 'string' && !props[k].enum);
    if (target && typeof add.text === 'string' && given && typeof given === 'object' && !(target in given)) given = { ...given, [target]: add.text };
  }
  checkFields(given, skill);
  const quote = add.quote == null ? '' : add.quote;
  if (typeof quote !== 'string') throw fail(400, 'The quote should be text.');
  const fields = {};
  for (const k of Object.keys(props)) {
    if (k === skill.quoteField) continue;
    if (k in given) fields[k] = given[k];
    else if (schema.required?.includes(k)) fields[k] = props[k].type === 'array' ? [] : Array.isArray(props[k].enum) && props[k].enum.length ? props[k].enum[0] : '';   // a blank to fill in on the review
  }
  const e = validate({ ...fields, [skill.quoteField]: quote }, schema, 'the new item');
  if (e) throw fail(400, e);
  if (!Object.values(fields).some(v => (Array.isArray(v) ? v.length : String(v).trim()))) throw fail(400, 'Write something for the new item first.');
  section.items.push({ id: itemId(), fields, quote, codeCheck: null, verdict: 'added-by-pm', note: 'Added by you.', evidence: '', instruction: '', accepted: true, addedByPM: true });
  if (quote) m.missed = (m.missed || []).filter(x => !(x.skill === add.skill && skeptic.words(x.quote).join(' ') === skeptic.words(quote).join(' ')));
  m.counts = counts(m);
}

export function patch(mid, body = {}) {
  const m = need(mid);
  // a run keeps its own copy of the record and saves it at every step, so an edit made now would be overwritten: wait until it is ready to review
  if (ACTIVE.includes(m.status)) throw fail(409, 'This meeting is still being read. You can change it when it is ready to review.');
  if (body.title !== undefined) { m.title = String(body.title).trim() || m.title; m.titleEdited = true; }
  if (body.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) throw fail(400, 'The date should look like 2026-11-12.');
    m.date = String(body.date); m.dateEdited = true;
  }
  if (body.attendees !== undefined) { m.attendees = [].concat(body.attendees).map(x => String(x).trim()).filter(Boolean); m.attendeesEdited = true; }
  for (const ch of body.items || []) {
    if (!ch || typeof ch !== 'object') throw fail(400, 'Each change needs to say which item it is for.');
    if (ch.add !== undefined) { addItem(m, ch.add); continue; }
    const section = m.skills.find(s => s.items.some(i => i.id === ch.id));
    const item = section?.items.find(i => i.id === ch.id);
    if (!item) continue;
    if ('accepted' in ch) item.accepted = ch.accepted === null ? null : !!ch.accepted;
    if (ch.fields !== undefined) { checkFields(ch.fields, skillOf(section.skill)); item.fields = { ...item.fields, ...ch.fields }; }
  }
  return slim(save(m));
}

// a free file name in the Meetings folder: a name already taken by anything else gets " (2)", " (3)", ...
function freeRecord(dir, base) {
  let f = path.join(dir, `${base}.md`);
  for (let n = 2; fs.existsSync(f); n++) f = path.join(dir, `${base} (${n}).md`);
  return f;
}
const isRecord = f => { try { return /^---\n[\s\S]*?\ntranscript:/.test(fs.readFileSync(f, 'utf8')); } catch { return false; } };
const pretty = k => { const s = String(k).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); return s[0].toUpperCase() + s.slice(1); };
const shown = v => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v)).replace(/\s*\n\s*/g, ' ').trim();

export { section as sectionText };
// One section of the record for the kept items: how an item reads here (the text first, a "kind" field as a label before it, the other
// fields after it); the record's own layout is meetingrecord.js.
function itemOf(s, i) {
  const keys = s.show.length ? s.show : Object.keys(i.fields);
  const textKey = keys.includes('text') ? 'text' : keys[0];
  const kindKey = keys.includes('kind') && textKey !== 'kind' ? 'kind' : null;
  const rest = keys.filter(k => k !== textKey && k !== kindKey);
  const details = rest.map(k => {
    let v = shown(i.fields[k]);
    if (k === 'due' && rest.includes('due_date')) { const d = shown(i.fields.due_date); v = v && d ? `${v}, ${d}` : v || d; }   // the words and the date are one fact
    return [k, v];
  }).filter(([k, v]) => v && !(k === 'due_date' && rest.includes('due'))).map(([k, v]) => `${pretty(k).toLowerCase()}: ${v}`);
  return { label: kindKey && shown(i.fields[kindKey]) ? pretty(shown(i.fields[kindKey])) : '', text: shown(i.fields[textKey]), details, quote: shown(i.quote) };
}
const keptItems = s => s.items.filter(i => i.accepted === true).map(i => itemOf(s, i));
function section(s) { return record.section(s.heading, keptItems(s)); }

/** Write the record from the accepted items and add accepted action items to the action list. Writing again updates the same file. */
export function writeRecord(mid) {
  const m = need(mid);
  if (!['review', 'recorded'].includes(m.status)) throw fail(409, 'This meeting is not ready to be recorded yet.');
  const dir = store.projectDir(m.project, PARTS.meetings);
  // this meeting's own record is rewritten in place; any other file in the way (another meeting's record, a file of the user's) is never replaced
  const own = m.recordPath && (!fs.existsSync(m.recordPath) || isRecord(m.recordPath));
  const file = own ? m.recordPath : freeRecord(dir, record.stem(m.date, safeName(m.title, 'Meeting')));
  const rel = path.relative(dir, m.source.path);
  const c = counts(m);
  const front = ({ date: m.date, project: store.getProject(m.project)?.name || m.project, title: m.title, attendees: m.attendees,
    transcript: rel.startsWith('..') ? m.source.path : rel.split(path.sep).join('/'), checked: `${c.passed} passed, ${c.corrected} corrected, ${c.notChecked} not checked${c.added ? `, ${c.added} added by you` : ''}` });
  writeText(file, record.format(front, m.skills.map(s => ({ heading: s.heading, items: keptItems(s) }))));
  m.recordPath = file;
  for (const s of m.skills.filter(x => x.saveTo === 'actions')) {
    const map = s.map || {};
    for (const i of s.items.filter(x => x.accepted === true && !x.actionId)) {
      let text = shown(i.fields[map.text || s.show[0]]);
      if (!text) continue;
      // the action list holds a real date (map.due names the field), only when it parses as one; the words as said (map.dueWords,
      // or the due field itself when it holds words) stay in the text when no date came with them
      const dueField = map.due ? shown(i.fields[map.due]) : '';
      const due = isoDate(dueField);
      const said = map.dueWords ? shown(i.fields[map.dueWords]) : due ? '' : dueField;
      if (said && !due) text = `${text} (${said})`;
      const a = store.addAction({ text, project: m.project, owner: map.owner ? shown(i.fields[map.owner]) : '', due, source: file });
      i.actionId = a.id;
    }
  }
  m.counts = c; m.status = 'recorded'; m.error = null;
  save(m);
  files.invalidate(file); memory.scheduleRebuild();   // the record is found by search and the file map at once, not at the next scan
  return { recordPath: file };
}
export function rerun(mid) {
  const m = need(mid);
  if (isActive(mid) || queue.includes(mid)) throw fail(409, 'This meeting is already being worked on.');
  if (!fs.existsSync(m.source.path)) throw fail(404, 'The transcript file is no longer there, so it cannot be read again.');
  Object.assign(m, { status: 'queued', error: null, pausedUntil: null, skills: [], missed: [], steps: [], counts: { passed: 0, corrected: 0, notChecked: 0 } });
  save(m);
  enqueue(mid);
  return { id: mid };
}

/** Removes the meeting from the list. The transcript and any record already written stay where they are. */
export function remove(mid) {
  need(mid);
  if (isActive(mid)) throw fail(409, 'This meeting is being read right now. Try again in a moment.');
  const qi = queue.indexOf(mid); if (qi >= 0) queue.splice(qi, 1);
  const m = get(mid);
  fs.rmSync(FILE(mid), { force: true });
  // a meeting that failed leaves nothing worth keeping: its copy of the transcript goes too (unless another meeting holds the same file)
  if (m?.status === 'failed' && m.source?.path && !list().some(x => x.source?.path === m.source.path)) fs.rmSync(m.source.path, { force: true });
  emit('data', { kind: 'meetings' });
  return { ok: true };
}
