// The one place that hides what only Windows changes in the parity record: machine folders become tokens, and environment names are
// folded. Used by scripts/parity-harness.mjs (every recorded text) and test/provider-parity.test.js (every comparison). The `platform`
// argument lets test/parity-normalise.test.js feed it Windows-shaped input on any system. Nothing here changes on Linux and macOS.
import fs from 'node:fs';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every spelling a folder can have: as given and as the system's real (long) path. */
export function variants(p, platform = process.platform) {
  const out = [p];
  if (platform === process.platform) { try { out.push((platform === 'win32' ? fs.realpathSync.native : fs.realpathSync)(p)); } catch { /* not there (yet) */ } }
  return out;
}

/** The forms one Windows folder takes: C:\x, C:/x, C:\\x (inside JSON), /c/x (the product's permission rules use //c/x). */
function spellings(p, win) {
  const set = new Set([p, JSON.stringify(p).slice(1, -1)]);
  if (win) {
    const f = p.split('\\').join('/');
    set.add(f);
    const m = /^([A-Za-z]):\/(.*)$/.exec(f);
    if (m) { set.add(`/${m[1].toLowerCase()}/${m[2]}`); set.add(`/${m[1].toUpperCase()}/${m[2]}`); }
    set.add(JSON.stringify(f).slice(1, -1));
  }
  return [...set].filter(Boolean);
}

// a Windows spelling matches with any separator (\, \\ or /) between its parts, so mixed forms are found too
const sepFree = s => new RegExp(s.split(/\\\\|\\|\//).map(esc).join('(?:\\\\\\\\|\\\\|/)'), 'gi');

/**
 * folders: [{ path | paths: [...], token }]. Returns norm(text). On win32 every folder is replaced in all its forms, case ignored,
 * longest first (a folder inside another wins); the rest of such a path gets / for \ and a .cmd/.exe ending is dropped. A path that
 * starts at a drive letter and is written //c/x/... leaves one / before the token, exactly as //tmp/x does on Linux.
 */
export function makeNormaliser(folders, platform = process.platform) {
  const win = platform === 'win32';
  const rules = [];
  for (const { path: one, paths, token } of folders) for (const p of (paths || [one])) for (const s of spellings(String(p), win)) rules.push({ s, token });
  rules.sort((a, b) => b.s.length - a.s.length);
  return text => {
    let t = String(text);
    for (const { s, token } of rules) t = win ? t.replace(sepFree(s), token) : t.split(s).join(token);
    if (win) {
      t = t.replace(/(<[A-Z_]+>)((?:\\\\|\\|\/)[\w .~@-]+)+/g, m => m.replace(/\\\\|\\/g, '/'));
      t = t.replace(/(<[A-Z_]+>[\w/ .~@-]*?)\.(?:cmd|exe)(?![\w.])/gi, '$1');
    }
    return t;
  };
}

/** Windows ignores the case of environment names and cmd.exe adds PROMPT when it runs a .cmd shim: there, fold names to upper case (duplicates merged) and drop PROMPT. */
export function foldEnv(env, platform = process.platform) {
  if (platform !== 'win32' || !env || typeof env !== 'object') return env;
  const out = {};
  for (const [k, v] of Object.entries(env)) if (k.toUpperCase() !== 'PROMPT') out[k.toUpperCase()] = v;
  return out;
}

/** foldEnv over a whole record: every env / fullEnv object, and the per-set-up maps `envs` and `fullEnvs`. Applied to both sides of a comparison. */
export function canonical(value, platform = process.platform, key = '') {
  if (platform !== 'win32' || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => canonical(v, platform));
  if (key === 'env' || key === 'fullEnv') return foldEnv(value, platform);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = (key === 'envs' || key === 'fullEnvs') ? foldEnv(v, platform) : canonical(v, platform, k);
  return out;
}
