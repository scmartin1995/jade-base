// What was said in Claude Code this week, as a compact digest, for Dreams. Claude Code keeps each conversation as a .jsonl file in
// <claude home>/projects/<folder name>/, where the folder name is the working directory with every non-letter, non-digit turned into
// "-" (claudesetup.js finds them the same way and reads no text; this file does, so it is only used for Dreams and only when the PM's
// setting dreams.claude allows it).
//
// A line is JSON with a "type". The ones used here:
//   user       message.content is a string (what the PM typed) or a list of blocks: "text" (typed or pasted) and "tool_result" (a
//              tool's output; never read). isMeta, isSidechain and a few wrapper tags (<system-reminder>, <command-name>,
//              <local-command-stdout>, <task-notification>) mean it was not typed by the PM.
//   assistant  one content block per line: "text" (the reply), "tool_use" (name and input), "thinking" (never read). isApiErrorMessage
//              marks an error shown as a reply.
//   system     subtype "api_error" is a failed request.
//   every line also carries cwd, sessionId, timestamp, isSidechain and entrypoint ("cli" typed in a terminal, "sdk-cli" a headless
//   `claude -p` run, "sdk-ts" a program using the SDK). Anything else (snapshots, cost lines, queue entries) is ignored.
// From a tool use only its name and the file path it was given are kept. Never tool output, never file contents, never thinking.
// Files are read line by line, never whole; a line that is not JSON, or has a shape not known here, is skipped.
import fs from 'node:fs';
import path from 'node:path';
import * as claudehome from './claudehome.js';
import { expand } from './util.js';
import { redact } from './redact.js';

const stat = f => { try { return fs.statSync(f); } catch { return null; } };
/** The name Claude Code gives a folder's conversation folder: its path with every non-letter, non-digit turned into "-". */
export const sessionDirName = folder => path.resolve(folder).replace(/[^A-Za-z0-9]/g, '-');

