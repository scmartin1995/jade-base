// Runs the tests the same way on every Node (20+) and system: lists the test files itself (no shell globbing, no --test glob support)
// and starts `node --test --import ./test/setup.js <files>`. Extra arguments are files to run instead of all of them; output and exit
// code pass straight through.
// A run that stops moving does not hang silently: a test that takes more than JADE_TEST_TIMEOUT_MIN minutes (default 12; `--test-timeout`,
// where this Node has it) fails, and when nothing at all is printed for JADE_TEST_STALL_MIN minutes (default 10) or the whole run passes
// JADE_TEST_LIMIT_MIN minutes (default 17) the files that were last seen are named, the test processes are stopped and the exit code is 1.
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const all = args.length === 0;
const files = all
  ? readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.js')).sort().map((f) => join('test', f))
  : args;
const minutes = (name, dflt) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : dflt) * 60000;
const PER_TEST = minutes('JADE_TEST_TIMEOUT_MIN', 12), STALL = minutes('JADE_TEST_STALL_MIN', 10), LIMIT = minutes('JADE_TEST_LIMIT_MIN', 17);

const help = spawnSync(process.execPath, ['--help'], { encoding: 'utf8' }).stdout || '';
const dir = mkdtempSync(join(tmpdir(), 'jade-testrun-'));
const statusFile = join(dir, 'status.json');
const nodeArgs = ['--test', ...(help.includes('--test-timeout') ? [`--test-timeout=${PER_TEST}`] : []), `--test-reporter=${pathToFileURL(join(root, 'scripts', 'test-reporter.mjs')).href}`, '--test-reporter-destination=stdout', '--import', './test/setup.js', ...files];
const child = spawn(process.execPath, nodeArgs, { cwd: root, stdio: ['inherit', 'pipe', 'inherit'], env: { ...process.env, JADE_TEST_STATUS: statusFile } });
let lastOutput = Date.now();
const started = Date.now();
child.stdout.on('data', (d) => { lastOutput = Date.now(); process.stdout.write(d); });

function stop() {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });   // the whole tree, so no test process stays behind
  else child.kill('SIGKILL');
}
function giveUp(why) {
  let seen = {};
  try { seen = JSON.parse(readFileSync(statusFile, 'utf8')); } catch { /* none written */ }
  const rows = Object.entries(seen).sort((a, b) => a[1].at - b[1].at).slice(0, 6);
  console.error(`\nThe test run ${why}. Test files by how long ago they last did anything (the first ones are the ones it is waiting for):`);
  for (const [f, v] of rows) console.error(`  ${f}: ${Math.round((Date.now() - v.at) / 1000)} s ago, last ${v.event.replace('test:', '')} "${v.last}"`);
  if (!rows.length) console.error('  (no test had started)');
  stop();
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}
const watch = setInterval(() => {
  if (Date.now() - started > LIMIT) giveUp(`ran longer than ${LIMIT / 60000} minutes`);
  else if (Date.now() - lastOutput > STALL) giveUp(`printed nothing for ${STALL / 60000} minutes`);
}, 5000);
child.on('error', (e) => { console.error(e.message); process.exit(1); });
child.on('exit', (code, signal) => { clearInterval(watch); rmSync(dir, { recursive: true, force: true }); process.exit(code ?? (signal ? 1 : 1)); });
