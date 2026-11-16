// Transcript intake: receive (size cap, extension, duplicate, safe names) and read (every format, dates, refusals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-transcripts-test-'));
process.env.JADE_HOME = path.join(dir, 'home');
process.env.JADE_CLAUDE_HOME = path.join(dir, 'claude-home');
const config = await import('../server/core/config.js');
const store = await import('../server/core/store.js');
config.load(); store.init();
const T = await import('../server/core/transcripts.js');
const { extractDetailed } = await import('../server/core/extract.js');
const FX = path.join(import.meta.dirname, 'fixtures', 'transcripts');
const fx = n => path.join(FX, n);
const body = (data, headers = {}) => Object.assign(Readable.from([Buffer.from(data)]), { headers, socket: { destroy() { this.gone = true; }, gone: false } });
const work = n => path.join(dir, n);

// a tiny .docx: a zip with one stored entry
function zip(name, content) {
  const data = Buffer.from(content), nm = Buffer.from(name);
  const crc = zlib.crc32 ? zlib.crc32(data) : 0;
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nm.length, 28);
  const off = 30 + nm.length + data.length;
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(46 + nm.length, 12); eo.writeUInt32LE(off, 16);
  return Buffer.concat([lh, nm, data, cd, nm, eo]);
}
function pdf(pages) {   // a plain PDF with one line of text per page
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  pages.forEach((t, i) => {
    const s = `BT /F1 12 Tf 50 700 Td (${t}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`, `<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  });
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out);
}

test('Teams .vtt: voice tags, cue ids, notes and settings are removed; turns merge', async () => {
  const r = await T.read(fx('teams-2026-11-12_Steering.vtt'));
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Ana Moreau: Welcome everyone, let\'s start with the budget. We are two weeks behind on the pump order.\nTomas Brandt: I will chase the supplier by Friday.');
  assert.deepEqual(r.attendees, ['Ana Moreau', 'Tomas Brandt']);
  assert.equal(r.date, '2026-11-12');
  assert.equal(r.title, 'teams Steering');
  assert.equal(r.format, 'vtt');
  assert.equal(r.chars, r.text.length);
});

test('Zoom .vtt: "Speaker: text" lines, date from the GMT file name', async () => {
  const r = await T.read(fx('zoom-GMT20261112-100000_Recording.transcript.vtt'));
  assert.equal(r.ok, true);
  assert.equal(r.text.split('\n').length, 2);
  assert.match(r.text, /^Lena Ostrow: Thanks for joining.*crane booking\.\nJoel Mbeki: The crane is booked for the 20th\.$/);
  assert.equal(r.date, '2026-11-12');
  assert.deepEqual(r.attendees, ['Lena Ostrow', 'Joel Mbeki']);
});

test('.srt: numbers and times removed', async () => {
  const r = await T.read(fx('weekly-sync_2026-10-05.srt'));
  assert.equal(r.text, 'Rhea Patel: We need sign-off on the drawings.\nSam Okoye: I can do that by Wednesday.');
  assert.equal(r.date, '2026-10-05');
  assert.equal(r.title, 'weekly sync');
});

test('Otter .txt: speaker and time lines become "Speaker: words"; date from the first lines', async () => {
  const r = await T.read(fx('otter-roadmap-review.txt'));
  assert.equal(r.ok, true);
  assert.match(r.text, /^Roadmap review\nNov 3, 2026 at 2:00 PM\nMira Haldane: Let's look at the roadmap for next quarter\.\nPieter Voss: The harbour survey is the main risk\. We have not had the permit yet\.\nMira Haldane: Agreed/);
  assert.equal(r.date, '2026-11-03');
  assert.deepEqual(r.attendees, ['Mira Haldane', 'Pieter Voss']);
  assert.equal(r.title, 'otter roadmap review');
});

test('.md is read as it is; speakers found from "Name: words" lines', async () => {
  const r = await T.read(fx('kickoff-notes.md'));
  assert.ok(r.text.startsWith('# Kickoff'));
  assert.deepEqual(r.attendees, ['Kara', 'Ed']);
});

test('.json: a list of speaker and text is read; other JSON is refused with a reason', async () => {
  const r = await T.read(fx('export.json'));
  assert.equal(r.text, 'Ines Calder: The inspection passed. Next is the handover.\nOmar Sidhu: I will prepare the handover pack.');
  const bad = await T.read(fx('not-a-transcript.json'));
  assert.equal(bad.ok, false); assert.match(bad.reason, /not a transcript/);
});

test('.docx goes through extract.js and keeps its speakers', async () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>Dana Wu: Budget is approved.</w:t></w:r></w:p><w:p><w:r><w:t>Ravi Das: Good news.</w:t></w:r></w:p></w:body></w:document>';
  const f = work('standup 2026-09-14.docx'); fs.writeFileSync(f, zip('word/document.xml', xml));
  const r = await T.read(f);
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Dana Wu: Budget is approved.\nRavi Das: Good news.');
  assert.equal(r.date, '2026-09-14');
});

const hasPdf = !!spawnSync('which', ['pdftotext']).stdout.length;
test('.pdf is read; a PDF with too many pages is refused, not trimmed', { skip: !hasPdf }, async () => {
  const f = work('minutes.pdf'); fs.writeFileSync(f, pdf(['Ola Berg: Plan agreed.']));
  const r = await T.read(f);
  assert.equal(r.ok, true); assert.match(r.text, /Ola Berg: Plan agreed\./);
  const d = extractDetailed(f, { maxPages: 1 }); assert.equal(d.truncated, false);
  const long = work('long.pdf'); fs.writeFileSync(long, pdf(['one', 'two', 'three']));
  const cut = extractDetailed(long, { maxPages: 2 });
  assert.equal(cut.truncated, true); assert.match(cut.reason, /3 pages and only the first 2/);
});

test('extractDetailed explains each limit; extractText is unchanged', async () => {
  const empty = work('empty.txt'); fs.writeFileSync(empty, '   ');
  assert.match(extractDetailed(empty).reason, /no readable text/);
  assert.match(extractDetailed(work('nope.txt')).reason, /could not be found/);
  const big = work('big.txt'); fs.writeFileSync(big, 'x'.repeat(300));
  const r = extractDetailed(big, { maxChars: 100 });
  assert.equal(r.truncated, true); assert.equal(r.text.length, 100); assert.match(r.reason, /only the start was read/);
  assert.match(extractDetailed(big, { maxBytes: 10 }).reason, /more than/);
  const { extractText } = await import('../server/core/extract.js');
  assert.equal(extractText(big).length, 300);
});

test('text over the character limit is refused with a reason', async () => {
  config.save({ meetings: { maxChars: 50 } });
  const f = work('long.txt'); fs.writeFileSync(f, 'Ann: ' + 'word '.repeat(40));
  const r = await T.read(f);
  assert.equal(r.ok, false); assert.match(r.reason, /longer than the 50/);
  config.save({ meetings: { maxChars: 400000 } });
});

test('empty, unsupported and binary files are refused', async () => {
  const e = work('blank.txt'); fs.writeFileSync(e, '\n\n');
  assert.equal((await T.read(e)).ok, false);
  const x = work('sheet.xlsx'); fs.writeFileSync(x, 'x');
  assert.match((await T.read(x)).reason, /cannot be read/);
  const b = work('bin.txt'); fs.writeFileSync(b, Buffer.from([1, 2, 0, 3]));
  assert.match((await T.read(b)).reason, /does not look like text/);
  assert.equal((await T.read(work('missing.vtt'))).ok, false);
});

test('date: explicit date, then file name patterns, then the file date', async () => {
  const mk = (n, t) => { const f = work(n); fs.writeFileSync(f, t); return f; };
  assert.equal((await T.read(mk('a.txt', 'Meeting on 12 March 2026\nAnn: hi\nBo: yes'))).date, '2026-03-12');
  assert.equal((await T.read(mk('call 20261205.txt', 'Ann: hi\nAnn: yes'))).date, '2026-12-05');
  assert.equal((await T.read(mk('call 25-12-2026.txt', 'Ann: hi'))).date, '2026-12-25');
  assert.equal((await T.read(mk('call_2026_01_09.txt', 'Ann: hi'))).date, '2026-01-09');
  const old = mk('nodate.txt', 'Ann: hi'); const t = new Date(2025, 5, 7, 12); fs.utimesSync(old, t, t);
  assert.equal((await T.read(old)).date, '2025-06-07');
});

test('receive saves the file, hashes it and counts bytes', async () => {
  const r = await T.receive(body('Ann: hello\nBo: hi\n'), { project: 'p1', name: 'standup.txt' });
  assert.equal(r.name, 'standup.txt'); assert.equal(r.bytes, 18); assert.equal(r.duplicateOf, null);
  assert.equal(r.hash.length, 64);
  assert.equal(fs.readFileSync(r.path, 'utf8'), 'Ann: hello\nBo: hi\n');
  assert.ok(r.path.toLowerCase().includes(path.join('meetings', 'transcripts')));
  assert.deepEqual(fs.readdirSync(path.dirname(r.path)).filter(f => f.endsWith('.tmp')), []);
  const r2 = await T.receive(body('different'), { project: 'p1', name: 'standup.txt' });
  assert.equal(r2.name, 'standup (2).txt');
});

test('receive: over the cap is 413 and the upload is read to its end, not reset; a bad extension is 415', async () => {
  config.save({ meetings: { maxBytes: 10 } });
  const req = body('x'.repeat(100));
  const { EventEmitter } = await import('node:events');
  const res = new EventEmitter();
  await assert.rejects(T.receive(req, { project: 'p1', name: 'big.txt', res }), e => e.status === 413);
  res.emit('close');
  for (let i = 0; i < 400 && !req.readableEnded; i++) await new Promise(r => setTimeout(r, 25));   // the rest of the body is read and thrown away; wait for that, not for one tick
  assert.equal(req.readableEnded, true, 'the rest of the upload is read, so the browser can finish sending and read the answer');
  assert.notEqual(req.socket.gone, true, 'the connection is not reset under the browser (that loses the 413 answer)');
  const dir1 = store.projectDir('p1', 'Meetings/transcripts');
  assert.equal(fs.existsSync(path.join(dir1, 'big.txt')), false);
  assert.deepEqual(fs.readdirSync(dir1).filter(f => f.endsWith('.tmp')), []);
  const declared = body('x', { 'content-length': '999' });
  await assert.rejects(T.receive(declared, { project: 'p1', name: 'big2.txt' }), e => e.status === 413);
  config.save({ meetings: { maxBytes: 26214400 } });
  await assert.rejects(T.receive(body('MZ'), { project: 'p1', name: 'tool.exe' }), e => e.status === 415);
  await assert.rejects(T.receive(body('x'), { project: 'p1', name: '' }), e => e.status === 415);
});

test('receive: the same content for the same project is a duplicate of the earlier meeting', async () => {
  const first = await T.receive(body('Ann: same words'), { project: 'p2', name: 'one.txt' });
  fs.mkdirSync(path.join(process.env.JADE_HOME, '.state', 'meetings'), { recursive: true });
  fs.writeFileSync(path.join(process.env.JADE_HOME, '.state', 'meetings', 'm1.json'), JSON.stringify({ id: 'm1', project: 'p2', status: 'recorded', source: { name: first.name, path: first.path, hash: first.hash } }));
  const again = await T.receive(body('Ann: same words'), { project: 'p2', name: 'two.txt' });
  assert.equal(again.duplicateOf, 'm1'); assert.equal(again.path, first.path);
  assert.equal(fs.existsSync(path.join(path.dirname(first.path), 'two.txt')), false);
  const other = await T.receive(body('Ann: same words'), { project: 'p3', name: 'two.txt' });
  assert.equal(other.duplicateOf, null);
});

test('safe names: folders, leading dots, odd characters', async () => {
  assert.equal(T.safeName('../../etc/passwd.txt'), 'passwd.txt');
  assert.equal(T.safeName('C:\\Users\\me\\notes.vtt'), 'notes.vtt');
  assert.equal(T.safeName('.hidden.txt'), 'hidden.txt');
  assert.equal(T.safeName('a<b>:c?.txt'), 'a_b__c_.txt');
  assert.equal(Buffer.byteLength(T.safeName('x'.repeat(300) + '.vtt')), 255);
  assert.ok(T.safeName('x'.repeat(300) + '.vtt').endsWith('.vtt'));
  const r = await T.receive(body('Ann: hi'), { project: 'p4', name: '../../escape.txt' });
  assert.equal(path.dirname(r.path), store.projectDir('p4', 'Meetings/transcripts'));
});

test('safe names: Windows device names, byte cap, too-long names are a 400', async () => {
  for (const n of ['CON.txt', 'nul.md', 'aux.vtt', 'COM1.txt', 'lpt9.srt', 'Con.tar.txt']) assert.ok(T.safeName(n).startsWith('_'), n);
  assert.equal(T.safeName('console.txt'), 'console.txt'); assert.equal(T.safeName('com10.txt'), 'com10.txt');
  const cjk = T.safeName('会議'.repeat(100) + '.vtt');
  assert.ok(Buffer.byteLength(cjk) <= 255 && cjk.endsWith('.vtt'), `${Buffer.byteLength(cjk)} bytes`);
  assert.ok(!cjk.includes('\uFFFD'));
  const r = await T.receive(body('Ann: hi'), { project: 'p5', name: '会議'.repeat(100) + '.txt' });
  assert.ok(Buffer.byteLength(r.name) <= 255);
  const r2 = await T.receive(body('Ann: hi again'), { project: 'p5', name: '会議'.repeat(100) + '.txt' });   // the " (2)" still fits
  assert.ok(Buffer.byteLength(r2.name) <= 255 && r2.name.includes('(2)'));
  const bin = path.join(path.dirname(r.path), 'x');
  assert.equal(fs.existsSync(bin), false);
});

test('small size limits are said sensibly', async () => {
  assert.equal(T.sizeText(26214400), '25 MB'); assert.equal(T.sizeText(1572864), '1.5 MB'); assert.equal(T.sizeText(307200), '300 KB'); assert.equal(T.sizeText(10), '10 bytes'); assert.equal(T.sizeText(1), '1 byte');
  config.save({ meetings: { maxBytes: 10 } });
  await assert.rejects(T.receive(body('x'.repeat(100)), { project: 'p1', name: 'big3.txt' }), e => e.status === 413 && /10 bytes/.test(e.message) && !/0 MB/.test(e.message));
  config.save({ meetings: { maxBytes: 26214400 } });
});

test('a name the file system refuses as too long is a 400 with a plain message', async () => {
  const fsx = await import('node:fs');
  const real = fsx.default.renameSync;
  fsx.default.renameSync = () => { throw Object.assign(new Error('ENAMETOOLONG: name too long'), { code: 'ENAMETOOLONG' }); };
  try { await assert.rejects(T.receive(body('Ann: hi'), { project: 'p6', name: 'a.txt' }), e => e.status === 400 && /too long/.test(e.message) && !/ENAMETOOLONG/.test(e.message)); }
  finally { fsx.default.renameSync = real; }
  assert.deepEqual(fs.readdirSync(store.projectDir('p6', 'Meetings/transcripts')).filter(f => f.endsWith('.tmp')), []);
});

test('bold Markdown speaker labels are speakers; headings like Note: and Agenda: are not people', async () => {
  const f = work('bold.md');
  fs.writeFileSync(f, '# Review\n\nAgenda: prices\nNote: bring the contract\n\n**Rosa:** Welcome all.\n**Neil**: Thanks.\n**Rosa:** Prices first.\nNote: invoices are late\n**Neil:** Fine.\nAgenda: next steps\n');
  const r = await T.read(f);
  assert.deepEqual(r.attendees, ['Rosa', 'Neil']);
  const sup = await T.read(path.join(import.meta.dirname, 'fixtures', 'meetings', 'supplier-review-quillfeather-print.md'));
  assert.deepEqual(sup.attendees, JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'meetings', 'supplier-review-quillfeather-print.expected.json'), 'utf8')).attendees);
  const g = work('phone.txt');
  fs.writeFileSync(g, 'Unknown: hello there\nUnknown: more words\nAna: hi\nAna: again\n');
  assert.deepEqual((await T.read(g)).attendees, ['Ana']);
  const v = work('phone.vtt');
  fs.writeFileSync(v, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v +44 7700 900123>Hello there.</v>\n\n00:00:03.000 --> 00:00:04.000\n<v Dana>Hi.</v>\n');
  assert.deepEqual((await T.read(v)).attendees, ['Dana']);
});

test('receive gives the saved copy the original file\'s date when the browser sends it, so the meeting date falls back to that day', async () => {
  const when = Date.UTC(2025, 5, 7, 12);
  const r = await T.receive(body('Ann: hello there everyone\nBo: hi\n'), { project: 'p1', name: 'undated call.txt', modified: String(when) });
  assert.equal((await T.read(r.path)).date, '2025-06-07');
  const bad = await T.receive(body('Ann: hello there everyone, again\nBo: hi\n'), { project: 'p1', name: 'undated two.txt', modified: 'nonsense' });
  assert.equal(fs.statSync(bad.path).mtime.getFullYear() >= new Date().getFullYear(), true, 'a made-up date is ignored');
});
