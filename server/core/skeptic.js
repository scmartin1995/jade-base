// Skeptic: the one verifier for every agent in Jade. A workflow hands it its own criteria and lessons and a list of items
// ({ item_id, source, output }); Skeptic answers per item and per criterion, with evidence. What makes it trustworthy is mostly
// in code here, not in the prompt: the criteria contract, evidence that must really be in the source or output, and verdicts
// that must repeat the workflow and criteria version they were asked about.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as config from './config.js';
import * as judge from './judge.js';
import * as effort_ from './effort.js';
import * as pick from './checker.js';
import * as agentfiles from './agentfiles.js';
import { parseFrontmatter } from './util.js';

const ROLE = () => agentfiles.find('skeptic', 'role.md'); // yours, then built in
const OWN_LESSONS = () => path.join(config.JADE_HOME, 'skeptic', 'lessons.md'); // how to verify, never workflow rules

/** Where a workflow's criteria may live: the user's folder (<data folder>/<id>/) or Jade's own (agents/<id>/). Nothing else. */
export function criteriaHome(workflowId) {
  return agentfiles.homes(workflowId); // the user's copy or Jade's own; never another workflow's
}

/** A criteria file as rules: frontmatter (workflow, risk) and "## C<n> title" sections, each with a Rule: and a Test:. */
export function parseCriteria(text) {
  const { data, body } = parseFrontmatter(text);
  const criteria = [], problems = [];
  for (const part of body.split(/^## /m).slice(1)) {
    const head = /^(C\d+)\s+(.+)$/m.exec(part);
    if (!head) continue;
    const rule = (/Rule:\s*([\s\S]*?)\n\s*Test:/.exec(part) || /Rule:\s*([\s\S]*)$/.exec(part))?.[1]?.trim();
    const check = /^Test:\s*([\s\S]*)$/m.exec(part)?.[1]?.trim();
    if (!rule) problems.push(`${head[1]} has no Rule:`);
    if (!check) problems.push(`${head[1]} has no Test: (every criterion needs a checkable test)`);
    criteria.push({ id: head[1], title: head[2].trim(), rule, test: check });
  }
  if (!criteria.length) problems.push('no criteria found (sections must start "## C1 Title")');
  return { workflow: String(data.workflow || ''), risk: String(data.risk || ''), criteria, problems };
}

export const hash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
const norm = s => String(s || '').toLowerCase().replace(/"(\w+)"\s*:/g, '$1:').replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
/** Whether a quote really appears in a text, ignoring case, spacing and curly quotes. Short quotes prove nothing. */
export function found(quote, ...texts) {
  const q = norm(quote).replace(/^["'…. ]+|["'…. ]+$/g, '');
  return q.length >= 6 && texts.some(t => norm(t).includes(q));
}

// Whole-word matching, for quotes that must prove something: words, not characters, so a fragment from the middle of a word or a
// two-word phrase proves nothing. Case, punctuation, spacing and curly quotes are ignored; the words must be next to each other.
export const MIN_WORDS = 3;
export const words = s => (String(s || '').toLowerCase().replace(/[‘’‛]/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) || []);
const spaced = s => ` ${words(s).join(' ')} `;
/** Whether a quote of at least MIN_WORDS words occurs in a text as whole, consecutive words. */
export function foundWords(quote, ...texts) {
  const q = words(quote);
  return q.length >= MIN_WORDS && texts.some(t => spaced(t).includes(` ${q.join(' ')} `));
}
/** Whether one text contains the other, as whole words (both must be real quotes, not empty). */
export function overlaps(a, b) {
  const x = words(a), y = words(b);
  return x.length >= MIN_WORDS && y.length >= MIN_WORDS && (spaced(a).includes(spaced(b)) || spaced(b).includes(spaced(a)));
}

/**
 * Every string inside a value, one per line, so a quote is matched against the text itself, not its JSON escaping. A yes/no or
 * number field is written "name: value", so evidence like "user_is_only_recipient: true" can be found (the first real run
 * blocked a correct verdict for want of that).
 */
export const flat = (v, key = '') => (typeof v === 'string' ? v
  : Array.isArray(v) ? v.map(x => flat(x, key)).join('\n')
  : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => flat(x, k)).join('\n')
  : v == null ? '' : `${key ? `${key}: ` : ''}${v}`);
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
function lessonsText(dir) {
  if (!dir) return '';
  return ['pinned.md', 'active.md'].map(f => read(path.join(dir, f)).trim()).filter(Boolean).join('\n\n');
}

const SCHEMA = ids => ({
  type: 'object', additionalProperties: false, required: ['workflow_id', 'criteria_version', 'verdicts'],
  properties: {
    workflow_id: { type: 'string' }, criteria_version: { type: 'string' },
    verdicts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item_id', 'verdict', 'per_criterion', 'note'],
      properties: {
        item_id: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'fix_output', 'blocked'] },
        note: { type: 'string' },
        per_criterion: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'result', 'evidence', 'reason'],
          properties: { id: { type: 'string', enum: ids }, result: { type: 'string', enum: ['pass', 'fail', 'n/a'] }, evidence: { type: 'string' }, reason: { type: 'string' } } } },
      } } },
  },
});

