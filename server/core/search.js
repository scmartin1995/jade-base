// One search, one list of results, the way the earlier tool did it: whatever Jade can reach, ranked together.
//   notes, and documents by what they say (memory's full-text index: .md, .txt, .docx, .pptx, .xlsx, .pdf…)
//   any file by its name (the files index: deliverables of every type)
//   past chats by what was said
// Each result: { kind, title, path, project, date, score, snippet, source }. kind: document | file | chat.
import path from 'node:path';
import * as memory from './memory.js';
import * as files from './files.js';
import * as store from './store.js';
import * as config from './config.js';
import { within } from './locations.js';
import { slicer, runSync, runAsync } from './slices.js';

// Chats looked through for one search: the newest ones. A search must stay quick however many chats there are.
const MAX_CHATS = 300;

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'it', 'at', 'by', 'from', 'this', 'that', 'what', 'my', 'me']);
const tokens = q => [...new Set(String(q || '').toLowerCase().replace(/[^a-z0-9_.\-/ ]+/g, ' ').split(/[\s/]+/).map(t => t.replace(/^[.\-_]+|[.\-_]+$/g, '')).filter(t => t.length > 1 && !STOP.has(t)))];
const recency = iso => { const age = Math.max(0, (Date.now() - (Date.parse(iso || '') || 0)) / 864e5); return 1 + 0.5 * Math.exp(-age / 120); };
const kindOf = p => {
  const home = config.JADE_HOME;
  if (p.startsWith(path.join(home, 'notes'))) return 'note';
  if (p.startsWith(path.join(home, 'deliverables')) || (config.outputIsCustom() && p.startsWith(config.outputDir() + path.sep) && /dashboard|deliverable/i.test(path.basename(p)))) return 'deliverable';
  return 'document';
};
/** The project a file belongs to, by the project folders. */
function projectFor(p, rs) {
  const r = rs().find(x => x.project && within(x.dir, p));
  return r?.project?.name || '';
}
/** The best window of text around the first matched word, with the match preserved for highlighting on the client. */
function snippet(text, terms, n = 220) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const lower = t.toLowerCase();
  let at = -1;
  for (const w of terms) { const i = lower.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return t.slice(0, n);
  const start = Math.max(0, at - 70);
  return (start ? '…' : '') + t.slice(start, start + n).trim() + (start + n < t.length ? '…' : '');
}

/** The folders, read once for one search (not once per hit). */
const rootsOnce = () => { let r; return () => r || (r = files.roots()); };

/**
 * search(q, { limit, kinds })  kinds: subset of document | file | chat (default all)
 */
export function search(q, { limit = 20, kinds } = {}) {
  const want = wanted(kinds);
  return runSync(searchGen(q, { limit, want }, want.has('file') && tokens(q).length ? files.search(q, { limit: 60 }) : [], slicer()));
}
/** The same search for a request: the file walk and the chat reading give way to other requests while they run. */
export async function searchAsync(q, { limit = 20, kinds } = {}) {
  const want = wanted(kinds);
  const named = want.has('file') && tokens(q).length ? await files.searchAsync(q, { limit: 60 }) : [];
  return runAsync(searchGen(q, { limit, want }, named, slicer()));
}
const wanted = kinds => new Set(kinds?.length ? kinds : ['document', 'file', 'chat']);

function* searchGen(q, { limit, want }, named, due) {
  const terms = tokens(q);
  if (!terms.length) return [];
  const out = [], rs = rootsOnce();
  const seenPath = new Set();

  // documents: the full-text index, collapsed to one result per file
  if (want.has('document')) {
    for (const h of memory.search(q, 40)) {
      if (seenPath.has(h.file)) continue;
      seenPath.add(h.file);
      out.push({ kind: kindOf(h.file), title: h.title, path: h.file, project: projectFor(h.file, rs), date: new Date(h.mtime).toISOString(), score: h.score, snippet: h.snippet, source: 'content' });
    }
  }
  // files by name: deliverables and documents of any type (dashboards, decks, workbooks, PDFs). A file whose name has every word
  // typed is what someone searching by name is after, so it ranks with the best content matches, not under them: the content
  // scores run 10-25 while this used to give a named file 2.5-5, which pushed every .html below the first page of results.
  // Backups, lock files and Jade's own scratch copies are left out.
  if (want.has('file')) {
    const top = Math.max(10, ...out.map(o => o.score));
    for (const f of named) {
      const p = f.path || f.file; if (!p || seenPath.has(p)) continue;
      const name = (f.name || path.basename(p)).toLowerCase();
      if (/\.(bak|tmp|lock)\b|\.bak-|^~\$|(^|[\\/])\.?(work|node_modules)[\\/]/i.test(name) || /[\\/]Jade(OS|Base)[\\/](work|\.state)[\\/]/i.test(p)) continue;
      seenPath.add(p);
      const inName = terms.filter(t => name.includes(t)).length;
      const all = inName === terms.length;
      const deliverable = /\.(html?|pdf|docx|pptx|xlsx|csv)$/i.test(name);
      const s = (all ? top * (deliverable ? 1.02 : 0.9) : inName ? top * 0.5 * (inName / terms.length) : 1) * recency(f.mtime ? new Date(f.mtime).toISOString() : '');
      out.push({ kind: 'file', title: f.name || path.basename(p), path: p, project: f.projectName || '', date: f.mtime ? new Date(f.mtime).toISOString() : '', score: +s.toFixed(2), snippet: f.display || '', source: 'name' });
    }
  }
  // chats: what was asked and answered; counts for less than a file, and only a few are shown
  if (want.has('chat')) {
    let n = 0;
    for (const t of store.listThreads().slice(0, MAX_CHATS)) {
      if (due()) yield;
      const lower = store.chatSearchText(t.id); if (lower === null) continue;   // kept per chat: no chat is read to find out that it has no match
      const hit = terms.filter(w => lower.includes(w)).length;
      if (!hit) continue;
      const th = store.getThread(t.id); if (!th) continue;
      const text = (th.turns || []).map(x => x.text || '').join('\n');
      const s = 0.6 * (1 + hit) * (1 + 0.35 * hit / terms.length) * recency(th.updatedAt);
      out.push({ kind: 'chat', title: th.title, path: `#/chat/${th.id}`, project: '', date: th.updatedAt || th.createdAt, score: +s.toFixed(2), snippet: snippet(text, terms), source: 'chat', turns: (th.turns || []).length });
      if (++n >= 6) break;
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
