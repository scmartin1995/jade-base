// Transcript intake: save an uploaded meeting transcript (receive) and turn it into plain "Speaker: words" text (read).
// No model is involved. Formats: .vtt .srt .txt .md .docx .pdf and .json exports. Nothing is ever silently trimmed:
// a file that is too long, cut short or unreadable comes back as { ok: false, reason } in plain words.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STATE, get as cfg } from './config.js';
import { readJSON } from './util.js';
import * as store from './store.js';
import { extractDetailed } from './extract.js';

export const EXTENSIONS = new Set(['.vtt', '.srt', '.txt', '.md', '.docx', '.pdf', '.json']);
const limits = () => {
  const m = cfg().meetings || {};
  return { maxBytes: m.maxBytes > 0 ? m.maxBytes : 26214400, maxChars: m.maxChars > 0 ? m.maxChars : 400000 };
};
const fail = (status, message) => Object.assign(new Error(message), { status });

const MAX_NAME_BYTES = 255;   // what file systems allow for one name
const bytes = s => Buffer.byteLength(s);
/** The start of a text that fits in n bytes, never cutting a character in half. */
function cutBytes(text, n) {
  let out = '', used = 0;
  for (const ch of text) { const b = bytes(ch); if (used + b > n) break; out += ch; used += b; }
  return out;
}
// Windows refuses these as file names, with any extension (CON.txt too)
const DEVICE = /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/i;
/** A file name that is safe to write: no folders, no leading dots, no characters a file system refuses, no Windows device names, at most 255 bytes. */
export function safeName(name) {
  let n = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '');
  n = n.split(/[\\/]/).pop();
  n = n.replace(/[<>:"|?*]/g, '_').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (DEVICE.test(n.split('.')[0].trim())) n = '_' + n;
  const ext = path.extname(n);
  if (bytes(n) > MAX_NAME_BYTES) n = cutBytes(n.slice(0, n.length - ext.length), MAX_NAME_BYTES - bytes(ext)) + ext;
  return n;
}
function freeName(dir, name) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let out = name;
  for (let i = 2; fs.existsSync(path.join(dir, out)); i++) { const tail = ` (${i})${ext}`; out = cutBytes(base, MAX_NAME_BYTES - bytes(tail)) + tail; }
  return out;
}
/** A size in plain words: "25 MB", "1.5 MB", "300 KB", "40 bytes". */
export function sizeText(n) {
  if (n >= 1048576) { const mb = n / 1048576; return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`; }
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${n} byte${n === 1 ? '' : 's'}`;
}
const tooLong = e => (e?.code === 'ENAMETOOLONG' ? fail(400, 'That file name is too long for this computer. Rename the file to something shorter and drop it again.') : e);
function existingMeeting(project, hash) {
  const dir = path.join(STATE, 'meetings');
  let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch {}
  for (const f of files) {
    const m = readJSON(path.join(dir, f), null);
    if (m && m.project === project && m.source?.hash === hash && m.status !== 'failed') return m;
  }
  return null;
}

/** The saved copy takes the date the original file had (when the browser sends it), so "its date on disk" is the file's, not the upload's. */
function stamp(file, modified) {
  const t = Number(modified);
  if (!(t > Date.UTC(1990, 0, 1)) || t > Date.now() + 864e5) return;
  try { fs.utimesSync(file, new Date(t), new Date(t)); } catch {}
}

/** Stream the raw request body to <project>/Meetings/transcripts/<safe name>. */
export function receive(req, { project, name, res, modified } = {}) {
  const clean = safeName(name);
  const ext = path.extname(clean).toLowerCase();
  if (!clean || !EXTENSIONS.has(ext)) return Promise.reject(fail(415, 'That kind of file cannot be read. Use a .vtt, .srt, .txt, .md, .docx, .pdf or .json transcript.'));
  const { maxBytes } = limits();
  const tooBig = () => fail(413, `That file is bigger than the ${sizeText(maxBytes)} limit.`);
  const declared = +req.headers?.['content-length'];
  const dir = store.projectDir(project, 'Meetings/transcripts');
  const tmp = path.join(dir, `.upload-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
  const drop = () => { try { fs.unlinkSync(tmp); } catch {} };
  // Too big: stop saving, but keep reading (and throwing away) what the browser is still sending, so it can finish its upload and read the
  // answer ("that file is bigger than...") instead of a dropped connection. The socket is NOT destroyed once the answer has gone: closing it
  // while the browser is still writing, or right as it finishes, resets the connection and the answer is lost. Once the body has been read to
  // its end the connection is clean and ends the normal way. Only a body that never ends is cut, after a while.
  const cut = () => {
    try { req.unpipe?.(); req.resume?.(); } catch {}
    if (req.readableEnded) return;
    const timer = setTimeout(() => { try { req.socket?.destroy(); } catch {} }, 20000); timer.unref?.();
    const done = () => clearTimeout(timer);
    req.once?.('end', done); req.once?.('close', done);
  };
  return new Promise((resolve, reject) => {
    if (declared > maxBytes) { cut(); return reject(tooBig()); }
    const out = fs.createWriteStream(tmp, { flags: 'wx' });
    const hash = crypto.createHash('sha256');
    let got = 0, over = false, settled = false;
    const end = (fn, v) => { if (settled) return; settled = true; fn(v); };
    // the file may still be opening: wait until the stream has closed before removing it, or it is left behind
    const abort = e => { out.destroy(); const done = () => { drop(); end(reject, e); }; if (out.closed) done(); else out.once('close', done); };
    out.on('error', e => abort(tooLong(e)));
    req.on('error', e => { out.destroy(); abort(e); });
    req.on('aborted', () => { out.destroy(); abort(fail(400, 'The upload was cut off before it finished.')); });
    req.on('data', chunk => {
      if (over) return;
      got += chunk.length;
      if (got > maxBytes) { over = true; out.destroy(); cut(); return abort(tooBig()); }
      hash.update(chunk);
      if (!out.write(chunk)) { req.pause(); out.once('drain', () => req.resume()); }
    });
    req.on('end', () => {
      if (over) return;
      out.end(() => {
        if (settled) return;
        if (!got) return abort(fail(400, 'That file is empty.'));
        const digest = hash.digest('hex');
        const dup = existingMeeting(project, digest);
        if (dup) { drop(); return end(resolve, { path: dup.source.path, name: dup.source.name, hash: digest, bytes: got, duplicateOf: dup.id }); }
        const final = freeName(dir, clean);
        try { fs.renameSync(tmp, path.join(dir, final)); } catch (e) { return abort(tooLong(e)); }
        stamp(path.join(dir, final), modified);
        end(resolve, { path: path.join(dir, final), name: final, hash: digest, bytes: got, duplicateOf: null });
      });
    });
  });
}

// ---------- dates, titles
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const z2 = n => String(n).padStart(2, '0');
function valid(y, m, d) {
  y = +y; m = +m; d = +d;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${z2(m)}-${z2(d)}` : null;
}
const monthNo = s => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
// each: [pattern, how to read the match]. Order matters: the unambiguous ones come first.
const DATE_PATTERNS = [
  [/(?<!\d)(\d{4})[-_./](\d{1,2})[-_./](\d{1,2})(?!\d)/, m => valid(m[1], m[2], m[3])],
  [/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/, m => valid(m[1], m[2], m[3])],
  [new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?[ \\-_.,]+${MON}\\b[ \\-_.,]+(\\d{4})(?!\\d)`, 'i'), m => valid(m[3], monthNo(m[2]), m[1])],
  [new RegExp(`\\b${MON}\\b[ \\-_.]+(\\d{1,2})(?:st|nd|rd|th)?[ ,\\-_.]+(\\d{4})(?!\\d)`, 'i'), m => valid(m[3], monthNo(m[1]), m[2])],
  [/(?<!\d)(\d{1,2})[-_./](\d{1,2})[-_./](\d{4})(?!\d)/, m => +m[1] > 12 ? valid(m[3], m[2], m[1]) : +m[2] > 12 ? valid(m[3], m[1], m[2]) : null],
];
export function findDate(s) {
  let best = null;
  for (const [re, f] of DATE_PATTERNS) {
    const m = re.exec(s);
    const d = m && f(m);
    if (d && (!best || m.index < best.at)) best = { d, at: m.index, len: m[0].length };
  }
  return best;
}
/** A readable title from a file name: no extension, no date (the record carries it), no "zoom" tag. The reading shows it as it is (null when nothing is left);
 *  a meeting asks for a capital first letter and a fallback word instead (capitalise, fallback). */
export function guessTitle(file, { capitalise = false, fallback = null } = {}) {
  let b = path.basename(String(file ?? ''), path.extname(String(file ?? '')));
  b = b.replace(/\.(transcript|vtt|srt)$/i, '').replace(/GMT\d{8}-\d{6}/g, ' ');
  for (let i = 0; i < 3; i++) { const f = findDate(b); if (!f) break; b = b.slice(0, f.at) + ' ' + b.slice(f.at + f.len); }
  b = b.replace(/\b\d{6}\b/g, ' ').replace(/[_-]+/g, ' ').replace(/^\s*zoom\b/i, ' ').replace(/\s*[-–]\s*(?=\s|$)/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–.,()]+|[\s\-–.,()]+$/g, '');
  if (!b) return fallback;
  return capitalise ? b[0].toUpperCase() + b.slice(1) : b;
}
function guessDate(head, file) {
  const inText = findDate(head); if (inText) return inText.d;
  const inName = findDate(path.basename(file)); if (inName) return inName.d;
  let t; try { t = fs.statSync(file).mtime; } catch { t = new Date(); }
  return `${t.getFullYear()}-${z2(t.getMonth() + 1)}-${z2(t.getDate())}`;
}

// ---------- turning each format into "Speaker: words"
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const norm = s => s.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
// "Rosa: words", also with a bold label as Markdown writes it: "**Rosa:** words" or "**Rosa**: words"
const SPEAKER_LINE = /^(?:\*\*|__)?([\p{L}][\p{L}\p{N}'’.\-]*(?: [\p{L}\p{N}'’.()\-]+){0,4})(?:\*\*|__)?:(?:\*\*|__)?\s+(\S.*)$/u;

// Turns [{ speaker|null, text }] into lines, merging consecutive turns by the same speaker.
function merge(turns) {
  const out = [];
  for (const t of turns) {
    const text = t.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && !last.raw && !t.raw && (t.speaker ? last.speaker === t.speaker : true)) last.text += ' ' + text;
    else out.push({ speaker: t.speaker || null, text, raw: t.raw });
  }
  return out;
}
const render = turns => turns.map(t => t.speaker ? `${t.speaker}: ${t.text}` : t.text).join('\n');

function cueTurns(text) {
  const turns = [];
  for (const block of norm(text).split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex(l => l.includes('-->'));
    if (at < 0) continue;
    for (const raw of lines.slice(at + 1)) {
      const v = /^<v(?:\.[^\s>]+)?\s+([^>]+)>/i.exec(raw);
      let line = decode(raw.replace(/<\/?[^>]+>/g, '')).trim();
      if (!line) continue;
      let speaker = v ? decode(v[1]).trim() : null;
      if (!speaker) { const m = SPEAKER_LINE.exec(line); if (m) { speaker = m[1]; line = m[2]; } }
      turns.push({ speaker, text: line });
    }
  }
  return merge(turns);
}

const TIME = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d+)?|(?:\d+\s*hours?\s*)?(?:\d+\s*minutes?\s*)?\d+\s*seconds?`;
const HEAD_A = new RegExp(String.raw`^([^\d:\s][^:\d]{0,59}?)\s+\(?(${TIME})\)?$`, 'i');   // Otter: "Dana Reyes  0:03"
const HEAD_B = new RegExp(String.raw`^\(?(${TIME})\)?\s+([^\d:\s][^:\d]{0,59})$`, 'i');   // "0:03 Dana Reyes"
function plainTurns(text) {
  const lines = norm(text).split('\n').map(l => l.trim());
  const head = l => { const a = HEAD_A.exec(l); if (a) return a[1].trim(); const b = HEAD_B.exec(l); return b ? b[2].trim() : null; };
  if (lines.filter(head).length >= 2) {   // speaker, time stamp, then what was said
    const turns = []; let cur = null;
    for (const l of lines) {
      const h = l && head(l);
      if (h) cur = h; else if (l) turns.push({ speaker: cur, text: l, raw: !cur });
    }
    return merge(turns);
  }
  return null;
}

function jsonTurns(text) {
  let data; try { data = JSON.parse(text); } catch { return null; }
  const who = o => o.speaker ?? o.speaker_name ?? o.speakerName ?? o.name ?? o.user ?? o.participant ?? o.author ?? null;
  const what = o => o.text ?? o.content ?? o.words ?? o.transcript ?? o.body ?? o.message ?? null;
  const find = (v, depth = 0) => {
    if (Array.isArray(v)) {
      const ok = v.length && v.every(o => o && typeof o === 'object' && typeof what(o) === 'string');
      if (ok) return v;
      return null;
    }
    if (v && typeof v === 'object' && depth < 3) for (const k of ['segments', 'utterances', 'transcript', 'monologues', 'entries', 'items', 'results', 'messages']) { const r = find(v[k], depth + 1); if (r) return r; }
    return null;
  };
  const arr = find(data);
  if (!arr) return null;
  const turns = arr.map(o => { const s = who(o); return { speaker: typeof s === 'string' ? s.trim() : s && typeof s === 'object' ? String(s.name ?? s.id ?? '') || null : s != null ? String(s) : null, text: what(o) }; });
  return merge(turns);
}

// Words that begin a line like a name does but are headings or labels. Only a guess at who attended, and the PM can edit it, so
// when in doubt a name is left out.
const LABELS = new Set(['note', 'notes', 'agenda', 'action', 'actions', 'action items', 'date', 'time', 'when', 'where', 'location', 'present', 'attendees', 'attendee',
  'apologies', 'absent', 'subject', 'topic', 'topics', 're', 'summary', 'decision', 'decisions', 'question', 'questions', 'answer', 'todo', 'to do', 'next steps',
  'next', 'update', 'updates', 'risk', 'risks', 'issue', 'issues', 'status', 'owner', 'due', 'title', 'meeting', 'minutes', 'chair', 'objective', 'purpose',
  'important', 'reminder', 'warning', 'example', 'see', 'source', 'link', 'transcript', 'recording', 'duration', 'agenda item', 'any other business', 'aob', 'ps']);
// not a person: no name at all, or only a phone number
const unnamed = s => /^(unknown|unidentified|unnamed|guest|participant|speaker)$/i.test(s) || !/\p{L}/u.test(s) || (s.match(/\d/g) || []).length > 5;
function attendeesOf(turns, loose) {
  const count = new Map();
  for (const t of turns) if (t.speaker) count.set(t.speaker, (count.get(t.speaker) || 0) + 1);
  return [...count].filter(([s, n]) => !unnamed(s) && (!loose || (n >= 2 && !LABELS.has(s.toLowerCase().replace(/\s+/g, ' ').trim())))).map(([s]) => s);
}
function turnsOfLines(text) {   // .txt/.md/.docx/.pdf: read speakers out of "Name: words" lines without changing the text
  const turns = [];
  for (const l of norm(text).split('\n')) { const m = SPEAKER_LINE.exec(l.trim()); if (m) turns.push({ speaker: m[1], text: m[2] }); }
  return turns;
}

function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^\uFEFF/, '');
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}

/** Read a saved transcript as plain "Speaker: words" lines. */
export async function read(file) {
  const bad = reason => ({ ok: false, reason });
  const ext = path.extname(file).toLowerCase();
  const { maxChars, maxBytes } = limits();
  if (!EXTENSIONS.has(ext)) return bad('That kind of file cannot be read. Use a .vtt, .srt, .txt, .md, .docx, .pdf or .json transcript.');
  let st; try { st = fs.statSync(file); } catch { return bad('The transcript file could not be found.'); }
  if (st.size > maxBytes) return bad(`The file is bigger than the ${sizeText(maxBytes)} limit.`);
  let raw, text, turns = null, loose = false;
  try {
    if (ext === '.docx' || ext === '.pdf') {
      const r = extractDetailed(file, { maxChars, maxBytes, maxPages: 500 });
      if (r.truncated || !r.text) return bad(r.reason || 'The file has no readable text in it.');
      raw = r.text;
    } else {
      raw = readText(file);
      if (raw == null) return bad('The file does not look like text. It may be damaged or in another format.');
    }
  } catch { return bad('The file could not be read.'); }
  raw = norm(raw);
  if (ext === '.vtt' || ext === '.srt') {
    if (ext === '.vtt' && !/^\s*WEBVTT/.test(raw) && !raw.includes('-->')) return bad('The file is named .vtt but is not a WEBVTT caption file.');
    turns = cueTurns(raw);
    if (!turns.length) return bad('The caption file has no spoken text in it.');
    text = render(turns);
  } else if (ext === '.json') {
    turns = jsonTurns(raw);
    if (!turns) return bad('This JSON file is not a transcript export that can be read (it needs a list of entries with a speaker and their words).');
    text = render(turns);
  } else {
    const t = plainTurns(raw);
    if (t) { turns = t; text = render(t); }
    else { text = raw.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim(); turns = turnsOfLines(text); loose = true; }
  }
  if (!text.trim()) return bad('The file has no readable text in it.');
  if (/\uFFFD{3}/.test(text)) return bad('The file does not look like text. It may be damaged or in another format.');
  if (text.length > maxChars) return bad(`The transcript is ${text.length.toLocaleString('en-US')} characters, which is longer than the ${maxChars.toLocaleString('en-US')} that can be read in one go. Split it into shorter parts.`);
  const head = raw.split('\n').filter(l => l.trim() && !l.includes('-->')).slice(0, 12).join('\n');
  return { ok: true, text, format: ext.slice(1), date: guessDate(head, file), title: guessTitle(file), attendees: attendeesOf(turns, loose), chars: text.length };
}