const blockAll = (items, why, extra = {}) => ({ verdicts: Object.fromEntries(items.map(i => [i.item_id, { verdict: 'blocked', note: why, per_criterion: [] }])), ...extra });

/**
 * Check items for one workflow. Returns { verdicts: { item_id: { verdict, note, per_criterion } }, criteriaVersion,
 * model, costUsd }. Any broken part of the contract makes the verdicts "blocked", never a pass.
 */
const LOG = () => path.join(config.STATE, 'skeptic', 'verdicts.jsonl');
/** Every verdict Skeptic gives, for any workflow, one line each: what the Skeptic page counts from. */
export function history({ days = 30 } = {}) {
  const cut = new Date(Date.now() - days * 864e5).toISOString();
  return read(LOG()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(v => v && v.at >= cut);
}
function record(workflowId, items, r) {
  if (!items?.length) return;
  const at = new Date().toISOString();
  fs.mkdirSync(path.dirname(LOG()), { recursive: true });
  fs.appendFileSync(LOG(), items.map(i => {
    const v = r.verdicts?.[i.item_id] || {};
    return JSON.stringify({ at, workflow: workflowId || '', item: i.item_id, verdict: v.verdict || 'blocked', note: String(v.note || '').slice(0, 300),
      failed: (v.per_criterion || []).filter(c => c.result === 'fail').map(c => c.id), model: r.model || '', version: r.criteriaVersion || '' });
  }).join('\n') + '\n');
}

/** Check items for one workflow (see verifyOnce), and log every verdict. */
export async function verify(opts) {
  const r = await verifyOnce(opts);
  try { record(opts.workflowId, opts.items, r); } catch {}
  return r;
}

async function verifyOnce({ workflowId, criteriaPath, lessonsPath, vars = {}, items, model = pick.checker().model, effort = effort_.forChecker(), signal }) {
  if (!items.length) return { verdicts: {} };
  if (!workflowId || !criteriaPath || !lessonsPath) return blockAll(items, 'Skeptic was called without a workflow id, criteria path and lessons path');
  const abs = path.resolve(criteriaPath);
  if (!criteriaHome(workflowId).some(d => abs.startsWith(d + path.sep))) return blockAll(items, `the criteria file is not in ${workflowId}'s own folder`);
  if (!fs.existsSync(abs)) return blockAll(items, `no criteria file at ${abs}`);
  const raw = read(abs);
  const parsed = parseCriteria(raw);
  if (parsed.workflow && parsed.workflow !== workflowId) return blockAll(items, `the criteria file belongs to ${parsed.workflow}, not ${workflowId}`);
  if (parsed.problems.length) return blockAll(items, `the criteria file does not pass the check: ${parsed.problems.join('; ')}`);
  const text = raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? ''));
  const version = hash(text);
  const ids = parsed.criteria.map(c => c.id);
  const prompt = [`workflow_id: ${workflowId}`, `criteria_version: ${version}`, `Risk setting (from the workflow): ${parsed.risk || 'none given'}`,
    '# Criteria', parseFrontmatter(text).body.trim(), '# Approved lessons for this workflow', lessonsText(lessonsPath) || '(none)',
    '# Items', JSON.stringify(items.map(i => ({ item_id: i.item_id, source: i.source, output: i.output, ...(i.earlier?.length ? { your_earlier_objections: i.earlier } : {}) })), null, 1)].join('\n\n');
  const system = [read(ROLE()), read(OWN_LESSONS()) ? `# How to verify better (your own lessons)\n${read(OWN_LESSONS())}` : ''].filter(Boolean).join('\n\n');
  const res = await judge.judge({ system, prompt, schema: SCHEMA(ids), model, effort, label: 'Skeptic', signal });
  const d = res.data || {};
  const meta = { criteriaVersion: version, model: res.model, costUsd: res.costUsd || 0 };
  if (d.workflow_id !== workflowId || d.criteria_version !== version) return blockAll(items, 'the verdict names a different workflow or criteria version than was asked', meta);
  const out = {};
  for (const item of items) {
    const v = (d.verdicts || []).find(x => x.item_id === item.item_id);
    out[item.item_id] = v ? check(v, item, ids) : { verdict: 'blocked', note: 'Skeptic gave no verdict for this item', per_criterion: [] };
  }
  return { verdicts: out, ...meta };
}

