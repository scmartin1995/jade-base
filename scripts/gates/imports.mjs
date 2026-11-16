// Gate: every relative import / export-from / literal dynamic import must point at a file that exists.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// JADE_GATE_ROOT points the gate at another copy of the tree (the test of this gate uses it).
const ROOT = process.env.JADE_GATE_ROOT ? path.resolve(process.env.JADE_GATE_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIRS = ['server', 'public/js', 'bridge', 'test', 'scripts'];
const SKIP = new Set(['node_modules', '.git']);

function walk(dir, out) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.m?js$/.test(e.name)) out.push(p);
  }
}
const files = [];
for (const d of DIRS) walk(path.join(ROOT, d), files);
if (fs.existsSync(path.join(ROOT, 'jade.js'))) files.push(path.join(ROOT, 'jade.js'));

const RES = [
  /\bimport\s+(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '');

const missing = [];
const shellImports = [];   // a view must never import the browser shell (public/js/app.js): it needs `window`, so no test can load the view
let checked = 0;
for (const f of files) {
  const src = strip(fs.readFileSync(f, 'utf8'));
  for (const re of RES) {
    for (const m of src.matchAll(re)) {
      const spec = m[1];
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
      checked++;
      const target = path.resolve(path.dirname(f), spec.split(/[?#]/)[0]);
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (target === path.join(ROOT, 'public/js/app.js') && /^public\/js\/(views\/|dashboard\/|dropbin\.js)/.test(rel)) shellImports.push(`${rel} -> ${spec}`);
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) missing.push(`${path.relative(ROOT, f)} -> ${spec}`);
    }
  }
}

// Views the app can route to, from how app.js routes today (viewFor in public/js/app.js): the built-in module manifests in
// server/modules/*.js. A route is a module's nav route or a key of its `views`; its file is views[route] or <route>.js, in
// public/js/views. A module's project panels name a file there too. Each of those files must exist.
const viewsMissing = [];
let viewsChecked = 0;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-imports-gate-'));
try {
  process.env.JADE_HOME = path.join(scratch, 'home'); process.env.JADE_CLAUDE_HOME = path.join(scratch, 'claude');   // reading a manifest must never touch real folders
  const modDir = path.join(ROOT, 'server/modules');
  const manifests = [];
  for (const f of fs.readdirSync(modDir).filter(f => f.endsWith('.js') && !f.startsWith('.')).sort()) {
    try { const m = (await import(pathToFileURL(path.join(modDir, f)).href)).default; if (m && m.id) manifests.push({ m, f }); else viewsMissing.push(`server/modules/${f}: no manifest`); }
    catch (e) { viewsMissing.push(`server/modules/${f}: cannot be read (${e.message})`); }
  }
  if (!manifests.length) viewsMissing.push('no module manifests found in server/modules');
  const wanted = new Map();   // file -> who asks for it
  for (const { m } of manifests) {
    const views = m.views && typeof m.views === 'object' ? m.views : {};
    for (const n of m.nav || []) wanted.set(views[n.route] || n.route + '.js', `${m.id}: route ${n.route}`);
    for (const [route, file] of Object.entries(views)) wanted.set(file, `${m.id}: route ${route}`);
    for (const p of m.projectPanels || []) wanted.set(p.view, `${m.id}: project panel ${p.id}`);
  }
  for (const [file, who] of wanted) {
    viewsChecked++;
    const f = path.join(ROOT, 'public/js/views', String(file));
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) viewsMissing.push(`${file} (${who})`);
  }
} catch (e) { viewsMissing.push('views could not be checked: ' + e.message); }
finally { fs.rmSync(scratch, { recursive: true, force: true }); }

const pass = !missing.length && !viewsMissing.length && !shellImports.length;
console.log(JSON.stringify({ pass, details: { files: files.length, importsChecked: checked, missingImports: missing, viewsChecked, missingViews: viewsMissing, viewsImportingShell: shellImports } }));
process.exit(pass ? 0 : 1);
