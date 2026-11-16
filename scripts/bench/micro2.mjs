// Second set of direct timings: what a few simple changes would save, estimated without editing the repo.
// Usage: node micro2.mjs --repo <worktree> --data <seeded root>
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const arg = k => process.argv[process.argv.indexOf('--' + k) + 1];
const repo = path.resolve(arg('repo')), root = path.resolve(arg('data'));
fs.mkdirSync(path.join(root, 'userhome'), { recursive: true });
process.env.JADE_HOME = path.join(root, 'home'); process.env.JADE_CLAUDE_HOME = path.join(root, 'claude'); process.env.HOME = path.join(root, 'userhome'); process.env.JADE_TOKEN = 'x';
const imp = f => import(pathToFileURL(path.join(repo, 'server', 'core', f)).href);
const [config, store, files, memory, search] = await Promise.all(['config.js', 'store.js', 'files.js', 'memory.js', 'search.js'].map(imp));
config.load(); store.init();
const out = {};
const time = (name, f, n = 1) => { const ms = []; for (let i = 0; i < n; i++) { const t = performance.now(); f(); ms.push(performance.now() - t); } ms.sort((a, b) => a - b); out[name] = { n, medianMs: +ms[Math.floor(n / 2)].toFixed(2), worstMs: +ms.at(-1).toFixed(2) }; console.error(name, JSON.stringify(out[name])); };
const big = path.join(root, 'work', 'bigproject');
// the walk alone, with the repo's per-file isSecret, versus a once-per-scan secret list compared as strings
const walk = (dir, check) => { let n = 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) n += walk(p, check); else if (!check(p)) { fs.statSync(p); n++; } } return n; };
time('walk 20,000 files: stat each + files.isSecret each (as now)', () => walk(big, files.isSecret), 2);
const secrets = [path.join(config.JADE_HOME, '.state'), path.join(config.JADE_HOME, 'engine.env')].map(s => { try { return fs.realpathSync(s); } catch { return s; } });
time('walk 20,000 files: stat each + string compare to 2 secret paths', () => walk(big, p => secrets.some(s => p === s || p.startsWith(s + path.sep))), 2);
time('walk 20,000 files: names only (readdir withFileTypes, no stat)', () => { const w = d => { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? w(path.join(d, e.name)) : 1; return n; }; return w(big); }, 3);
// chats: one parse of chats.json and what a reply costs
time('JSON.parse chats.json (5.4 MB)', () => JSON.parse(fs.readFileSync(path.join(config.STATE, 'chats.json'), 'utf8')), 5);
const parsed = JSON.parse(fs.readFileSync(path.join(config.STATE, 'chats.json'), 'utf8'));
time('JSON.stringify(chats, null, 2) + write', () => fs.writeFileSync(path.join(config.STATE, 'chats.tmp'), JSON.stringify(parsed, null, 2)), 5);
time('JSON.stringify(chats) compact + write', () => fs.writeFileSync(path.join(config.STATE, 'chats.tmp'), JSON.stringify(parsed)), 5);
// search for a word that is in no chat: every thread is fetched with its own full parse
time('search.search("zzqqx") a word in no chat (50 parses of chats.json)', () => search.search('zzqqx', { limit: 12 }), 3);
time('search.search("budget review") a common phrase', () => search.search('budget review', { limit: 12 }), 3);
// memory: unchanged rebuild after the first
memory.rebuild();
time('memory.rebuild, nothing changed, with ~110 text-less PDFs retried', () => memory.rebuild(), 3);
console.log(JSON.stringify(out, null, 2));
process.exit(0);