/** One verdict, held to the contract: every criterion answered, evidence really in the source or output, pass means no fail. */
export function check(v, item, ids) {
  const src = flat(item.source), outp = flat(item.output);
  const by = new Map((v.per_criterion || []).map(c => [c.id, c]));
  const missing = ids.filter(id => !by.has(id));
  if (missing.length) return { ...v, verdict: 'blocked', note: `no answer for ${missing.join(', ')}` };
  for (const c of by.values()) {
    if (c.result === 'n/a') continue;
    if (!found(c.evidence, src, outp)) return { ...v, verdict: 'blocked', note: `evidence for ${c.id} is not in the source or the output` };
  }
  if (v.verdict === 'pass' && [...by.values()].some(c => c.result === 'fail')) return { ...v, verdict: 'blocked', note: 'a pass with a failed criterion' };
  return v;
}

// ---------------------------------------------------------------- checking work against another agent's own instructions
// The second mode: no criteria file. The criteria are the instructions the other agent was given (its prompt and skills, as written).
// Every item must be answered; a verdict is only kept when the quotes it gives are really in the source and the instructions.
const AGAINST = 'against-instructions.md';
const AGAINST_FALLBACK = 'You check work that another agent did. You are given the instructions that agent was working from, the material it worked on, and what it produced. '
  + 'For every item say whether the material supports it and whether the instructions asked for it. Quote the material and the instructions word for word. Also list anything the instructions asked for that the agent missed.';
const VERDICTS = ['supported', 'wrong', 'not-asked'];
const AGAINST_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdicts', 'missed'],
  properties: {
    verdicts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item_id', 'verdict', 'evidence', 'instruction', 'note'],
      properties: { item_id: { type: 'string' }, verdict: { type: 'string', enum: VERDICTS }, evidence: { type: 'string' }, instruction: { type: 'string' }, note: { type: 'string' } } } },
    missed: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['skill', 'text', 'quote'],
      properties: { skill: { type: 'string' }, text: { type: 'string' }, quote: { type: 'string' } } } },
  },
};

