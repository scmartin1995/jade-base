// Warm chat workers: one long-lived Claude Code process per conversation, fed turn by turn over stdin.
// A fresh process costs ~2 s of start-up (plus connector loading) on every message; a warm one answers a follow-up in
// about a third of the time and keeps the conversation natively. Workers die after a few idle minutes, when their
// settings change (connectors, model, folders, system prompt), or when the server stops.
import * as config from './config.js';
import * as engines from './engines.js';

// A reply may take as long as it needs while it is working (writing, or calling tools). Only one that has gone STUCK_MS with no
// sign of life at all is stopped, and the chat says so; the old flat 6-minute limit cut long builds off part way.
const IDLE_MS = 5 * 60e3, MAX_WORKERS = 3, STUCK_MS = 15 * 60e3;
export class StuckError extends Error { constructor() { super(`No sign of progress for ${STUCK_MS / 60e3} minutes`); this.stuck = true; } }
const workers = new Map();   // thread id -> Worker

class Worker {
  constructor(thread, settings) {
    this.thread = thread;
    this.key = settings.key;
    this.turns = 0;
    this.sent = new Map(); // context section name -> what this worker was last given, so an unchanged one is not sent again
    this.busy = false;
    this.dead = false;
    this.lastUsed = Date.now();
    const d = engines.detect();
    this.args = engines.claudeArgs({ ...settings, stream: true });
    this.child = engines.spawnCli(d.claude.bin, this.args, { cwd: config.JADE_HOME, stdio: ['pipe', 'pipe', 'pipe'] });
    this.buf = ''; this.err = ''; this.current = null;
    this.child.stdout.on('data', chunk => this.onData(chunk));
    this.child.stderr.on('data', c => { this.err = (this.err + c).slice(-4000); });
    this.child.on('error', e => this.fail(e.message));
    this.child.on('close', code => this.fail(engines.cleanErr(this.err) || `claude exited with ${code}`));
    this.touch();
  }
  // the idle timer never stops a worker mid-reply: a long answer can take longer than the idle time
  touch() { this.lastUsed = Date.now(); clearTimeout(this.idle); this.idle = setTimeout(() => { if (this.busy) this.touch(); else this.kill(); }, IDLE_MS); }
  /** Resolves once the current reply (if any) has finished, or after ms at most. */
  idleNow(ms) {
    if (!this.busy || this.dead) return Promise.resolve();
    return new Promise(resolve => { const t = setTimeout(resolve, ms); (this.waiters ||= []).push(() => { clearTimeout(t); resolve(); }); });
  }
  onData(chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim(); this.buf = this.buf.slice(nl + 1);
      const cur = this.current;
      if (!cur) continue;
      if (line) cur.alive(); // any line from the engine is a sign of life: thinking and tool results as well as text
      const r = engines.parseClaudeLine(line, cur.st, cur);
      if (r) {
        const final = typeof r.result === 'string' ? r.result : null;
        if (r.is_error && !cur.st.text) cur.reject(new Error(final || r.subtype || 'error'));
        else cur.resolve({ text: final ?? cur.st.text, engine: 'claude', model: cur.st.model || cur.model || '' });
      }
    }
  }
  fail(msg) {
    if (this.dead) return;
    this.dead = true;
    clearTimeout(this.idle);
    this.args.cleanup?.();
    if (workers.get(this.thread) === this) workers.delete(this.thread);
    this.current?.reject(msg instanceof Error ? msg : new Error(msg));
    this.wake();
  }
  wake() { for (const f of (this.waiters || []).splice(0)) f(); }
  kill(why = 'Worker stopped') { try { this.child.kill(); } catch {} this.fail(why); }
  turn({ prompt, model, onText = () => {}, onTool = () => {}, onAgent = () => {}, signal }) {
    if (this.busy) return Promise.reject(new Error('This conversation is already answering'));
    this.busy = true; this.turns++; this.touch();
    return new Promise((resolve, reject) => {
      const st = { text: '', streamed: false, model: '' };
      let timer;
      const alive = () => { clearTimeout(timer); timer = setTimeout(() => this.kill(new StuckError()), STUCK_MS); }; // any progress resets it
      const done = fn => v => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); this.current = null; this.busy = false; this.touch(); fn(v); this.wake(); };
      const onAbort = () => { this.kill(); };
      alive();
      signal?.addEventListener('abort', onAbort);
      this.current = { st, model, onText: d => { alive(); onText(d); }, onTool: (n, x, o) => { alive(); onTool(n, x, o); }, onAgent: e => { alive(); onAgent(e); }, alive, resolve: done(resolve), reject: done(reject) };
      try { this.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n'); }
      catch (e) { this.fail(e.message); }
    });
  }
}

