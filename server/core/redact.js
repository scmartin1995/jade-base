// One place that hides secrets in text before it is kept or shown: the gateway or Bedrock key and header values Jade holds (every value in
// engine.env whose name says it is a secret), Jade's own key, and the common shapes of keys and tokens. Applied to what a run printed, the
// errors, chat turns as stored, the event stream, the diagnostics and the Dreams digest. The replacement never contains a quote or a
// backslash, so it is safe on JSON text as well as on plain text.
import fs from 'node:fs';
import * as provider from './provider.js';
import * as auth from './auth.js';
import { SECRET_NAME } from './secretname.js';

export const MASK = '[hidden]';
export { SECRET_NAME };   // the one copy lives in secretname.js (provider.js reads it from there, so the two files do not import each other)
// char classes leave out quotes, backslash and spaces on purpose
const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}|\bASIA[0-9A-Z]{12,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}|\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  /(\bBearer\s+)[A-Za-z0-9._~+\/=-]{8,}/gi,
  /(\bx-api-key\s*[:=]\s*)[A-Za-z0-9._~+\/=-]{6,}/gi,
  /(\b(?:api[_-]?key|auth[_-]?token|access[_-]?token|secret[_-]?access[_-]?key|session[_-]?token|bearer[_-]?token(?:[_-]bedrock)?|password|passwd)\b["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+\/=-]{8,}/gi,
];

let memo = { stamp: '', list: [] };
function knownSecrets() {
  let stamp = '';
  try { const st = fs.statSync(provider.FILE); stamp = `${st.mtimeMs}:${st.size}`; } catch { /* none */ }
  if (stamp === memo.stamp && memo.list.length) return memo.list;
  memo = { stamp, list: collect() };
  return memo.list;
}
function collect() {
  const out = new Set();
  const add = v => { v = String(v || '').trim(); if (v.length >= 6) out.add(v); };
  try {
    for (const [k, v] of Object.entries(provider.read())) {
      if (!SECRET_NAME.test(k)) continue;
      if (/HEADERS$/i.test(k)) {   // Name: Value lines: the value is the secret
        for (const l of String(v).split(/\\n|\r?\n/)) { const i = l.indexOf(':'); if (i > 0) add(l.slice(i + 1)); }
      } else add(v);
    }
  } catch { /* no engine file */ }
  try { const t = auth.token(); if (t.length >= 8) out.add(t); } catch { /* none */ }
  return [...out].sort((a, b) => b.length - a.length);
}

/** The text with every secret replaced by [hidden]. Anything that is not text comes back as a string; nothing throws. */
export function redact(text) {
  let s = String(text ?? '');
  if (!s) return s;
  for (const v of knownSecrets()) if (s.includes(v)) s = s.split(v).join(MASK);
  for (const re of PATTERNS) s = s.replace(re, (m, pre) => (typeof pre === 'string' ? pre : '') + MASK);
  return s;
}

/** Where every secret sits in the text, as [start, end) pairs (the known values and the common shapes). */
function spans(s) {
  const out = [];
  for (const v of knownSecrets()) { for (let i = s.indexOf(v); i >= 0; i = s.indexOf(v, i + v.length)) out.push([i, i + v.length]); }
  for (const re of PATTERNS) { re.lastIndex = 0; for (let m; (m = re.exec(s)); ) { out.push([m.index, m.index + m[0].length]); if (!m[0]) re.lastIndex++; } }
  return out;
}
const TOKENS_HELD = 3, HOLD_MAX = 4096;

/**
 * Hides secrets in text that arrives in pieces (a run's output as it is printed). A key can be cut between two pieces, so the end of what
 * came in is held back until the next piece or end() shows it is not the start of one: at least as long as the longest secret Jade holds,
 * and the last few words (a key shape such as "Bearer abc..." starts before the key). push(text) returns the text that is safe to release;
 * end() returns the rest. Together they give exactly what redact() gives for the whole text.
 */
export function redactor() {
  let buf = '';
  return {
    push(text) {
      buf += String(text ?? '');
      const longest = knownSecrets().reduce((n, v) => Math.max(n, v.length), 0);
      let cut = buf.length - Math.max(0, longest - 1);
      // keep the last few words, up to a limit, because a shape (Bearer x, api_key = x) starts before its value
      let w = buf.length, seen = 0, i = buf.length;
      while (i > 0 && seen < TOKENS_HELD && buf.length - i < HOLD_MAX) {
        while (i > 0 && /\s/.test(buf[i - 1])) i--;
        while (i > 0 && !/\s/.test(buf[i - 1]) && buf.length - i < HOLD_MAX) i--;
        seen++; w = i;
      }
      cut = Math.min(cut, w);
      if (cut <= 0) return '';
      for (const [a, b] of spans(buf)) if (a < cut && b > cut) cut = Math.min(cut, a);   // never cut through a secret
      if (cut <= 0) return '';
      const out = redact(buf.slice(0, cut));
      buf = buf.slice(cut);
      return out;
    },
    end() { const out = redact(buf); buf = ''; return out; },
  };
}

/** One server-sent event, as written to the browser, with any key hidden (the text is JSON, and the replacement is safe in JSON). */
export const sseLine = ev => `data: ${redact(JSON.stringify(ev))}\n\n`;
