// Runs the tests the same way on every Node (20+) and system: lists the test
// files itself (no shell globbing, no --test glob support) and starts
// `node --test --import ./test/setup.js <files>`. Extra arguments are files to
// run instead of all of them; output and exit code pass straight through.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const all = args.length === 0;
const files = all
  ? readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.js')).sort().map((f) => join('test', f))
  : args;
const r = spawnSync(process.execPath, ['--test', '--import', './test/setup.js', ...files], { cwd: root, stdio: 'inherit' });
if (r.error) { console.error(r.error.message); process.exit(1); }
process.exit(r.status ?? 1);
