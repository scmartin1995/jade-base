// Reading a request body with a size limit.

/**
 * Reads a body up to `limit` bytes. Past the limit it stops keeping data but keeps reading, so the answer (413) can reach a client that
 * is still writing: closing the request stream early resets the connection and the answer is lost. A body that goes over the limit
 * and then never ends is cut off after `cutoffMs`, whether or not it said how long it would be. Resolves { buf } or { over: true }
 * (or { aborted: true } when the client went away).
 */
export function readBody(req, limit, cutoffMs = 20000) {
  return new Promise(resolve => {
    const chunks = []; let size = 0, over = false, done = false, timer = null;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const tooBig = () => {
      if (over) return;
      over = true; chunks.length = 0; finish({ over });
      timer = setTimeout(() => req.destroy(), cutoffMs); timer.unref();
      req.once('close', () => clearTimeout(timer));
    };
    if (Number(req.headers['content-length']) > limit) tooBig();
    req.on('data', c => { size += c.length; if (over) return; if (size > limit) tooBig(); else chunks.push(c); });
    req.on('end', () => finish({ buf: Buffer.concat(chunks) }));
    req.on('error', () => finish({ aborted: true }));
    req.on('close', () => finish({ aborted: true }));
  });
}
