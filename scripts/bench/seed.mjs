// Seed a throw-away Jade data folder with realistic volume. Usage: node seed.mjs <root>
// Creates <root>/home (JADE_HOME), <root>/claude (JADE_CLAUDE_HOME), <root>/work/bigproject (20,000 files).
// Counts can be changed with environment variables (SEED_PROJECTS, SEED_NOTES, SEED_ACTIONS, SEED_MEETINGS, SEED_FILES, SEED_CHATS, SEED_TURNS).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const root = path.resolve(process.argv[2] || '');
if (!process.argv[2]) { console.error('usage: node seed.mjs <root>'); process.exit(2); }
const N = k => Number(process.env['SEED_' + k] ?? { PROJECTS: 20, NOTES: 2000, ACTIONS: 3000, MEETINGS: 200, FILES: 20000, CHATS: 50, TURNS: 200, JOBS: 150 }[k]);
const home = path.join(root, 'home'), state = path.join(home, '.state');
for (const d of ['projects', 'notes', 'memory', '.state/meetings', '.state/tmp', 'claude']) fs.mkdirSync(d === 'claude' ? path.join(root, d) : path.join(home, d), { recursive: true });
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];
const WORDS = 'budget schedule risk milestone vendor contract review stakeholder deliverable scope change request approval sprint backlog release dependency forecast resource handover training migration audit invoice quarterly steering committee plan status report decision issue action owner deadline'.split(' ');
const sentence = (n = 12) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
const para = (s = 4) => Array.from({ length: s }, () => sentence(8 + Math.floor(rnd() * 10)) + '.').join(' ');
const iso = d => new Date(Date.now() - d * 864e5).toISOString();


