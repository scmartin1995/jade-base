// The offline speech model for the wake word (vosk-model-small-en-us-0.15, 40 MB), downloaded once into
// JadeBase/.state/models. Streamed to disk, so the server never holds it in memory or stalls while fetching.
// (A larger model was tried: the browser-side recogniser runs out of memory unpacking it, so only the small one is offered.)
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as config from './config.js';
import { emit } from './bus.js';

export const MODELS = {
  small: { url: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz', file: 'vosk-model-small-en-us-0.15.tar.gz', mb: 40 },
};
const dir = () => { const d = path.join(config.STATE, 'models'); fs.mkdirSync(d, { recursive: true }); return d; };
export const file = size => path.join(dir(), (MODELS[size] || MODELS.small).file);
const busy = new Set();

export function status() {
  const one = size => { const f = file(size); const ok = fs.existsSync(f); return { ready: ok, size: ok ? fs.statSync(f).size : 0, mb: MODELS[size].mb, downloading: busy.has(size) }; };
  return { small: one('small') };
}

export async function download(size = 'small') {
  const m = MODELS[size] || MODELS.small;
  const f = file(size);
  if (fs.existsSync(f)) return { ready: true };
  if (busy.has(size)) return { ready: false, downloading: true };
  busy.add(size);
  emit('voicemodel', { size, state: 'downloading' });
  try {
    const r = await fetch(m.url, { signal: AbortSignal.timeout(10 * 60e3) });
    if (!r.ok) throw new Error(`Model download failed: ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(f + '.part'));
    fs.renameSync(f + '.part', f);
    emit('voicemodel', { size, state: 'ready' });
    return { ready: true };
  } catch (e) {
    fs.rmSync(f + '.part', { force: true });
    emit('voicemodel', { size, state: 'failed', error: e.message });
    throw e;
  } finally { busy.delete(size); }
}
