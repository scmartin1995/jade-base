// Which file a request for a web page or script names, inside Jade's public folder. Anything that cannot be read as a path, or that
// leads out of the folder, is answered with a status instead of being looked up. Nothing here may throw: a request is outside any
// try/catch in the server, so a throw would end the whole process.
import path from 'node:path';

/**
 * { file, rel } for a request path inside `root`, or { status } to answer with: 400 for a path that is not valid (a broken %
 * escape, a NUL byte), 403 for one that leads out of the folder. The folder is checked with its separator, so a sibling folder
 * whose name starts the same way ("public-x" beside "public") is not served.
 */
export function staticTarget(pathname, root) {
  let rel;
  try { rel = decodeURIComponent(String(pathname)); } catch { return { status: 400 }; }
  if (rel.includes('\0')) return { status: 400 };
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.resolve(root, '.' + rel);
  if (file !== root && !file.startsWith(root + path.sep)) return { status: 403 };
  return { file, rel };
}
