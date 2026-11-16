// The reporter scripts/test.mjs asks node --test for: it prints exactly what the built-in TAP reporter prints, and also writes
// down, per test file, the last test seen and when (to the file named in JADE_TEST_STATUS), so that a run that hangs can say which
// file it was waiting for.
import { tap } from 'node:test/reporters';
import fs from 'node:fs';
import path from 'node:path';

export default async function* (source) {
  const status = process.env.JADE_TEST_STATUS;
  const seen = {};
  let written = 0;
  async function* tee() {
    for await (const e of source) {
      const d = e.data || {};
      if (status && d.file && /^test:(start|pass|fail)$/.test(e.type)) {
        seen[path.basename(String(d.file))] = { at: Date.now(), last: String(d.name || '').slice(0, 100), event: e.type };
        if (Date.now() - written > 500) { written = Date.now(); try { fs.writeFileSync(status, JSON.stringify(seen)); } catch { /* the runner reads it only when it is stuck */ } }
      }
      yield e;
    }
    if (status) try { fs.writeFileSync(status, JSON.stringify(seen)); } catch { /* as above */ }
  }
  yield* tap(tee());
}
