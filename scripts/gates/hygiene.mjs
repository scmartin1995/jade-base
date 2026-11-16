// Gate: no personal material in tracked files: a real-looking home path, an e-mail address that is not a placeholder,
// a key or token, a session or scratchpad temp path. Generic example paths (/home/u/..., C:\Users\me, /Users/me) are allowed.
// Terms that belong to one person or company go in an optional, untracked file `.hygiene-terms` at the repo root
// (one term or regular expression per line, `#` starts a comment); the gate reads it when it is there.
// JADE_GATE_ROOT points the gate at another copy of the tree (the test of this gate uses it); it must be a git work tree.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.JADE_GATE_ROOT ? path.resolve(process.env.JADE_GATE_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = 'scripts/gates/hygiene.mjs';

const RULES = [
  ['a home path', new RegExp(String.raw`/home/(?!u\b|me\b|you\b|user\b|name\b|\$|<|\{|\.\.\.)[a-z][\w.-]*|/Users/(?!me\b|you\b|user\b|name\b|u\b|x\b|\$|<|\{)\w+|C:\\Users\\(?!me\b|you\b|user\b|name\b|u\b|x\b)\w+`, 'i')],
  ['an e-mail address', /[\w.+-]+@(?!(?:[\w-]+\.)*(?:example\.(?:com|org|net)|test|invalid|localhost)\b|users\.noreply\.github\.com)[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/i],
  ['a key or token', /AKIA(?![0-9A-Z]*EXAMPLE)[0-9A-Z]{16}|\bghp_(?![\w]*abcdefgh)[A-Za-z0-9]{30,}|\bxox[abprs]-(?![\w-]*(?:1234567890|abcdef))[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-ant-(?![\w-]*abcdefgh)[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\./],
  ['a session or scratchpad temp path', /\/tmp\/claude-\d*|\/scratchpad\//],
];
try {   // optional, untracked: terms that only one person or company would use
  for (const line of fs.readFileSync(path.join(ROOT, '.hygiene-terms'), 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    try { RULES.push(['a term from .hygiene-terms', new RegExp(t, 'i')]); } catch { RULES.push(['a term from .hygiene-terms', new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')]); }
  }
} catch { /* no such file: only the generic rules apply */ }

const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' });
if (ls.status !== 0) { console.log(JSON.stringify({ pass: false, details: { error: 'git ls-files failed: ' + (ls.stderr || '').trim() } })); process.exit(1); }
const found = [];
let files = 0;
for (const rel of ls.stdout.split('\0').filter(Boolean)) {
  if (rel === SELF) continue;
  let buf; try { buf = fs.readFileSync(path.join(ROOT, rel)); } catch { continue; }   // listed but deleted in this tree
  if (buf.includes(0)) continue;   // binary
  files++;
  buf.toString('utf8').split('\n').forEach((line, i) => {
    for (const [what, re] of RULES) { const m = re.exec(line); if (m) found.push(`${rel}:${i + 1}: ${what} (${m[0]})`); }
  });
}
const pass = !found.length;
console.log(JSON.stringify({ pass, details: { files, found } }));
process.exit(pass ? 0 : 1);
