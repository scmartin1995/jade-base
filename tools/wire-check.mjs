// What the real Claude Code engine actually sends to a gateway, for the connection Jade would give it (Jade's connection checks and
// the parity test run without a real claude; this is the one tool that starts it, by hand). A throwaway Jade data folder is set up,
// the real `claude` is started exactly as Jade starts it, against a stand-in gateway on this computer that records each request and answers with an error on purpose. Nothing leaves this
// computer and no tokens are spent.
//   node tools/wire-check.mjs
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-wire-'));
for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_BEARER_TOKEN_BEDROCK']) delete process.env[k];
const config = await import('../server/core/config.js');
const provider = await import('../server/core/provider.js');
const engines = await import('../server/core/engines.js');
config.load();

let passed = 0, failed = 0;
const mask = seen => JSON.stringify(seen.map(s => ({ ...s, auth: String(s.auth).replace(/(Bearer\s+\S{3})\S*/, '$1…'), apiKey: s.apiKey ? '…' : '' })));
const check = (name, ok, extra = '') => { console.log(ok ? 'ok   ' : 'FAIL ', name, ok ? '' : extra); ok ? passed++ : failed++; };

function standIn({ profiles = null } = {}) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      let j = null; try { j = JSON.parse(body); } catch {}
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', apiKey: req.headers['x-api-key'] || '', signed: !!req.headers['x-amz-date'] || /AWS4-HMAC/.test(req.headers.authorization || ''), model: j && j.model, hdr: req.headers['x-org-route'] || '' });
      if (profiles && /^\/inference-profiles/.test(req.url)) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ inferenceProfileSummaries: profiles.map(id => ({ inferenceProfileId: id, inferenceProfileName: id })) })); }
      res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"message":"stand-in: stop here"}');
    });
  });
  return { seen, srv, start: () => new Promise(r => srv.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + srv.address().port))) };
}
async function runEngine(model) {
  try { await engines.run({ engine: 'claude', model, prompt: 'hi', signal: AbortSignal.timeout(40000) }); } catch { /* the stand-in answers with an error on purpose */ }
}
const d = engines.detect();
if (!d.claude.bin) { console.log('claude is not installed; nothing to check'); process.exit(0); }
const PINS = { light: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', standard: 'us.anthropic.claude-sonnet-4-6', strong: 'us.anthropic.claude-opus-4-8' };

// 1. a Bedrock-format gateway with a gateway token
let g = standIn(); let base = await g.start();
provider.configure({ style: 'gateway', format: 'bedrock', baseUrl: base, key: 'tok-wire-1234', keyKind: 'token', region: 'us-east-1', models: PINS, headers: 'X-Org-Route: prod' });
await runEngine('sonnet');
let calls = g.seen.filter(s => /invoke/.test(s.url));
check('Bedrock gateway, token: the request goes to the pinned model name', calls.length > 0 && calls.every(c => c.url === '/model/' + PINS.standard + '/invoke-with-response-stream'), JSON.stringify(g.seen.map(s => s.url)));
check('Bedrock gateway, token: the key is sent as a bearer token, nothing is signed with AWS, no Claude login token', calls.length > 0 && calls.every(c => c.auth === 'Bearer tok-wire-1234' && !c.signed), mask(g.seen));
check('Bedrock gateway, token: the extra header arrives', calls.length > 0 && calls.every(c => c.hdr === 'prod'), mask(calls));
check('Bedrock gateway, token: no startup probes of other models', g.seen.filter(s => /invoke/.test(s.url)).every(c => c.url.includes(PINS.standard)), JSON.stringify(g.seen.map(s => s.url)));
g.srv.close();

// 2. a Bedrock-format gateway with an Amazon Bedrock API key; the quick tier with no quick pin uses the everyday model
g = standIn(); base = await g.start();
provider.configure({ style: 'plan' }); // a blank pin keeps a saved one, so start clean
provider.configure({ style: 'gateway', format: 'bedrock', baseUrl: base, key: 'bk-wire-5678', keyKind: 'bedrock-key', region: 'us-east-1', models: { standard: PINS.standard } });
await runEngine('haiku');
calls = g.seen.filter(s => /invoke/.test(s.url));
check('Bedrock gateway, Bedrock API key: bearer token, pinned everyday model for a quick question with no quick pin', calls.length > 0 && calls.every(c => c.url === '/model/' + PINS.standard + '/invoke-with-response-stream' && c.auth === 'Bearer bk-wire-5678' && !c.signed), mask(g.seen));
g.srv.close();

// 2b. no model names typed at all: the gateway lists its inference profiles, Jade reads them and asks for the newest Sonnet
const models = await import('../server/core/models.js');
g = standIn({ profiles: ['us.anthropic.claude-haiku-4-5-20251001-v1:0', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'us.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-opus-4-8'] }); base = await g.start();
provider.configure({ style: 'plan' });
provider.configure({ style: 'gateway', format: 'bedrock', baseUrl: base, key: 'tok-wire-1234', keyKind: 'token', region: 'us-east-1' });
await models.discover();
check('Bedrock gateway, nothing typed: the endpoint\'s profile list is read and sonnet resolves to the newest Sonnet listed', engines.engineModel('sonnet') === 'us.anthropic.claude-sonnet-4-6', engines.engineModel('sonnet'));
await runEngine('sonnet');
calls = g.seen.filter(s => /invoke/.test(s.url));
check('Bedrock gateway, nothing typed: the request goes to that listed model', calls.length > 0 && calls.every(c => c.url === '/model/us.anthropic.claude-sonnet-4-6/invoke-with-response-stream'), JSON.stringify(g.seen.map(s => s.url)));
g.srv.close();

// 3. an Anthropic-format gateway: the model in the body is the pinned name
g = standIn(); base = await g.start();
provider.configure({ style: 'plan' });
provider.configure({ style: 'gateway', format: 'anthropic', baseUrl: base, key: 'tok-wire-1234', keyKind: 'token', models: { light: 'gw-quick', standard: 'gw-everyday', strong: 'gw-hard' } });
await runEngine('sonnet');
calls = g.seen.filter(s => /\/v1\/messages/.test(s.url));
check('Anthropic-format gateway: the model in the request is the pinned name, key as a bearer token', calls.length > 0 && calls.every(c => c.model === 'gw-everyday' && c.auth === 'Bearer tok-wire-1234'), mask(g.seen));
check('with a gateway the engine gets its own empty config folder, so a Claude login on this computer is never sent anywhere', /engine-home$/.test(provider.env().CLAUDE_CONFIG_DIR || ''));
provider.configure({ style: 'plan' });
check('on the Claude plan the engine uses its normal config folder, where that login is', provider.env().CLAUDE_CONFIG_DIR === undefined);
g.srv.close();

console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
try { fs.rmSync(process.env.JADE_HOME, { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);
