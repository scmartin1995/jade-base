// The set-up files must not name a model: models come only from discovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['server/modules/setup.js', 'public/js/views/setup.js', 'public/js/questionnaire.js', 'public/js/providerform.js'];

test('no model name is written into the set-up files', () => {
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /sonnet|haiku|opus|claude-\d|anthropic\.claude/i, f);
});

test('the questionnaire module loads and exports its entry points', async () => {
  const q = await import('../public/js/questionnaire.js');
  assert.equal(typeof q.runQuestionnaire, 'function');
  assert.equal(typeof q.choiceCards, 'function');
  const p = await import('../public/js/providerform.js');
  assert.equal(typeof p.wireProviderForm, 'function');
});
