// The stand-in `claude` for tests. The script itself lives in scripts/gates/lib.mjs so the gates use the very same one.
import fs from 'node:fs';
import path from 'node:path';
import { writeStandIn, safePath } from '../../scripts/gates/lib.mjs';

/**
 * Install the stand-in in `bin` and put it first on this process's PATH (a real `claude` was already taken off by test/setup.js).
 * Returns { bin, reply(text), calls() }: reply() sets what a one-shot run answers; calls() lists what it was asked.
 */
export function installFakeClaude(bin, { reply = 'done', putOnPath = true } = {}) {
  writeStandIn(bin);
  const api = {
    bin,
    reply: text => fs.writeFileSync(path.join(bin, 'reply.txt'), text),
    calls: () => { try { return fs.readFileSync(path.join(bin, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } },
  };
  api.reply(reply);
  if (putOnPath) process.env.PATH = safePath(bin);
  return api;
}
