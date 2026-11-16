// Keeping Jade's own folder from filling up. A picture pasted into a chat is only a copy of something the person already has, so
// once what it shows has been written into a file it is deleted; anything else attached is removed after 30 days.
// Only files inside Jade's attachments folder are ever touched.
import fs from 'node:fs';
import path from 'node:path';
import * as config from './config.js';
import * as store from './store.js';

const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const TEXTISH = /\.(md|markdown|txt|html?|json|csv|org)$/i;
// "keep the screenshot", "save this image", "don't delete it": the picture is wanted, so it stays.
const KEEP = /\b(keep|save|store|retain)\b[^.?!\n]{0,40}\b(images?|screenshots?|pictures?|photos?|png)\b|\b(don'?t|do not|never)\s+(delete|remove|throw)/i;
const inside = (p, dir) => { const r = path.relative(path.resolve(dir), path.resolve(p)); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

export const releaseOn = () => config.get().chat?.releaseImages !== false;

/**
 * After a chat reply that wrote or changed files: delete the pictures pasted with this message, and with the one before it
 * (when that one's reply wrote nothing, the person often answers a question and the writing happens a message later).
 * They stay when nothing was written, when the person asked to keep them, when a written file is itself a picture (it was saved on
 * purpose), or when a written file names the picture (deleting it would break the link). Returns the paths deleted.
 */
export function releaseImages({ thread, touched = [], message = '' }) {
  if (!releaseOn() || !touched.length || KEEP.test(String(message))) return [];
  if (touched.some(t => IMAGE.test(t.path))) return [];
  const users = (store.getThread(thread)?.turns || []).filter(x => x.role === 'user' && !x.auto).slice(-2);
  const mentioned = touched.filter(t => TEXTISH.test(t.path)).map(t => { try { return fs.statSync(t.path).size <= 2e6 ? fs.readFileSync(t.path, 'utf8').toLowerCase() : ''; } catch { return ''; } });
  const gone = [];
  for (const turn of users) {
    const left = [];
    for (const img of turn.images || []) {
      const name = path.basename(img).toLowerCase();
      if (!inside(img, store.dirs.attachments) || mentioned.some(t => t.includes(name))) { left.push(img); continue; }
      try { fs.rmSync(img, { force: true }); gone.push(img); } catch { left.push(img); }
    }
    if (left.length !== (turn.images || []).length) store.markTurn(thread, turn.at, { images: left, gone: (turn.gone || 0) + (turn.images.length - left.length) });
  }
  return gone;
}

/** Remove attachments older than `days` (a day's worth of pasted pictures and files), and the folders they leave empty. */
export function pruneAttachments(days = 30) {
  const root = store.dirs.attachments;
  const cut = Date.now() - days * 864e5;
  let removed = 0;
  const walk = dir => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); try { if (!fs.readdirSync(p).length) fs.rmdirSync(p); } catch {} continue; }
      try { if (fs.statSync(p).mtimeMs < cut) { fs.rmSync(p, { force: true }); removed++; } } catch {}
    }
  };
  walk(root);
  return removed;
}
