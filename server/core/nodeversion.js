// The oldest Node Jade supports, read from package.json "engines" (the one place it is written), and the warning the launcher prints
// when the running Node is older. An older Node still starts Jade: the warning says why to update, it does not stop anyone working.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
let min = 0;
/** The lowest supported Node major version, from `"engines": { "node": ">=N" }`. */
export function minNode() {
  if (!min) { try { min = Number(/(\d+)/.exec(JSON.parse(fs.readFileSync(PKG, 'utf8')).engines.node)[1]); } catch { min = 22; } }
  return min;
}
/** '' on a supported Node; otherwise one plain warning that names the running version and the one to install. */
export function nodeWarning(version = process.version) {
  const major = Number(/^v?(\d+)/.exec(String(version))?.[1] || 0);
  if (major >= minNode()) return '';
  return `Warning: Jade runs on Node ${version}, which is older than Node ${minNode()} and may no longer get security fixes. Jade still starts, but please install the current LTS version from https://nodejs.org`;
}
