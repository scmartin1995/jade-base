// Which models Jade can run, read from the endpoint it is on rather than a list typed into the code:
//   1. Claude Code itself (`claude -p "/model"`), which answers with what is available on the current provider:
//      the subscription, Amazon Bedrock or a gateway alike, including the aliases (sonnet, opus, haiku, fable…).
//   2. The endpoint's own list where it has one: /v1/models on Anthropic-format endpoints (a key is needed), the
//      inference-profile list on Amazon Bedrock (a Bedrock API key), and a best effort on Bedrock-style gateways.
// The result is cached in .state/models.json and refreshed by "Check" in Settings and every few hours.
import fs from 'node:fs';
import { writeText } from './util.js';
import path from 'node:path';
import * as config from './config.js';
import * as provider from './provider.js';
import * as engines from './engines.js';
import { emit } from './bus.js';

const FILE = () => path.join(config.STATE, 'models.json');
const NOT_CHAT = /embed|rerank|guard|moderation|whisper|tts|image|stable-|titan|nova-(canvas|reel|sonic)|llama|mistral|cohere|deepseek|jamba|command-/i;

export function cached() { try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { return { at: null, current: '', aliases: [], models: [], suggested: {}, notes: [] }; } }

/** `claude -p "/model"` prints the current model and the names it accepts right now. */
export async function fromClaudeCode() {
  const d = engines.detect();
  if (!d.claude.bin) return { current: '', aliases: [], error: 'Claude Code is not installed' };
  const out = await new Promise(resolve => {
    let o = '';
    const p = engines.spawnCli(d.claude.bin, ['-p', '/model', '--output-format', 'json', '--allowedTools', '', '--strict-mcp-config', '--mcp-config', engines.emptyMcpFile()], { cwd: config.JADE_HOME, stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => p.kill(), 60000);
    p.stdout.on('data', c => { o += c; }); p.stderr.on('data', c => { o += c; });
    p.on('error', e => { clearTimeout(t); resolve(o + e.message); }); p.on('close', () => { clearTimeout(t); resolve(o); });
  });
  let text = out;
  try { const ev = JSON.parse(out.split('\n').find(l => l.startsWith('{')) || '{}'); if (typeof ev.result === 'string') text = ev.result; } catch {}
  const r = parseModelText(text);
  return { ...r, error: r.aliases.length ? '' : engines.cleanErr(text) || 'no model list' };
}
/** "Current model: `Fable 5.1`\nUsage: /model <name>. Available: sonnet, opus, …, or a full model ID." -> { current, aliases } */
export function parseModelText(text) {
  const current = /Current model:\s*`?([^`\n]+?)`?\s*(\n|$)/.exec(text)?.[1]?.trim() || '';
  const avail = /Available:\s*([^\n]+)/i.exec(text)?.[1] || '';
  const aliases = avail.split(',').map(s => s.trim().replace(/\.$/, '')).filter(s => s && !/^or a full|^default$/i.test(s));
  return { current, aliases };
}

/** The endpoint's own list, when it has one. Returns { models: [ids], note }. Never throws. */
export async function fromEndpoint() {
  const e = provider.read();
  const m = provider.mode(e);
  const headers = { 'anthropic-version': '2023-06-01' };
  if (e.ANTHROPIC_AUTH_TOKEN) headers.authorization = `Bearer ${e.ANTHROPIC_AUTH_TOKEN}`;
  if (e.ANTHROPIC_API_KEY) headers['x-api-key'] = e.ANTHROPIC_API_KEY;
  if (e.AWS_BEARER_TOKEN_BEDROCK) headers.authorization = `Bearer ${e.AWS_BEARER_TOKEN_BEDROCK}`;
  const get = async (url, ms = 12000) => { const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`${r.status} from ${url}`); return r.json(); };
  const claudeOnly = ids => [...new Set(ids.filter(id => /claude|anthropic/i.test(id) && !NOT_CHAT.test(id)))].sort();
  try {
    if (m === 'subscription' && !e.ANTHROPIC_API_KEY && !e.ANTHROPIC_AUTH_TOKEN) return { models: [], note: 'A subscription has no model list to read; the names Claude Code accepts are shown.' };
    if (m === 'gateway' || m === 'subscription') {
      const base = (e.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
      const body = await get(`${base}/v1/models?limit=1000`);
      const list = Array.isArray(body) ? body : body.data || body.models || [];
      return { models: claudeOnly(list.map(x => String(x.id || x.name || ''))), note: '' };
    }
    if (m === 'bedrock') {
      const region = e.AWS_REGION || 'us-east-1';
      const body = await get(`https://bedrock.${region}.amazonaws.com/inference-profiles?maxResults=1000`, 15000);
      const ids = (body.inferenceProfileSummaries || []).map(p => String(p.inferenceProfileId || ''));
      return { models: claudeOnly(ids), note: ids.length ? '' : 'Bedrock listed no inference profiles for this key' };
    }
    // a Bedrock-style gateway: a list is not part of the format, but some gateways offer one
    const base = String(e.ANTHROPIC_BEDROCK_BASE_URL || '').replace(/\/+$/, '');
    for (const u of [`${base}/inference-profiles?type=SYSTEM_DEFINED`, `${base}/inference-profiles?maxResults=1000`, `${base}/v1/models?limit=1000`]) {
      try { const body = await get(u, 6000); const list = body.inferenceProfileSummaries || body.data || body.models || (Array.isArray(body) ? body : []); const ids = claudeOnly(list.map(x => String(x.inferenceProfileId || x.id || x.name || ''))); if (ids.length) return { models: ids, note: '' }; } catch {}
    }
    return { models: [], note: 'This gateway does not list its models. Run Diagnose, or ask whoever manages it.' };
  } catch (err) {
    return { models: [], note: `No model list from the endpoint (${String(err.message).slice(0, 120)}); the names Claude Code accepts are shown.` };
  }
}

