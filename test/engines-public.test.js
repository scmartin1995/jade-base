// Claude Code's command line, the way Jade starts it, Diagnose, and the page that opens Jade: through their public functions, with a
// stand-in `claude` (never a real one). The Bedrock and gateway output itself is pinned by provider-parity.test.js; these say what each
// piece does and what it must not do.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitFor } from './helpers/server.js';
import { writeStub } from './helpers/stub.js';
import { removeDir } from './helpers/rm.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-engpub-'));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
// the stand-in: --version answers; `auth` and `mcp` answer nothing; any run prints an error with a key in it, so the masking is seen
writeStub(bin, 'claude', `const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('9.9.9 (stand-in)'); process.exit(0); }
if (a[0] === 'auth') { process.stdout.write('{}'); process.exit(0); }
if (a[0] === 'mcp') process.exit(0);
require('fs').appendFileSync(${JSON.stringify(path.join(tmp, 'env.json'))}, JSON.stringify({ argv: a, env: process.env }) + '\\n');
process.stdin.resume(); process.stdin.on('end', () => { console.error('Error: 401 invalid key sk-standinsecretkey123456 for gateway'); process.exit(1); });
`);
process.env.PATH = bin + path.delimiter + process.env.PATH;
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
process.env.JADE_TOKEN = 'server-key-for-this-test';
const config = await import('../server/core/config.js');
const engines = await import('../server/core/engines.js');
const provider = await import('../server/core/provider.js');
const opener = await import('../server/core/opener.js');
config.load();
after(() => removeDir(tmp));
const val = (a, flag) => a[a.indexOf(flag) + 1];

// ---------------------------------------------------------------- claudeArgs
test('a read-only run: the read tools only, writes and key files refused, no connectors, settings in a file', () => {
  const a = engines.claudeArgs({});
  assert.deepEqual(a.slice(0, 7), ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--allowedTools', 'Read,Glob,Grep']);
  assert.match(val(a, '--disallowedTools'), /^Bash,Edit,Write,NotebookEdit$/);
  assert.ok(a.includes('--strict-mcp-config'));
  assert.equal(fs.readFileSync(val(a, '--mcp-config'), 'utf8'), '{"mcpServers":{}}');
  assert.deepEqual(JSON.parse(fs.readFileSync(val(a, '--settings'), 'utf8')), provider.engineSettings());
  assert.ok(!a.includes('--permission-prompt-tool') && !a.includes('--input-format'));
  assert.equal(a.cleanup, undefined);
});

test('a run that may edit asks Jade before every change, with its own tool config that holds no key, removed when the run ends', () => {
  const a = engines.claudeArgs({ edits: true, job: 'j-1', stream: true });
  assert.equal(val(a, '--permission-prompt-tool'), 'mcp__jade__approve');
  assert.equal(val(a, '--permission-mode'), 'manual');
  assert.equal(val(a, '--input-format'), 'stream-json');
  assert.match(val(a, '--disallowedTools'), /AskUserQuestion/);
  const file = val(a, '--mcp-config');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes(process.env.JADE_TOKEN), 'no key in the tool config');
  assert.equal(JSON.parse(text).mcpServers.jade.env.JADE_JOB, 'j-1');
  assert.equal(typeof a.cleanup, 'function');
  a.cleanup();
  return waitFor(() => !fs.existsSync(file) || null, { message: 'the tool config to be removed with the run' });
});

test('no file reading and web off are named as refused; added folders must exist; a system prompt goes to a file that is removed after', () => {
  const real = path.join(tmp, 'work'); fs.mkdirSync(real);
  const a = engines.claudeArgs({ noRead: true, denyWeb: true, dirs: [real, path.join(tmp, 'missing')], system: 'Be brief.' });
  assert.equal(val(a, '--allowedTools'), '');
  assert.match(val(a, '--disallowedTools'), /Read,Glob,Grep/); assert.match(val(a, '--disallowedTools'), /WebSearch,WebFetch/);
  assert.deepEqual(a.filter((x, i) => a[i - 1] === '--add-dir'), [real]);
  const f = val(a, '--append-system-prompt-file');
  assert.equal(fs.readFileSync(f, 'utf8'), 'Be brief.');
  a.cleanup();
  return waitFor(() => !fs.existsSync(f) || null, { message: 'the system prompt file to be removed' });
});

test('a connector adds its tools; on Bedrock the web search tool is left out', () => {
  const some = Object.keys(engines.CONNECTOR_TOOLS).find(c => engines.CONNECTOR_TOOLS[c].length);
  assert.ok(engines.claudeArgs({ connectors: [some] })[engines.claudeArgs({ connectors: [some] }).indexOf('--allowedTools') + 1].includes(engines.CONNECTOR_TOOLS[some][0]));
  fs.mkdirSync(config.JADE_HOME, { recursive: true });
  fs.writeFileSync(provider.FILE, 'CLAUDE_CODE_USE_BEDROCK=1\nAWS_REGION=eu-west-1\n');
  assert.equal(provider.mode(), 'bedrock');
  assert.ok(!engines.claudeArgs({ connectors: ['web'] })[engines.claudeArgs({ connectors: ['web'] }).indexOf('--allowedTools') + 1].includes('WebSearch'));
  fs.rmSync(provider.FILE);
});