const settingsKey = s => JSON.stringify([[...s.connectors].sort(), s.model || '', s.effort || '', !!s.edits, [...s.dirs].sort(), s.system || '', s.subagents || '']);

/** Is there a warm worker for this conversation that can take these settings? (Decides whether to resend history.) */
export function has(thread, settings) {
  const w = workers.get(thread);
  return !!w && !w.dead && w.key === settingsKey(settings);
}

/**
 * Send one turn to the conversation's worker, starting (or restarting) it as needed.
 * settings: { connectors, dirs, model, system }  turn: { prompt, onText, onTool, signal }
 */
export async function turn(thread, settings, t) {
  const key = settingsKey(settings);
  let w = workers.get(thread);
  // A worker still answering the previous message is never killed for the next one: that killed both replies ("Worker
  // stopped" a second after sending). The new message waits for it to finish, then goes to the same worker if it fits.
  if (w && w.busy && !w.dead) await w.idleNow(STUCK_MS);
  w = workers.get(thread);
  if (w && (w.dead || w.key !== key)) { w.kill(); w = null; }
  if (!w) {
    // room for one more: evict the longest-idle worker that is not in the middle of a reply
    if (workers.size >= MAX_WORKERS) [...workers.values()].filter(x => !x.busy).sort((a, b) => a.lastUsed - b.lastUsed)[0]?.kill();
    w = new Worker(thread, { ...settings, key });
    workers.set(thread, w);
  }
  // what the worker was given counts only once the turn is under way; a worker that died on the way is a fresh one next time
  t.accepted?.();
  return w.turn({ ...t, model: settings.model }).then(r => ({ ...r, warm: w.turns > 1 }));
}

/**
 * The prompt for a turn on a warm worker: only the context sections that changed since this worker last saw them, then the
 * skills and the turn itself. The first turn of a worker (or any cold run) gets everything. A section is compared without the
 * clock line, which changes every minute.
 */
const sameness = s => s.replace(/^Now: .*$/m, '');
export function contextFor(thread, settings, { sections = [], skillBlock = '', turn = '' }) {
  const w = workers.get(thread);
  const warmOk = !!w && !w.dead && w.key === settingsKey(settings);
  const send = [], kept = [];
  for (const s of sections) {
    const name = /^## ([^\n]+)/.exec(s)?.[1] || s.slice(0, 40);
    if (warmOk && w.sent.get(name) === sameness(s)) { kept.push(name); continue; }
    send.push(s);
  }
  const note = kept.length ? `(Unchanged since earlier in this conversation, so not repeated: ${kept.join(', ')}.)` : '';
  return { prompt: ['# Context', note, send.join('\n\n'), skillBlock, turn].filter(Boolean).join('\n\n'), kept,
    remember: () => { const v = workers.get(thread); if (v && !v.dead && v.key === settingsKey(settings)) for (const s of sections) v.sent.set(/^## ([^\n]+)/.exec(s)?.[1] || s.slice(0, 40), sameness(s)); } };
}

export function forget(thread) { workers.get(thread)?.kill(); }
export function stats() { return [...workers.values()].map(w => ({ thread: w.thread, turns: w.turns, busy: w.busy, idleFor: Date.now() - w.lastUsed })); }
export function shutdown() { for (const w of [...workers.values()]) w.kill(); }
process.on('exit', shutdown);
// Handling a signal replaces Node's default exit, so exit explicitly once the workers are gone.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { shutdown(); process.exit(0); });