// Real (small) documents, so the text readers do real work: a stored-method zip for .docx/.xlsx/.pptx and a one-page text PDF.
const crc = (() => { const t = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); return b => { let c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; }; })();
function zip(entries) {
  const parts = [], cd = []; let off = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text), n = Buffer.from(name), c = crc(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(c, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const e = Buffer.alloc(46); e.writeUInt32LE(0x02014b50, 0); e.writeUInt16LE(20, 4); e.writeUInt16LE(20, 6); e.writeUInt32LE(c, 16); e.writeUInt32LE(data.length, 20); e.writeUInt32LE(data.length, 24); e.writeUInt16LE(n.length, 28); e.writeUInt32LE(off, 42);
    parts.push(h, n, data); cd.push(e, n); off += 30 + n.length + data.length;
  }
  const cdb = Buffer.concat(cd), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(cd.length / 2, 8); end.writeUInt16LE(cd.length / 2, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdb, end]);
}
const docx = t => zip({ 'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:body></w:document>` });
const xlsx = t => zip({ 'xl/sharedStrings.xml': `<sst><si><t>${t}</t></si></sst>`, 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>' });
const pptx = t => zip({ 'ppt/slides/slide1.xml': `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>` });
// text pdf; 1 in 10 has no text (a scan), which is common in real project folders
const pdf = (t, scan) => { const o = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>', null, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  const stream = scan ? '0 0 10 10 re f' : `BT /F1 10 Tf 10 100 Td (${t.slice(0, 80)}) Tj ET`; o[3] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n'; const offs = []; o.forEach((b, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = out.length; out += `xref\n0 6\n0000000000 65535 f \n${offs.map(v => String(v).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`; return out; };

// project folder with many files
const big = path.join(root, 'work', 'bigproject');
const exts = ['.md', '.md', '.txt', '.csv', '.docx', '.xlsx', '.pdf', '.png', '.json', '.pptx'];
for (let i = 0; i < N('FILES'); i++) {
  const dir = path.join(big, `area-${i % 20}`, `topic-${Math.floor(i / 20) % 25}`, `sub-${Math.floor(i / 500) % 8}`);
  fs.mkdirSync(dir, { recursive: true });
  const ext = pick(exts), f = path.join(dir, `${pick(WORDS)}-${pick(WORDS)}-${i}${ext}`);
  const t = `${sentence(6)}. ${para(3)}`;
  fs.writeFileSync(f, ext === '.docx' ? docx(t) : ext === '.xlsx' ? xlsx(t) : ext === '.pptx' ? pptx(t) : ext === '.pdf' ? pdf(t, i % 10 === 0) : ext === '.png' ? 'x' : `# ${sentence(4)}\n\n${para(6)}\n\n${para(4)}\n`);
}
// projects
const pids = [];
for (let i = 0; i < N('PROJECTS'); i++) {
  const id = `project-${i + 1}`; pids.push(id);
  fs.writeFileSync(path.join(home, 'projects', id + '.json'), JSON.stringify({ id, name: `Project ${i + 1} ${pick(WORDS)}`, description: para(2), owner: 'Pat', folders: i === 0 ? [big] : [], links: [], tags: [], createdAt: iso(200), updatedAt: iso(i) }, null, 2));
}
// notes in the data folder
for (let i = 0; i < N('NOTES'); i++) {
  const proj = rnd() < 0.7 ? pick(pids) : '';
  fs.writeFileSync(path.join(home, 'notes', `2026-01-${String(1 + i % 28).padStart(2, '0')}-note-${i}.md`), `---\ntitle: Note ${i} ${sentence(3)}\nproject: ${proj}\ntags: [a, b]\ncreated: ${iso(i / 10)}\n---\n\n${para(8)}\n\n${para(6)}\n`);
}
// actions
fs.writeFileSync(path.join(home, 'actions.json'), JSON.stringify(Array.from({ length: N('ACTIONS') }, (_, i) => ({ id: `a-${i}`, text: `Action ${i}: ${sentence(8)}`, project: rnd() < 0.8 ? pick(pids) : '', owner: 'Pat',
  due: new Date(Date.now() + (rnd() * 60 - 30) * 864e5).toISOString().slice(0, 10), priority: pick(['normal', 'high', 'low']), status: rnd() < 0.6 ? 'open' : 'done', source: 'manual', createdAt: iso(rnd() * 100) })), null, 2));
// meetings
for (let i = 0; i < N('MEETINGS'); i++) {
  const id = `m-${i}`;
  fs.writeFileSync(path.join(state, 'meetings', id + '.json'), JSON.stringify({ id, project: pick(pids), title: `Meeting ${i} ${sentence(3)}`, date: iso(i).slice(0, 10), attendees: ['Pat', 'Sam'], source: { name: `t${i}.vtt`, path: `/x/t${i}.vtt`, hash: 'h' + i },
    status: 'recorded', error: null, pausedUntil: null, missed: [], counts: { passed: 5, corrected: 1, notChecked: 0 }, steps: [], recordPath: null, createdAt: iso(i), updatedAt: iso(i),
    skills: ['actions', 'decisions', 'risks'].map(name => ({ name, status: 'done', items: Array.from({ length: 8 }, () => ({ text: sentence(10), owner: 'Pat', evidence: para(3), quote: sentence(14) })) })) }));
}
// chats
const threads = Array.from({ length: N('CHATS') }, (_, c) => ({ id: `c-${c}`, title: `Chat ${c} ${sentence(3)}`, titled: true, createdAt: iso(60 - c), updatedAt: iso(c / 10),
  turns: Array.from({ length: N('TURNS') }, (_, t) => ({ at: new Date(Date.now() - (N('TURNS') - t) * 6e4 - c * 36e5).toISOString(), role: t % 2 ? 'jade' : 'user', text: t % 2 ? para(7) : sentence(14), via: 'text', ...(t % 2 ? { job: `j-${c}-${t}` } : {}) })) }));
fs.writeFileSync(path.join(state, 'chats.json'), JSON.stringify({ threads }, null, 2));
// recent runs
fs.writeFileSync(path.join(state, 'jobs.json'), JSON.stringify(Array.from({ length: N('JOBS') }, (_, i) => ({ id: `j-old-${i}`, agent: 'jade', agentName: 'Jade', title: `Run ${i}`, input: { message: sentence(6), thread: `c-${i % 50}` }, trigger: 'chat',
  engine: 'claude', model: '', status: 'done', output: para(40).slice(0, 8000), tools: [], createdAt: iso(i / 20), startedAt: iso(i / 20), endedAt: iso(i / 20) })), null, 2));
fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ name: 'Pat', setup: { done: true } }, null, 2));
console.log(JSON.stringify({ root, files: N('FILES'), notes: N('NOTES'), actions: N('ACTIONS'), meetings: N('MEETINGS'), chats: N('CHATS'), turns: N('TURNS') }));
