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
      if (status && d.file && /^test:(start|pass|fail|complete)$/.test(e.type)) {
        const key = path.basename(String(d.file));
        // the test that stands for the whole file is reported when its process has ended: that is when the file is finished
        const slash = x => String(x).replace(/\\/g, '/');
        const whole = e.type === 'test:complete' && d.nesting === 0 && !!d.name && slash(d.file).endsWith(slash(d.name));   // named by the file (a full or a relative path)
        const prev = seen[key];
        seen[key] = { at: Date.now(), last: whole && prev ? prev.last : String(d.name || '').slice(0, 100), event: whole && prev ? prev.event : e.type, done: whole || (prev && prev.done) || false };
        if (whole) written = 0;
        if (Date.now() - written > 500) { written = Date.now(); try { fs.writeFileSync(status, JSON.stringify(seen)); } catch { /* the runner reads it only when it is stuck */ } }
      }
      yield e;
    }
    if (status) try { fs.writeFileSync(status, JSON.stringify(seen)); } catch { /* as above */ }
  }
  yield* tap(tee());
}