/** The working folder a session file says it was run in. Reads only its first 8 KB and looks only for the "cwd" field. */
export function cwdOf(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const m = /"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(buf.toString('utf8', 0, n));
    return m ? JSON.parse(m[1]) : null;
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

/** { count, newest } for a folder's Claude Code sessions (how many, when the last one ended), or null when none are found. No text is read. */
export function sessionSummary(folder) {
  const dir = path.join(claudehome.home(), 'projects', sessionDirName(folder));
  let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.jsonl')); } catch { return null; }
  const list = entries.map(e => ({ file: path.join(dir, e.name), mtime: stat(path.join(dir, e.name))?.mtimeMs || 0 }));
  if (!list.length) return null;
  list.sort((a, b) => b.mtime - a.mtime);
  const seen = list.slice(0, 3).map(x => cwdOf(x.file)).find(c => c);
  if (!seen || norm(seen) !== norm(folder)) return null;   // another folder whose path happens to spell the same
  return { count: list.length, newest: new Date(list[0].mtime).toISOString() };
}

export const SCOPES = ['projects', 'all', 'off'];
const MSG_USER = 500, MSG_CLAUDE = 300, MAX_LINE = 4 * 1024 * 1024, MAX_FILE = 64 * 1024 * 1024, MAX_FILES = 40;
const NOT_TYPED = /^\s*<(system-reminder|command-name|command-message|command-args|local-command-|task-notification|user-prompt-submit-hook)/i;
const REMINDERS = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
// what an IDE puts into a typed message: the selected lines and the open file are file text, not words the person typed
const IDE_BLOCKS = /<ide_(selection|opened_file|diagnostics)>[\s\S]*?(?:<\/ide_\1>|$)/gi;
const COMPACTED = /^\s*(This session is being continued from a previous conversation|The conversation is summarized below|<summary>)/i;

/** The lines of a file as strings, newest-first not needed: from `start`, never holding more than `maxLine` characters of one line (a longer line is dropped whole). */
async function* lines(file, { start = 0, maxLine = MAX_LINE } = {}) {
  let buf = Buffer.alloc(0), skipping = start > 0;   // starting mid-file: the first, partial line is dropped
  for await (const chunk of fs.createReadStream(file, { start })) {
    let from = 0;
    for (let nl; (nl = chunk.indexOf(10, from)) >= 0; from = nl + 1) {
      const part = chunk.subarray(from, nl);
      if (skipping) { skipping = false; buf = Buffer.alloc(0); continue; }
      if (buf.length + part.length <= maxLine) yield Buffer.concat([buf, part]).toString('utf8').replace(/\r$/, '');
      buf = Buffer.alloc(0);
    }
    const rest = chunk.subarray(from);
    if (skipping) continue;
    if (buf.length + rest.length > maxLine) { buf = Buffer.alloc(0); skipping = true; }   // too long: dropped up to its newline
    else buf = Buffer.concat([buf, rest]);
  }
  if (!skipping && buf.length) yield buf.toString('utf8');
}
const PATH_KEYS = ['file_path', 'notebook_path', 'path'];
const day = t => String(t || '').slice(0, 10);
const clip = (s, n) => { s = redact(String(s).replace(/\s+/g, ' ').trim()); return s.length > n ? s.slice(0, n) + '…' : s; };
const norm = p => path.resolve(String(p)).replace(/[\\/]+$/, '');

/** Is `cwd` the folder, or inside it? */
export const inside = (cwd, folder) => {
  const a = norm(cwd), b = norm(folder);
  return a === b || a.startsWith(b + path.sep);
};

/** Whether a session folder name could belong to a project folder (the folder itself or one below it). The cwd inside the file decides. */
export const dirMayMatch = (dirName, folder) => { const n = sessionDirName(folder); return dirName === n || dirName.startsWith(n + '-'); };

/**
 * Read one session file into a digest, or null when it is not wanted. Options: sinceMs (only lines from then on), accept(cwd)
 * (false: skip the session), maxChars (the digest's size; past it, text is dropped and the digest says so).
 */
export async function readSession(file, { sinceMs = 0, accept = () => true, maxChars = 6000 } = {}) {
  const st = fs.statSync(file);
  const out = { file, id: path.basename(file, '.jsonl'), cwd: '', date: '', lastDate: '', entrypoint: '', messages: 0, tools: {}, files: [], error: false, cut: false, lines: [] };
  let used = 0, dropped = 0, wanted = null, firstTyped = true;
  const files = new Set();
  const add = (line, essential) => {
    if (used + line.length > maxChars && !essential) { dropped++; out.cut = true; return; }
    used += line.length; out.lines.push(line);
  };
  const rel = f => (out.cwd && inside(f, out.cwd) ? path.relative(out.cwd, f) || '.' : f);
  // a very large file is read from its newest part (the last MAX_FILE bytes), not from the start
  const start = st.size > MAX_FILE ? st.size - MAX_FILE : 0;
  if (start) out.cut = true;
  {
    for await (const raw of lines(file, { start })) {
      if (raw[0] !== '{') continue;
      let o;
      try { o = JSON.parse(raw); } catch { continue; }       // not JSON, or half written: skipped
      if (!o || typeof o !== 'object') continue;
      if (!out.cwd && typeof o.cwd === 'string') out.cwd = o.cwd;
      if (!out.entrypoint && typeof o.entrypoint === 'string') out.entrypoint = o.entrypoint;
      if (wanted === null && out.cwd) { wanted = !!accept(out.cwd); if (!wanted) return null; }
      if (o.isSidechain) continue;                            // a sub-agent's own conversation
      const ms = Date.parse(o.timestamp);
      if (o.timestamp && ms < sinceMs) continue;
      const when = day(o.timestamp);
      const note = () => { if (when) { if (!out.date) out.date = when; out.lastDate = when; } };
      const content = o.message?.content;
      if (o.type === 'user' && !o.isMeta && o.message?.role !== 'assistant') {
        // only what was typed: a string, or the text blocks of a list (tool_result blocks are tool output and are never read)
        let text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n') : '';
        if (Array.isArray(content) && content.some(b => b?.type === 'tool_result')) {
          if (content.some(b => b?.type === 'tool_result' && b.is_error === true)) out.error = true;
        }
        text = text.replace(REMINDERS, '').replace(IDE_BLOCKS, '').trim();
        if (o.isCompactSummary || COMPACTED.test(text)) continue;   // the program's own summary of an earlier part, not words typed
        if (!text || NOT_TYPED.test(text) || /^\[Request interrupted/i.test(text) || /^Caveat:/i.test(text)) continue;
        if (firstTyped && out.entrypoint === 'sdk-cli' && /^# Context\b/.test(text)) return null;   // one of Jade's own runs, however its folder is named
        firstTyped = false;
        note(); out.messages++; out.error = false;
        add(`  ${when} You: ${clip(text, MSG_USER)}`);
      } else if (o.type === 'assistant' && Array.isArray(content)) {
        if (o.isApiErrorMessage) { note(); out.error = true; continue; }
        for (const b of content) {
          if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) { note(); out.messages++; out.error = false; add(`  ${when} Claude: ${clip(b.text, MSG_CLAUDE)}`); }
          else if (b?.type === 'tool_use' && typeof b.name === 'string') {
            note();
            out.tools[b.name] = (out.tools[b.name] || 0) + 1;
            const key = PATH_KEYS.find(k => typeof b.input?.[k] === 'string');
            if (key) files.add(clip(rel(b.input[key]), 200));            // only where it pointed, never what was in it
          }                                                   // "thinking" and anything unknown: not read
        }
      } else if (o.type === 'system' && o.subtype === 'api_error') { note(); out.error = true; }
    }
  }
  if (!out.date) return null;                                 // nothing said inside the window
  out.files = [...files];
  out.dropped = dropped;
  out.bytes = st.size;
  return out;
}

const fileList = (out, n) => (out.files.length ? `  files touched: ${out.files.slice(0, n).join(', ')}${out.files.length > n ? ` (and ${out.files.length - n} more)` : ''}` : '');
const toolList = out => { const t = Object.entries(out.tools).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} x${v}`); return t.length ? `  tools used: ${t.slice(0, 12).join(', ')}` : ''; };

/** One session as text. */
export function render(s) {
  const head = `### ${clip(s.cwd || '(unknown folder)', 200)} · ${s.date}${s.lastDate && s.lastDate !== s.date ? ' to ' + s.lastDate : ''}${s.error ? ' · ended with an error' : ''}`;
  return [head, ...s.lines, toolList(s), fileList(s, 15), s.cut ? `  [cut: ${s.dropped ? `${s.dropped} more messages` : 'the rest of a very long session'} left out to keep this short]` : ''].filter(Boolean).join('\n');
}

/**
 * The week's Claude Code sessions.
 *  scope    'projects' (only folders in `folders`, or below one), 'all' (every folder), 'off' (nothing)
 *  exclude  folders whose sessions are Jade's own headless runs and never count (the data folder)
 * Returns { scope, days, sessions: [digest], skipped: { jade, outside, old }, cutSessions, text }.
 */
export async function week({ scope = 'projects', days = 7, folders = [], exclude = [], maxCharsPerSession = 6000, maxChars = 60000, now = Date.now() } = {}) {
  const res = { scope, days, sessions: [], skipped: { jade: 0, outside: 0 }, cutSessions: 0, omitted: 0, text: '' };
  if (!SCOPES.includes(scope) || scope === 'off') return { ...res, scope: 'off' };
  const root = path.join(claudehome.home(), 'projects');
  const roots = folders.map(f => norm(expand(String(f)))).filter(Boolean);
  const sinceMs = now - Math.max(1, Number(days) || 7) * 864e5;
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return res; }
  const candidates = [];
  for (const d of dirs) {
    if (scope === 'projects' && !roots.some(f => dirMayMatch(d, f))) continue;
    let names = []; try { names = fs.readdirSync(path.join(root, d)).filter(n => n.endsWith('.jsonl')); } catch { continue; }
    for (const n of names) {
      const file = path.join(root, d, n);
      let m = 0; try { m = fs.statSync(file).mtimeMs; } catch { continue; }
      if (m >= sinceMs) candidates.push({ file, m });
    }
  }
  candidates.sort((a, b) => b.m - a.m);
  const skip = exclude.map(e => norm(expand(String(e))));
  const accept = cwd => {
    if (skip.some(e => inside(cwd, e))) { res.skipped.jade++; return false; }
    if (scope === 'projects' && !roots.some(f => inside(cwd, f))) { res.skipped.outside++; return false; }
    return true;
  };
  for (const c of candidates.slice(0, MAX_FILES * 3)) {
    // the first lines usually say which folder this is: a session in another folder is dropped without reading it
    const first = cwdOf(c.file);
    if (first && !accept(first)) continue;
    let s = null;
    try { s = await readSession(c.file, { sinceMs, accept, maxChars: maxCharsPerSession }); } catch { s = null; }
    if (s) res.sessions.push(s);
    if (res.sessions.length >= MAX_FILES) break;
  }
  res.sessions.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
  let used = 0; const shown = [];
  for (const s of res.sessions) {
    const t = render(s);
    if (used + t.length > maxChars) { res.omitted++; continue; }
    used += t.length; shown.push(t);
    if (s.cut) res.cutSessions++;
  }
  res.text = shown.join('\n\n');
  if (res.omitted) res.text += `\n\n[cut: ${res.omitted} older ${res.omitted === 1 ? 'session' : 'sessions'} left out to keep this short]`;
  return res;
}