test('effort is a flag only for a known level and not for Haiku; a model is sent only when one is chosen or found', () => {
  assert.equal(val(engines.claudeArgs({ effort: 'high', model: 'claude-sonnet-x' }), '--effort'), 'high');
  assert.ok(!engines.claudeArgs({ effort: 'extreme', model: 'claude-sonnet-x' }).includes('--effort'));
  assert.ok(!engines.claudeArgs({ effort: 'high', model: 'claude-haiku-x' }).includes('--effort'));
  assert.equal(val(engines.claudeArgs({ model: 'claude-opus-y' }), '--model'), 'claude-opus-y');
  assert.deepEqual(engines.effortArgs('low', 'm'), ['--effort', 'low']);
  assert.deepEqual(engines.effortArgs('', 'm'), []);
});

test('the deny rules cover the connection file and the whole state folder', () => {
  const rules = engines.secretReadDenies();
  assert.equal(rules.length, 2);
  assert.ok(rules[0].startsWith('Read(/') && rules[0].includes('engine.env'));
  assert.ok(rules[1].endsWith('/.state/**)'));
});

// ---------------------------------------------------------------- starting it
test('quoteCmdArg quotes what cmd.exe would misread and leaves plain words alone', () => {
  assert.equal(engines.quoteCmdArg('plain'), 'plain');
  assert.equal(engines.quoteCmdArg('two words'), '"two words"');
  assert.equal(engines.quoteCmdArg('a"b'), '"a""b"');
  assert.equal(engines.quoteCmdArg('a%b'), '"a"%^"b"');
  assert.equal(engines.quoteCmdArg(''), '""');
  assert.equal(engines.quoteCmdArg('x&y'), '"x&y"');
});

test('a started run never gets the server key; the routing comes from Jade\'s own settings, not from stray variables on this computer', async () => {
  process.env.ANTHROPIC_BASE_URL = 'https://stray.example.com'; process.env.CLAUDECODE = '1';
  const p = engines.spawnCli((await import('../server/core/util.js')).which('claude'), ['-p', 'x'], { stdio: ['pipe', 'ignore', 'ignore'] });
  p.stdin.end('hi');
  await new Promise(r => p.on('close', r));
  delete process.env.ANTHROPIC_BASE_URL; delete process.env.CLAUDECODE;
  const seen = JSON.parse(fs.readFileSync(path.join(tmp, 'env.json'), 'utf8').trim().split('\n').pop()).env;
  assert.equal(seen.JADE_TOKEN, undefined, 'no server key');
  assert.equal(seen.CLAUDECODE, undefined);
  assert.equal(seen.ANTHROPIC_BASE_URL, undefined, 'a stray address on this computer does not redirect the run');
  assert.equal(seen.MCP_TOOL_TIMEOUT, String(11 * 60e3));
});

// ---------------------------------------------------------------- Diagnose
test('Diagnose reports the version, the connection and the failed check in the engine\'s words, with every key hidden, and never throws', async () => {
  fs.writeFileSync(provider.FILE, 'ANTHROPIC_BASE_URL=http://127.0.0.1:9\nANTHROPIC_AUTH_TOKEN=gateway-token-abcdef123456\n');
  const d = await engines.diagnose();
  assert.match(d.report, /^Jade diagnose · /);
  assert.match(d.report, /claude --version: 9\.9\.9 \(stand-in\)/);
  assert.match(d.report, /provider: .*style gateway/);
  assert.match(d.report, /check: FAILED/);
  assert.match(d.report, /engine env \(names only\):.*ANTHROPIC_BASE_URL/);
  for (const secret of ['gateway-token-abcdef123456', 'sk-standinsecretkey123456', process.env.JADE_TOKEN]) assert.ok(!d.report.includes(secret), `the report holds ${secret}`);
  fs.rmSync(provider.FILE);
});

// ---------------------------------------------------------------- the opener
test('the opener writes a private page that moves on to the start link, and its address carries no key', () => {
  const url = opener.openerUrl(4999);
  assert.match(url, /^file:\/\/.*open\.html$/);
  assert.ok(!url.includes(process.env.JADE_TOKEN), 'the address is not where the key is');
  const file = path.join(config.STATE, 'open.html');
  const html = fs.readFileSync(file, 'utf8');
  assert.ok(html.includes('http://127.0.0.1:4999/?key=') && html.includes(process.env.JADE_TOKEN));
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /http-equiv="refresh"/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'owner only');
  // writing again replaces the page (a new port)
  opener.openerUrl(5001);
  assert.ok(fs.readFileSync(file, 'utf8').includes(':5001/?key='));
});
