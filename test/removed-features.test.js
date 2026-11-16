// Words from features that were taken out (mail, issue tracking, news and learning modules) do not linger in the agents' instructions or the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

test('the Skeptic and Transcript instructions talk about transcripts and documents, not an email inbox', () => {
  for (const f of walk(path.join(ROOT, 'agents/skeptic')).concat(walk(path.join(ROOT, 'agents/transcript')), [path.join(ROOT, 'agents/transcript.md')]))
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\be-?mail/i, path.relative(ROOT, f));
});

test('no removed feature is named in the agents, the server or the pages', () => {
  const gone = /\b(mailroom|mailbox|courier|presort|ledger|jira)\b/i;
  for (const d of ['agents', 'server', 'public/js', 'bridge'])
    for (const f of walk(path.join(ROOT, d)).filter(x => /\.(md|js|mjs|json)$/.test(x)))
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), gone, path.relative(ROOT, f));
});
