// The provider file (how Claude Code reaches Claude) and model discovery parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-provider-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const provider = await import('../server/core/provider.js');
const models = await import('../server/core/models.js');
config.load();

test('my Claude plan writes no routing variables', () => {
  const d = provider.configure({ style: 'plan' });
  assert.equal(d.style, 'plan'); assert.equal(d.mode, 'subscription'); assert.equal(d.hasKey, false);
  assert.deepEqual(Object.keys(provider.read()), []);
});

test('an Anthropic-format gateway: address + bearer token, model pins, headers', () => {
  const d = provider.configure({ style: 'gateway', format: 'anthropic', baseUrl: 'https://gw.example.com/', key: 'sk-gateway-1234', keyKind: 'token', headers: 'X-Org-Route: prod', models: { standard: 'claude-sonnet-4-6' } });
  const e = provider.read();
  assert.equal(e.ANTHROPIC_BASE_URL, 'https://gw.example.com');
  assert.equal(e.ANTHROPIC_AUTH_TOKEN, 'sk-gateway-1234');
  assert.equal(e.ANTHROPIC_DEFAULT_SONNET_MODEL, 'claude-sonnet-4-6');
  assert.equal(e.ANTHROPIC_CUSTOM_HEADERS, 'X-Org-Route: prod');
  assert.equal(e.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
  assert.equal(d.mode, 'gateway'); assert.equal(d.keyHint, '…1234'); assert.equal(d.keyKind, 'token');
  // a blank key keeps the saved one; switching to x-api-key moves it
  provider.configure({ style: 'gateway', format: 'anthropic', baseUrl: 'https://gw.example.com', key: '', keyKind: 'x-api-key' });
  assert.equal(provider.read().ANTHROPIC_API_KEY, 'sk-gateway-1234'); assert.equal(provider.read().ANTHROPIC_AUTH_TOKEN, undefined);
  assert.throws(() => provider.configure({ style: 'gateway', baseUrl: 'https://x', key: 'k', headers: 'Authorization: Bearer x' }), /key goes in the key box/);
});

test('a Bedrock-format gateway, and Amazon Bedrock itself with a Bedrock API key', () => {
  provider.configure({ style: 'gateway', format: 'bedrock', baseUrl: 'https://gw.example.com/bedrock', key: 'tok-9999', keyKind: 'token', region: 'us-east-1' });
  let e = provider.read();
  assert.equal(e.CLAUDE_CODE_USE_BEDROCK, '1'); assert.equal(e.CLAUDE_CODE_SKIP_BEDROCK_AUTH, '1');
  assert.equal(e.ANTHROPIC_BEDROCK_BASE_URL, 'https://gw.example.com/bedrock'); assert.equal(e.ANTHROPIC_AUTH_TOKEN, 'tok-9999'); assert.equal(e.AWS_REGION, 'us-east-1');
  assert.equal(provider.mode(), 'bedrock-gateway'); assert.equal(provider.describe().format, 'bedrock');
  provider.configure({ style: 'gateway', format: 'bedrock', baseUrl: '', key: 'bedrock-api-key-0001', keyKind: 'bedrock-key', region: 'eu-west-1' });
  e = provider.read();
  assert.equal(e.AWS_BEARER_TOKEN_BEDROCK, 'bedrock-api-key-0001'); assert.equal(e.ANTHROPIC_BEDROCK_BASE_URL, undefined);
  assert.equal(provider.mode(), 'bedrock'); assert.equal(provider.describe().keyKind, 'bedrock-key');
  assert.throws(() => provider.configure({ style: 'gateway', format: 'anthropic', baseUrl: '', key: 'k', keyKind: 'token' }), /address/);
  // an Anthropic API key with no address: straight to Anthropic, no gateway variables
  provider.configure({ style: 'plan' });
  provider.configure({ style: 'gateway', format: 'anthropic', baseUrl: '', key: 'sk-ant-direct-0001', keyKind: 'x-api-key' });
  assert.equal(provider.read().ANTHROPIC_API_KEY, 'sk-ant-direct-0001'); assert.equal(provider.read().ANTHROPIC_BASE_URL, undefined);
  // model overrides ride along in the engine's settings, not the environment
  provider.configure({ style: 'plan' });
  provider.configure({ style: 'gateway', format: 'bedrock', baseUrl: 'https://gw.example.com/bedrock', key: 't', keyKind: 'token', models: { standard: 'us.anthropic.claude-sonnet-4-6' }, modelOverrides: { 'claude-opus-4-7': 'arn:aws:bedrock:us-east-2:123456789012:application-inference-profile/opus-47' } });
  assert.deepEqual(provider.engineSettings(), { skipWebFetchPreflight: true, modelOverrides: { 'claude-opus-4-7': 'arn:aws:bedrock:us-east-2:123456789012:application-inference-profile/opus-47' } });
  provider.configure({ style: 'plan' });
  assert.deepEqual(provider.engineSettings(), { skipWebFetchPreflight: true });
});

test('scrub removes every routing variable from an environment', () => {
  const env = provider.scrub({ PATH: '/bin', ANTHROPIC_API_KEY: 'stray', AWS_REGION: 'us-west-2', CLAUDE_CODE_USE_BEDROCK: '1', HOME: '/h' });
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'PATH']);
});

