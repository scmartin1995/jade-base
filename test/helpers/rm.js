// Remove a folder tree after a test. Retries, because a watcher or child process that is still closing can hold a folder for a moment
// (Windows answers EBUSY, Linux ENOTEMPTY). Never throws: a leftover temp folder must not fail a test.
import fs from 'node:fs';

export function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* the operating system cleans the temp folder later */ }
}
