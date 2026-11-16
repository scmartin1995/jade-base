// The rules that used to be written twice: secret names, and a title guessed from a file name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jade-rules-'));
process.env.JADE_HOME = path.join(tmp, 'home');
process.env.JADE_CLAUDE_HOME = path.join(tmp, 'claude');
const { SECRET_NAME } = await import('../server/core/redact.js');
const T = await import('../server/core/transcripts.js');
const M = await import('../server/core/meetings.js');

test('SECRET_NAME knows what a secret setting is called', () => {
  for (const n of ['ANTHROPIC_API_KEY', 'AWS_SESSION_TOKEN', 'my_password', 'ANTHROPIC_CUSTOM_HEADERS', 'Authorization']) assert.ok(SECRET_NAME.test(n), n);
  for (const n of ['AWS_REGION', 'CLAUDE_CODE_LIMIT', 'ANTHROPIC_MODEL']) assert.equal(SECRET_NAME.test(n), false, n);
});

test('one guessTitle: the reading keeps the name as it is, a meeting gets a capital and a fallback', () => {
  const n = 'zoom_2026-11-09_brightside-kickoff.vtt';
  assert.equal(T.guessTitle(n), 'brightside kickoff');
  assert.equal(M.guessTitle(n), 'Brightside kickoff');
  assert.equal(T.guessTitle('2026-11-10.vtt'), null);
  assert.equal(M.guessTitle('2026-11-10.vtt'), 'Meeting');
  assert.equal(T.guessTitle('Standup 10 Nov 2026.txt'), 'Standup', 'dates written in words come out too');
  assert.equal(M.guessTitle('Standup 10 Nov 2026.txt'), 'Standup');
});