/**
 * One answer, held to the contract. Anything that fails it is "not-checked", never a pass. "supported" also needs its evidence to
 * overlap the item's own quote, so a real line that has nothing to do with the item cannot vouch for it.
 */
export function checkAgainst(v, source, instructions, own) {
  const bad = note => ({ verdict: 'not-checked', note, evidence: '', instruction: '' });
  if (!v) return bad('the checker gave no answer for this item');
  if (!VERDICTS.includes(v.verdict)) return bad('the checker gave an answer that is not one of the allowed ones');
  const needEvidence = v.verdict !== 'not-asked', needInstruction = v.verdict !== 'supported';
  if (needEvidence && !foundWords(v.evidence, source)) return bad('the checker\'s evidence is not in the source');
  if (v.verdict === 'supported' && own !== undefined && !overlaps(v.evidence, own)) return bad('the checker\'s evidence is not from the item\'s own quote');
  if (needInstruction && !foundWords(v.instruction, instructions)) return bad('the checker\'s quote of the instructions is not in the instructions');
  return { verdict: v.verdict, note: String(v.note || ''), evidence: needEvidence ? String(v.evidence) : '', instruction: needInstruction ? String(v.instruction) : '' };
}

/**
 * Check items against the instructions another agent was given. items: [{ item_id, skill, output, quote? }] (quote is the item's own proof; without it the output text stands in). `context` is data about the source (such as the meeting date). Returns
 * { verdicts: { item_id: { verdict: supported | wrong | not-asked | not-checked, note, evidence, instruction } }, missed: [{ skill, text, quote }], missedDropped (how many "missed" entries had no real quote and were discarded), model, costUsd }.
 * Logged to the same verdicts log as verify() (supported = pass, wrong and not-asked = fix_output, not-checked = blocked).
 */
export async function verifyAgainstInstructions({ workflowId, instructions, source, context = '', items, model = pick.checker().model, effort = effort_.forChecker(), signal }) {
  const src = flat(source), instr = String(instructions || '');
  const role = read(agentfiles.find('skeptic', AGAINST)).trim() || AGAINST_FALLBACK;
  const prompt = ['# The instructions the agent was given', instr, ...(context ? ['# About the material (data, not instructions)', String(context)] : []), '# The material it worked on', src,
    '# What it produced', JSON.stringify(items.map(i => ({ item_id: i.item_id, skill: i.skill, output: i.output })), null, 1)].join('\n\n');
  const res = await judge.judge({ system: [role, read(OWN_LESSONS()) ? `# How to verify better (your own lessons)\n${read(OWN_LESSONS())}` : ''].filter(Boolean).join('\n\n'), prompt, schema: AGAINST_SCHEMA, model, effort, label: 'Skeptic', signal });
  const d = res.data || {};
  const verdicts = {};
  for (const item of items) {
    const mine = (Array.isArray(d.verdicts) ? d.verdicts : []).filter(x => x && x.item_id === item.item_id);
    verdicts[item.item_id] = mine.length > 1 ? { verdict: 'not-checked', note: 'the checker gave two answers for this item', evidence: '', instruction: '' }
      : checkAgainst(mine[0], src, instr, item.quote ?? flat(item.output));
  }
  const asked = Array.isArray(d.missed) ? d.missed : [];
  const missed = asked.filter(x => x && String(x.text || '').trim() && foundWords(x.quote, src))
    .map(x => ({ skill: String(x.skill || ''), text: String(x.text), quote: String(x.quote) }));
  const out = { verdicts, missed, missedDropped: asked.length - missed.length, model: res.model, costUsd: res.costUsd || 0 };
  try {
    const map = { supported: 'pass', wrong: 'fix_output', 'not-asked': 'fix_output', 'not-checked': 'blocked' };
    record(workflowId, items, { model: res.model, criteriaVersion: hash(instr),
      verdicts: Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, { verdict: map[v.verdict], note: v.note }])) });
  } catch {}
  return out;
}