test('model discovery: Claude Code\'s /model answer and suggestions from an endpoint list', () => {
  const r = models.parseModelText('Current model: `Fable 5.1`\nUsage: /model <name>. Available: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], fable[1m], opusplan, default, or a full model ID.');
  assert.equal(r.current, 'Fable 5.1');
  assert.deepEqual(r.aliases, ['sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan']);
  const s = models.suggest(['us.anthropic.claude-haiku-4-5-20251001-v1:0', 'us.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-opus-4-8', 'us.anthropic.claude-opus-4-6', 'claude-sonnet-5-5']);
  assert.equal(s.light, 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
  assert.equal(s.standard, 'claude-sonnet-5-5');
  assert.equal(s.strong, 'us.anthropic.claude-opus-4-8');
});

test('no model name is built in: the default is empty and the everyday model comes only from discovery', async () => {
  assert.equal(config.DEFAULTS.models.claude, '');
  assert.deepEqual(Object.keys(config.DEFAULTS.models), ['claude'], 'only the claude engine has a default model');
  assert.equal(models.everyday({ aliases: [], models: [] }), '', 'nothing discovered: Claude Code\'s own default applies');
  assert.equal(models.everyday({ aliases: ['opus', 'sonnet', 'haiku'], models: ['us.anthropic.claude-sonnet-4-6'] }), 'sonnet', 'Claude Code\'s own names first');
  assert.equal(models.everyday({ aliases: [], models: ['us.anthropic.claude-haiku-4-5', 'us.anthropic.claude-sonnet-4-5', 'us.anthropic.claude-sonnet-4-6'] }), 'us.anthropic.claude-sonnet-4-6');
  assert.equal(models.everyday({ aliases: ['alpha', 'beta'], models: [] }), 'alpha', 'else simply the first discovered');
  // with a plan login the empty choice resolves at run time from what was found, and to nothing when nothing was
  provider.configure({ style: 'plan' });
  const engines = await import('../server/core/engines.js');
  fs.mkdirSync(config.STATE, { recursive: true });
  fs.rmSync(path.join(config.STATE, 'models.json'), { force: true });
  assert.equal(engines.engineModel(''), '');
  assert.ok(!engines.claudeArgs({}).includes('--model'));
  fs.writeFileSync(path.join(config.STATE, 'models.json'), JSON.stringify({ aliases: ['opus', 'sonnet'], models: [] }));
  assert.equal(engines.engineModel(''), 'sonnet');
  assert.equal(engines.engineModel('opus'), 'opus', 'a chosen model is passed through as before');
  const args = engines.claudeArgs({});
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
});

test('with no models found the picker list is empty (the UI then says so), never a built-in list', () => {
  fs.writeFileSync(path.join(config.STATE, 'models.json'), JSON.stringify({ aliases: [], models: [] }));
  assert.deepEqual(models.choices().choices, []);
});
