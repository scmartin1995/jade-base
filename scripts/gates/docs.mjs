// Gate: the documents must not name anything that does not exist. Every Markdown file in the repo
// is read, and these must be real:
//   - a repo path (a file or folder that starts with a top-level repo folder), and the target of every Markdown link
//   - an npm script (`npm run <name>`, `npm test`, `npm start`)
//   - a test command: `node --test` must carry `--import ./test/setup.js` (without it a test could reach a real `claude` and real data); `npm run test:one -- <file>` is the short form
//   - a route written `GET /api/...` (or any method), or a bare /api/... route, against the routes the server registers
//   - a setting key written like `chat.effort`, when its first word is a real setting group, against the defaults the server has
// A placeholder (<id>, *, {x}, ...) is skipped. No line numbers: a path followed by :12 is refused, because a line number goes stale at once.
// JADE_GATE_ROOT points the gate at another copy of the tree (the test of this gate uses it); it must be a git work tree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.JADE_GATE_ROOT ? path.resolve(process.env.JADE_GATE_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Not checked: the plan this base was cut from (history, kept as written, its paths belong to another tree) and the agents' own prompts.
const SKIP_DOCS = [/^agents\//];   // agents/ holds prompts for the agents, not documents

const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
if (ls.status !== 0) { console.log(JSON.stringify({ pass: false, details: { error: 'git ls-files failed: ' + (ls.stderr || '').trim() } })); process.exit(1); }
const files = ls.stdout.split('\0').filter(f => f && fs.existsSync(path.join(ROOT, f)));
const fileSet = new Set(files);
const dirSet = new Set();
for (const f of files) { let d = path.posix.dirname(f); while (d && d !== '.' && !dirSet.has(d)) { dirSet.add(d); d = path.posix.dirname(d); } }
const tops = new Set(files.map(f => f.split('/')[0]));
const topDirs = new Set([...tops].filter(t => dirSet.has(t)));
const exists = rel => fileSet.has(rel) || dirSet.has(rel);

// ---- what the code really has: npm scripts, routes, settings
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const scripts = new Set(Object.keys(pkg.scripts || {}));

const routes = [];   // { method, re }
const compile = pattern => { const star = pattern.endsWith('*'); return new RegExp('^' + pattern.replace(/\*$/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, '[^/]+') + (star ? '.*' : '') + '$'); };
const ROUTE_CALL = /\bon\(\s*'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*'([^']+)'/g;
for (const f of files.filter(f => /^server\/.*\.m?js$/.test(f))) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of text.matchAll(ROUTE_CALL)) routes.push({ method: m[1], re: compile(m[2]) });
}
// answered inside the server's own dispatcher rather than registered with on(): found by their literal path
for (const [method, p] of [['GET', '/api/events'], ['GET', '/api/files/raw'], ['GET', '/api/voice/model.tar.gz']]) {
  const text = fs.readFileSync(path.join(ROOT, p === '/api/events' ? 'server/index.js' : 'server/api.js'), 'utf8');
  if (text.includes(`'${p}'`)) routes.push({ method, re: compile(p) });
}

// the defaults the server starts with, including the ones each module brings
let defaults = {};
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-docs-gate-'));
  process.env.JADE_HOME = path.join(tmp, 'home'); process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
  try {
    const config = await import(pathToFileURL(path.join(ROOT, 'server/core/config.js')).href);
    await import(pathToFileURL(path.join(ROOT, 'server/core/modules.js')).href);   // reading the manifests adds every module's defaults
    defaults = config.DEFAULTS;
  } catch (e) { console.log(JSON.stringify({ pass: false, details: { error: 'could not read the settings the server has: ' + e.message } })); process.exit(1); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
// names the server exports (functions, constants): `agents.prepare` is a call, not a setting
const exported = new Set();
for (const f of files.filter(f => /^server\/.*\.m?js$/.test(f))) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) exported.add(n); }
}
const FILE_ENDINGS = new Set(['js', 'mjs', 'json', 'jsonl', 'md', 'env', 'html', 'css', 'tmp', 'pid', 'log', 'cmd', 'sh', 'yml', 'txt']);
const isPlain = v => v && typeof v === 'object' && !Array.isArray(v);
/** Is this dotted name a setting? Walks the defaults; a group with nothing in it by default (output.rules, modules, schedules) takes any name below it. */
function settingExists(dotted) {
  let at = defaults;
  for (const k of dotted.split('.')) {
    if (!isPlain(at) || !Object.keys(at).length) return true;
    if (!Object.hasOwn(at, k)) return false;
    at = at[k];
  }
  return true;
}

// ---- reading the documents
const PLACEHOLDER = /[<>*{}$…]|\.\.\.|\bXXX\b/;
const METHODS = 'GET|POST|PUT|PATCH|DELETE';
const problems = [];
let docs = 0, checked = 0;