/** Starting points from a list: a quick one, an everyday one, a strong one (newest of each family). */
export function suggest(ids) {
  const newest = re => ids.filter(id => re.test(id)).sort((a, b) => ver(b) - ver(a))[0] || '';
  return { light: newest(/haiku/i), standard: newest(/sonnet/i), strong: newest(/opus/i) };
}
const ver = id => { const m = /(\d+)[-.](\d+)/.exec(id.replace(/^.*claude-/, '')); return m ? Number(m[1]) * 100 + Number(m[2]) : 0; };

/**
 * The everyday model, found rather than typed: of the names Claude Code itself accepts (on a plan or any provider it maps
 * them), else of the endpoint's own list, the one that is the newest "sonnet"-class model, else simply the first listed.
 * '' when nothing has been discovered, so Claude Code's own default applies. Resolved at run time, never stored.
 */
export function everyday(c = cached()) {
  for (const names of [c.aliases || [], c.models || []]) if (names.length) return suggest(names).standard || names[0];
  return '';
}

let running = null;
/** Refresh the cache from both sources. Returns the new cache. */
export function discover() {
  if (running) return running;
  running = (async () => {
    const [cc, ep] = await Promise.all([fromClaudeCode().catch(e => ({ current: '', aliases: [], error: e.message })), fromEndpoint()]);
    const next = { at: new Date().toISOString(), provider: provider.describe().label, current: cc.current, aliases: cc.aliases, models: ep.models, suggested: suggest(ep.models),
      notes: [cc.error, ep.note].filter(Boolean) };
    writeText(FILE(), JSON.stringify(next));
    emit('models', next);
    return next;
  })().finally(() => { running = null; });
  return running;
}

/** What the chat picker shows: the models the endpoint itself lists (Claude Code's alias names only if it lists none). */
export function choices() {
  const c = cached();
  const seen = new Set();
  const out = [];
  for (const id of c.models || []) if (!seen.has(id)) { seen.add(id); out.push({ id, label: id.replace(/^(us|eu|apac|global)\.anthropic\./, '').replace(/^anthropic\./, ''), note: '' }); }
  // Only when the endpoint lists nothing at all do Claude Code's own names stand in, so the picker is never empty.
  if (!out.length) for (const a of c.aliases || []) if (!seen.has(a)) { seen.add(a); out.push({ id: a, label: a, note: a === c.current ? 'current' : '' }); }
  return { at: c.at, current: c.current, choices: out, notes: c.notes || [] };
}

// ------------------------------------------------------------------ what Jade may offer
// Jade only ever offers models that discovery found. On a gateway or Amazon Bedrock that is the endpoint's own list (and
// nothing at all when the endpoint listed none: no names are made up); on a plain plan it is the names Claude Code itself
// reports. Nothing here changes what reaches Claude Code: these functions only read the cache and order it.
const TIERS = [[0, 'Quick', /haiku/i], [1, 'Everyday', /sonnet/i], [2, 'Strong', /opus/i]];   // the same families suggest() looks for
const OTHER_TIER = 3;
/** 0 quick, 1 everyday, 2 strong, 3 a name that fits none of them. */
export function tierOf(id) { return (TIERS.find(([, , re]) => re.test(id)) || [OTHER_TIER])[0]; }
const tierName = t => (TIERS.find(([n]) => n === t) || [, 'Other'])[1];
const prettyId = id => id.replace(/^(us|eu|apac|global)\.anthropic\./, '').replace(/^anthropic\./, '');

/** Smallest first: by tier, then newest version first inside a tier. A name of no known tier goes last, in the order it was found. */
export function orderSmallestFirst(ids) {
  return ids.map((id, i) => ({ id, i, t: tierOf(id), v: ver(id) })).sort((a, b) => (a.t - b.t) || (b.v - a.v) || (a.i - b.i)).map(x => x.id);
}

/** The model for the automated agents (the smallest) and for the checking agent (the newest of the next tier up; the same one when there is no tier above). */
export function pickDefaults(list) {
  const agent = list[0] || null;
  const up = agent ? list.find(m => m.tier > agent.tier && m.tier < OTHER_TIER) : null;
  return { agent: agent?.id || '', checker: (up || agent)?.id || '', sameTier: !!agent && !up };
}

/**
 * The list Jade may offer anywhere a model is picked: { at, current, source, choices, notes, defaults }.
 * source: 'endpoint' (the gateway or Bedrock listed them), 'claude-code' (a plan: what Claude Code reports) or 'none'.
 */
export function offerable(c = cached(), style = provider.style()) {
  const onGateway = style === 'gateway';
  const raw = [...new Set((onGateway ? c.models : c.aliases) || [])];
  const choices = orderSmallestFirst(raw).map(id => ({ id, label: onGateway ? prettyId(id) : id, note: !onGateway && id === c.current ? 'current' : '', tier: tierOf(id), tierName: tierName(tierOf(id)) }));
  return { at: c.at, current: c.current, source: choices.length ? (onGateway ? 'endpoint' : 'claude-code') : 'none', choices, notes: c.notes || [], defaults: pickDefaults(choices) };
}

export function start() {
  setTimeout(() => discover().catch(() => {}), 20000);
  setInterval(() => discover().catch(() => {}), 6 * 3600e3);
}
