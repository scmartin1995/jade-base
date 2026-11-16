// Plain text out of the documents project managers actually have: .docx, .pptx, .xlsx (zip-packed XML, read with
// Node's own zlib, no dependencies) and .pdf when the computer has pdftotext. Used by memory indexing and by project
// set-up from a folder. Returns null when a file can't be read as text.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync, execFile } from 'node:child_process';
import { which } from './util.js';

export const OFFICE = new Set(['.docx', '.pptx', '.xlsx']);
export const MAX_BYTES = 12 * 1024 * 1024, MAX_TEXT = 200_000;

function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    out.set(name, () => {
      const lnl = buf.readUInt16LE(lo + 26), lel = buf.readUInt16LE(lo + 28), start = lo + 30 + lnl + lel;
      const raw = buf.subarray(start, start + csize);
      return (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    });
    p += 46 + nl + el + cl;
  }
  return out;
}

const entities = s => s.replace(/&(amp|lt|gt|quot|apos);/g, m => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[m])).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const strip = xml => entities(xml.replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

function docx(z) {
  const get = z.get('word/document.xml');
  if (!get) return null;
  const xml = get().replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<\/w:tc>/g, '\t').replace(/<\/w:tr>/g, '\n');
  return strip(xml);
}
function pptx(z) {
  const slides = [...z.keys()].filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  if (!slides.length) return null;
  return slides.map((n, i) => `## Slide ${i + 1}\n` + strip(z.get(n)().replace(/<\/a:p>/g, '\n'))).join('\n\n');
}
function xlsx(z) {
  const shared = [];
  const ss = z.get('xl/sharedStrings.xml');
  if (ss) for (const m of ss().matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(strip(m[1]));
  const sheets = [...z.keys()].filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  if (!sheets.length) return null;
  const out = [];
  for (const n of sheets) {
    const rows = [];
    // An empty row is written <row r="5" …/>. The old pattern, <row[^>]*>, let [^>]* run through that row's "/" to its ">"
    // and then searched the rest of the sheet for a </row>; a sheet formatted down to row 1,048,576 (a million empty rows
    // and almost no closers) made that search start again at every row, which held the server for many minutes.
    // (?<!\/)> only takes the ">" of a row that has cells.
    for (const r of n && z.get(n)().matchAll(/<row\b[^>]*(?<!\/)>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of r[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const t = /t="(\w+)"/.exec(c[1])?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2])?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2])?.[1] ?? '';
        cells.push(t === 's' ? shared[+v] ?? '' : entities(v));
      }
      if (cells.some(x => x !== '')) rows.push(cells.join('\t'));
      if (rows.length >= 400) break;
    }
    out.push(`## ${n.replace('xl/worksheets/', '').replace('.xml', '')}\n${rows.join('\n')}`);
  }
  return out.join('\n\n');
}

/** Text of a document, or null. Markdown/text files are returned as they are. */
export function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (st.size > MAX_BYTES) return null;
  try {
    if (OFFICE.has(ext)) {
      const z = zipEntries(fs.readFileSync(file));
      const text = ext === '.docx' ? docx(z) : ext === '.pptx' ? pptx(z) : xlsx(z);
      return text ? text.slice(0, MAX_TEXT) : null;
    }
    if (ext === '.pdf') {
      const bin = which('pdftotext');
      if (!bin) return null;
      const r = spawnSync(bin, ['-layout', '-l', '40', '--', path.resolve(file), '-'], { encoding: 'utf8', timeout: 20000, maxBuffer: 4e6 });
      return r.status === 0 && r.stdout.trim() ? r.stdout.slice(0, MAX_TEXT) : null;
    }
    return fs.readFileSync(file, 'utf8').slice(0, MAX_TEXT);
  } catch { return null; }
}
/** The same text as extractText, but a PDF is read by a process the server does not wait on, so a slow file never holds up other requests. */
export async function extractTextAsync(file) {
  if (path.extname(file).toLowerCase() !== '.pdf') return extractText(file);
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (st.size > MAX_BYTES) return null;
  const bin = which('pdftotext');
  if (!bin) return null;
  return new Promise(resolve => {
    execFile(bin, ['-layout', '-l', '40', '--', path.resolve(file), '-'], { encoding: 'utf8', timeout: 20000, maxBuffer: 4e6 },
      (err, stdout) => resolve(!err && stdout.trim() ? stdout.slice(0, MAX_TEXT) : null));
  });
}
export const canExtract = ext => OFFICE.has(ext) || (ext === '.pdf' && !!which('pdftotext'));

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Like extractText, but says what it could not do. Returns { text, truncated, reason }: text is '' when nothing could be read,
 * truncated is true when the text is only part of the file, and reason is a plain-words sentence for either case (else null).
 * opts: { maxChars, maxPages, maxBytes } override the limits above.
 */
export function extractDetailed(file, { maxChars = MAX_TEXT, maxPages = 40, maxBytes = MAX_BYTES } = {}) {
  const none = reason => ({ text: '', truncated: false, reason });
  const ext = path.extname(file).toLowerCase();
  let st; try { st = fs.statSync(file); } catch { return none('The file could not be found'); }
  if (st.size > maxBytes) return none(`The file is ${Math.round(st.size / 1048576)} MB, which is more than the ${Math.round(maxBytes / 1048576)} MB that can be read`);
  const done = (text, extra) => {
    if (!text || !text.trim()) return none(extra || 'The file has no readable text in it');
    if (text.length > maxChars) return { text: text.slice(0, maxChars), truncated: true, reason: `The text is longer than the ${maxChars.toLocaleString('en-US')} characters that can be read, so only the start was read` };
    return { text, truncated: !!extra, reason: extra || null };
  };
  try {
    if (OFFICE.has(ext)) {
      let z; try { z = zipEntries(fs.readFileSync(file)); } catch { return none('The file is damaged or is not a real Office document'); }
      return done(ext === '.docx' ? docx(z) : ext === '.pptx' ? pptx(z) : xlsx(z), null);
    }
    if (ext === '.pdf') {
      const bin = which('pdftotext');
      if (!bin) return none('PDF reading needs the pdftotext tool, which is not installed');
      let pages = 0;
      const info = which('pdfinfo');
      if (info) { const r = spawnSync(info, ['--', path.resolve(file)], { encoding: 'utf8', timeout: 10000 }); pages = +(/^Pages:\s+(\d+)/m.exec(r.stdout || '')?.[1] || 0); }
      const r = spawnSync(bin, ['-layout', '-l', String(maxPages), '--', path.resolve(file), '-'], { encoding: 'utf8', timeout: 20000, maxBuffer: 16e6 });
      if (r.status !== 0) return none('The PDF could not be read (it may be damaged or locked with a password)');
      if (!r.stdout.trim()) return none('The PDF has no text in it (it may be a scan or pictures of pages)');
      return done(r.stdout, pages > maxPages ? `The PDF has ${plural(pages, 'page')} and only the first ${maxPages} can be read` : null);
    }
    return done(fs.readFileSync(file, 'utf8'), null);
  } catch { return none('The file could not be read'); }
}
