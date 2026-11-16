// "Use my Claude Code settings" also finds the Claude desktop app's gateway set-up (its config library), in a throwaway home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-import-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.LOCALAPPDATA = path.join(home, 'AppData', 'Local'); process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
process.env.XDG_CONFIG_HOME = path.join(home, '.config');
process.env.JADE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-import-test-'));
process.env.JADE_CLAUDE_HOME = process.env.JADE_HOME + '/claude-home';   // never read the real ~/.claude
const config = await import('../server/core/config.js');
const provider = await import('../server/core/provider.js');
config.load();

const lib = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA, 'Claude-3p', 'configLibrary')
  : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude-3p', 'configLibrary')
  : path.join(process.env.XDG_CONFIG_HOME, 'Claude-3p', 'configLibrary');
const settings = path.join(home, '.claude', 'settings.json');
function desktop(entry) {
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, '_meta.json'), JSON.stringify({ appliedId: 'abc-123', entries: [{ id: 'abc-123' }] }));
  fs.writeFileSync(path.join(lib, 'abc-123.json'), JSON.stringify(entry));
}

test('nothing on the computer: a plain sentence, no throw', () => {
  const r = provider.importClaudeSettings();
  assert.equal(r.ok, false); assert.match(r.error, /desktop app/);
});

test('the desktop app\'s gateway set-up is found when settings.json has no env', () => {
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ hooks: {}, enabledPlugins: {} }));
  desktop({ inferenceProvider: 'gateway', inferenceGatewayBaseUrl: 'https://gw.example.com/', inferenceGatewayApiKey: 'sk-desk-7777', inferenceGatewayAuthScheme: 'x-api-key' });
  const r = provider.importClaudeSettings();
  assert.equal(r.ok, true);
  assert.equal(r.found.baseUrl, 'https://gw.example.com'); assert.equal(r.found.format, 'anthropic');
  assert.equal(r.found.keyKind, 'x-api-key'); assert.equal(r.found.keyHint, '…7777'); assert.equal(r.found.key, undefined);
  assert.ok(r.notes.some(n => /desktop app/.test(n)));
  provider.useClaudeSettings();
  const e = provider.read();
  assert.equal(e.ANTHROPIC_BASE_URL, 'https://gw.example.com'); assert.equal(e.ANTHROPIC_API_KEY, 'sk-desk-7777'); assert.equal(e.ANTHROPIC_AUTH_TOKEN, undefined);
});

test('a bearer auth scheme becomes a gateway token', () => {
  desktop({ inferenceProvider: 'gateway', inferenceGatewayBaseUrl: 'https://gw.example.com', inferenceGatewayApiKey: 'tok-8888', inferenceGatewayAuthScheme: 'bearer' });
  const r = provider.importClaudeSettings();
  assert.equal(r.found.keyKind, 'token'); assert.equal(r.found.keyHint, '…8888');
});

test('settings.json that names a gateway still wins over the desktop app', () => {
  fs.writeFileSync(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://other.example.com', ANTHROPIC_AUTH_TOKEN: 'tok-1111' } }));
  const r = provider.importClaudeSettings();
  assert.equal(r.found.baseUrl, 'https://other.example.com'); assert.equal(r.found.keyHint, '…1111');
  assert.ok(!r.notes.some(n => /desktop app/.test(n)));
});

test('a desktop set-up that is not a gateway (a Claude plan) is ignored', () => {
  fs.writeFileSync(settings, JSON.stringify({}));
  desktop({ inferenceProvider: 'anthropic' });
  assert.equal(provider.importClaudeSettings().ok, false);
});
