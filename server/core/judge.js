// A locked-down Claude Code run for judging, used by Skeptic: no tools, no connectors, none of the user's settings,
// hooks, skills or CLAUDE.md (--setting-sources ''), no session kept, and an answer forced into a JSON schema. What the model
// sees is only what the caller puts in the prompt. Engine routing (plan, gateway, Bedrock) still applies through the
// environment Jade gives every engine process.
import fs from 'node:fs';
import path from 'node:path';
import * as config from './config.js';
import * as engines from './engines.js';
import { id } from './util.js';

// The plan's usage limit ("You've hit your 5-hour limit · resets 6:40pm (America/Denver)") is not a failure of the mail or the
// model: a scheduled agent should wait until the reset, not count it as an error. The reset time is read as this computer's
// local time; with no time in the message, an hour.
const LIMIT = /(hit|reached) your [\w\s-]*limit|usage limit|rate limit/i;
export class LimitError extends Error { constructor(message, until) { super(message); this.limit = true; this.until = until; } }
export function limitUntil(text, now = new Date()) {
  if (!LIMIT.test(String(text || ''))) return null;
  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!m) return new Date(now.getTime() + 60 * 60e3);
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  const d = new Date(now); d.setHours(h, Number(m[2] || 0) + 1, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}
/** An engine error as a LimitError when it is the usage limit, else as it was. */
export function asLimit(err) {
  const until = limitUntil(err?.message);
  return until && !err.limit ? new LimitError(err.message, until) : err;
}

let runner = null;
/** Tests replace the engine with a function ({ system, prompt, schema, model, effort, label }) -> { data, model }. */
export function use(fn) { runner = fn; }

export async function judge({ system, prompt, schema, model = '', effort = '', label = '', signal, timeout = 6 * 60e3 }) {
  if (runner) return runner({ system, prompt, schema, model, effort, label });
  const d = engines.detect();
  if (!d.claude?.bin) throw new Error('Claude Code is not installed');
  const dir = path.join(config.STATE, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const sysFile = path.join(dir, `judge-${id()}.md`);
  fs.writeFileSync(sysFile, system);
  const args = ['-p', '--output-format', 'json', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', engines.emptyMcpFile(),
    '--no-session-persistence', '--system-prompt-file', sysFile, '--json-schema', JSON.stringify(schema)];
  const m = engines.engineModel(model);
  if (m) args.push('--model', m);
  args.push(...engines.effortArgs(effort, m));   // '' sends nothing: the model's own default
  const started = Date.now();
  try {
    const out = await new Promise((resolve, reject) => {
      const child = engines.spawnCli(d.claude.bin, args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
      const t = setTimeout(() => child.kill(), timeout);
      signal?.addEventListener('abort', () => child.kill());
      let so = '', se = '';
      child.stdout.on('data', c => { so += c; });
      child.stderr.on('data', c => { se += c; });
      child.on('error', e => { clearTimeout(t); reject(e); });
      child.on('close', code => {
        clearTimeout(t);
        if (signal?.aborted) return reject(new Error('Cancelled'));
        if (!so.trim()) return reject(new Error(engines.cleanErr(se) || `claude exited with ${code}`));
        resolve(so);
      });
      child.stdin.end(prompt);
    });
    let j;
    try { j = JSON.parse(out.trim().split('\n').pop()); } catch { throw new Error(`${label || 'judge'}: the engine answered with something unreadable`); }
    if (j.is_error) throw new Error(`${label || 'judge'}: ${String(j.result || j.subtype || 'engine error').slice(0, 300)}`);
    const data = j.structured_output ?? (() => { try { return JSON.parse(j.result); } catch { return null; } })();
    if (!data) throw new Error(`${label || 'judge'}: no structured answer`);
    // the model that actually answered, so "Skeptic runs on a different model" can be seen to be true
    return { data, model: Object.keys(j.modelUsage || {})[0] || m || model, costUsd: j.total_cost_usd || 0, ms: Date.now() - started };
  } catch (e) { throw asLimit(e); } finally { fs.rmSync(sysFile, { force: true }); }
}