for (const doc of files.filter(f => /\.md$/i.test(f) && !SKIP_DOCS.some(re => re.test(f)))) {
  docs++;
  const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
  const lines = text.split('\n');
  const bad = (i, what, token) => problems.push(`${doc}:${i + 1}: ${what} \`${token}\``);
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }

    // -- routes: "GET /api/x" (method and path), and a bare /api/x
    const seen = new Set();
    for (const m of line.matchAll(new RegExp(`\\b(${METHODS})\\s+(/(?:api|modules)/[^\\s\`'")\\],;]*)`, 'g'))) {
      if (/\.\.\.|…/.test(m[2])) continue;   // "GET /api/..." stands for all of them
      let p = m[2].replace(/[.:]+$/, '').split('?')[0];
      seen.add(p);
      if (p.endsWith('/') || (PLACEHOLDER.test(p) && !/[<{]/.test(p))) continue;   // a prefix, or a pattern with a wildcard
      checked++;
      const probe = p.replace(/<[^>]*>|\{[^}]*\}/g, 'x').replace(/:\w+/g, 'x').replace(/\*/g, 'x');
      if (!routes.some(r => r.method === m[1] && r.re.test(probe))) bad(i, `no route ${m[1]}`, p);
    }
    if (!fenced) for (const m of line.matchAll(/(?<![\w./-])(\/api\/[^\s`'")\],;]*)/g)) {   // a code sample may invent a route (the Stopwatch example)
      if (/\.\.\.|…/.test(m[1])) continue;
      let p = m[1].replace(/[.:]+$/, '').split('?')[0];
      if (seen.has(p) || p.endsWith('/') || (PLACEHOLDER.test(p) && !/[<{]/.test(p))) continue;
      if (p === '/api') continue;
      checked++;
      const probe = p.replace(/<[^>]*>|\{[^}]*\}/g, 'x').replace(/:\w+/g, 'x');
      if (!routes.some(r => r.re.test(probe))) bad(i, 'no route', p);
    }

    // -- a test command without the set-up that keeps tests away from real data and a real `claude`
    if (/\bnode\s+(?:--[\w=.-]+\s+)*--test\b/.test(line) && !/--import[ =]\.\/test\/setup\.js/.test(line)) {
      checked++;
      bad(i, 'a test command without the set-up import (use `npm run test:one -- <file>`, or add `--import ./test/setup.js`):', line.trim().slice(0, 80));
    }

    // -- npm scripts
    for (const m of line.matchAll(/\bnpm\s+(run(?:-script)?\s+)?([a-z][\w:-]*)/g)) {
      const name = m[2];
      if (!m[1] && !['test', 'start', 'stop', 'restart'].includes(name)) continue;   // npm install, npm i, ...: not a script
      checked++;
      if (!scripts.has(name)) bad(i, 'no npm script', `npm ${m[1] ? 'run ' : ''}${name}`);
    }

    // -- settings: `a.b` whose first word is a real setting group
    if (!fenced) for (const m of line.matchAll(/`([a-z][A-Za-z]*(?:\.[a-z][A-Za-z0-9]*)+)`/g)) {
      const key = m[1], parts = key.split('.');
      if (!Object.hasOwn(defaults, parts[0])) continue;   // not under a setting group: not for this check
      if (FILE_ENDINGS.has(parts[1]) || (parts.length === 2 && exported.has(parts[1]))) continue;   // a file name or a function of the server
      checked++;
      if (!settingExists(key)) bad(i, 'no such setting (or function)', key);
    }

    // -- Markdown links: the target is relative to the document that holds it
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].replace(/#.*$/, '');
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || PLACEHOLDER.test(target)) continue;
      checked++;
      if (!exists(path.posix.normalize(path.posix.join(path.posix.dirname(doc), target)).replace(/\/+$/, ''))) bad(i, 'a link to a file that is not there:', target);
    }

    // -- repo paths, token by token: only a token that starts with a top-level repo folder is a repo path
    for (const raw of line.split(/[\s`()[\]"',;|]+/)) {
      if (!raw || PLACEHOLDER.test(raw)) continue;
      const token = raw.replace(/[.,:;!?]+$/, '').replace(/#.*$/, '');
      const lineNo = /^(.*\.(?:m?js|json|md|sh|cmd)):\d+(?::\d+)?$/.exec(token);
      if (lineNo && (topDirs.has(lineNo[1].split('/')[0]) || fileSet.has(lineNo[1]))) { bad(i, 'a line number goes stale; name the function instead:', token); continue; }
      if (!token.includes('/') || !topDirs.has(token.split('/')[0])) continue;
      checked++;
      if (!exists(token.replace(/\/+$/, ''))) bad(i, 'no such path', token);
    }
  });
}

const pass = !problems.length;
console.log(JSON.stringify({ pass, details: { docs, checked, routes: routes.length, problems } }));
process.exit(pass ? 0 : 1);
