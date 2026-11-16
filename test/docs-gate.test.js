// The docs gate (scripts/gates/docs.mjs) keeps the documents true, so it is checked too: it must fail on a planted reference to
// a path, an npm script, a route or a setting that does not exist, and pass the real ones. It runs on a throw-away copy of the tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../scripts/gates/lib.mjs';
import { removeDir } from './helpers/rm.js';

const copyTree = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-docs-copy-'));
  const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  for (const f of ls.stdout.split('\0').filter(Boolean)) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  assert.equal(spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' }).status, 0);
  return dir;
};
const gate = root => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gates/docs.mjs')], { env: { ...process.env, JADE_GATE_ROOT: root }, encoding: 'utf8', timeout: 60000 });
  let out = {}; try { out = JSON.parse(r.stdout); } catch { /* shown by the assertion */ }
  return { status: r.status, ...out.details, pass: out.pass, raw: r.stdout + r.stderr };
};

test('docs gate: fails on a planted bad path, npm script, route and setting, naming each; the real ones pass', () => {
  const dir = copyTree();
  try {
    const before = gate(dir);
    assert.ok(before.docs >= 1 && before.checked > 0, 'it read the documents and checked something: ' + before.raw);
    const doc = path.join(dir, 'docs', 'planted.md');
    fs.writeFileSync(doc, [
      '# Planted',
      'Real: `server/core/router.js`, `npm test`, `npm run gates`, GET /api/projects, POST /api/projects/:id/dashboards, `chat.effort`, `agents.checkerEffort`.',
      'Real links: [the map](../README.md) and [a gate](../scripts/gates/docs.mjs).',
      'Bad path: `server/core/does-not-exist.js`.',
      'Bad script: `npm run no-such-script`.',
      'Bad route: GET /api/no-such-route.',
      'Wrong method: DELETE /api/models.',
      'Bad setting: `chat.effortt`.',
      'Bad link: [gone](../docs/missing-doc.md).',
      'Line number: `server/core/router.js:12`.',
      'A placeholder stands for any name: `server/modules/<id>.js`, GET /api/projects/<id>, `test/*.test.js`.',
    ].join('\n'));
    const r = gate(dir);
    assert.equal(r.status, 1, r.raw);
    const mine = r.problems.filter(p => p.startsWith('docs/planted.md:'));
    const said = what => mine.some(p => p.includes(what));
    assert.ok(said('server/core/does-not-exist.js'), 'bad path: ' + mine.join('\n'));
    assert.ok(said('npm run no-such-script'), 'bad script');
    assert.ok(said('/api/no-such-route'), 'bad route');
    assert.ok(said('DELETE') && said('/api/models'), 'a route with the wrong method');
    assert.ok(said('chat.effortt'), 'bad setting');
    assert.ok(said('missing-doc.md'), 'bad link');
    assert.ok(said('server/core/router.js:12'), 'a line number');
    assert.equal(mine.length, 7, 'only the planted ones, nothing for the real references or placeholders:\n' + mine.join('\n'));
    // taking the planted file away puts the gate back where it was
    fs.rmSync(doc);
    assert.deepEqual(gate(dir).problems, before.problems);
  } finally { removeDir(dir); }
});

test('docs gate: a route is checked against the routes the server registers, and a new route is known the moment it is registered', () => {
  const dir = copyTree();
  try {
    fs.writeFileSync(path.join(dir, 'docs', 'route.md'), 'It answers GET /api/brand-new-thing.\n');
    assert.ok(gate(dir).problems.some(p => p.includes('/api/brand-new-thing')));
    fs.appendFileSync(path.join(dir, 'server', 'modules', 'home.js'), "\nexport const later = on => on('GET', '/api/brand-new-thing', () => 1);\n");
    assert.ok(!gate(dir).problems.some(p => p.includes('/api/brand-new-thing')));
  } finally { removeDir(dir); }
});

test('docs gate: a node --test command without the set-up import is refused, with it (or as npm run test:one) it passes', () => {
  const dir = copyTree();
  try {
    const doc = path.join(dir, 'docs', 'cmd.md');
    fs.writeFileSync(doc, [
      'Good: `npm run test:one -- test/mayrun.test.js`',
      'Good: `node --test --import ./test/setup.js test/mayrun.test.js`',
      'Bad: `node --test test/mayrun.test.js`',
      '```',
      'node --test test/key-gate.test.js',
      '```',
    ].join('\n'));
    const mine = gate(dir).problems.filter(p => p.startsWith('docs/cmd.md:'));
    assert.equal(mine.length, 2, mine.join('\n'));
    assert.ok(mine.every(p => /set-up import/.test(p)));
    assert.ok(mine.some(p => p.startsWith('docs/cmd.md:3:')) && mine.some(p => p.startsWith('docs/cmd.md:5:')), 'both the inline and the fenced one');
  } finally { removeDir(dir); }
});

test('docs gate: the real documents contain no test command without the set-up, and test:one is a real script that carries it', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:one'], 'node scripts/test.mjs');   // the runner carries the set-up import and lists the files itself (no glob, so it works on Node 20 and 22)
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts/test.mjs'), 'utf8'), /--import', '\.\/test\/setup\.js'/);
  assert.equal(gate(ROOT).problems.filter(p => /set-up import/.test(p)).length, 0);
});

test('hygiene gate: a real-looking home path in a document or data file is refused, wherever it is', () => {
  const dir = copyTree();
  try {
    fs.writeFileSync(path.join(dir, 'docs', 'planted-a.md'), `See ${'/home/'}alice/some-repo/server.\n`);
    fs.mkdirSync(path.join(dir, 'docs', 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'data', 'planted-b.json'), JSON.stringify({ file: '/Users/' + 'bob/jade.js' }));
    spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });   // the hygiene gate reads the files Git tracks
    const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gates/hygiene.mjs')], { env: { ...process.env, JADE_GATE_ROOT: dir }, encoding: 'utf8' });
    assert.equal(run.status, 1, run.stdout);
    const found = JSON.parse(run.stdout).details.found;
    assert.ok(found.some(f => f.startsWith('docs/planted-a.md:')), found.join('\n'));
    assert.ok(found.some(f => f.startsWith('docs/data/planted-b.json:')), found.join('\n'));
    assert.equal(found.filter(f => !f.includes('planted-')).length, 0, 'the real tree is clean:\n' + found.join('\n'));
  } finally { removeDir(dir); }
});
