// Start the real server as a child for a test: a free port, a stand-in `claude`, a wait on a condition (never a fixed sleep).
import { freePort, waitFor, startServer as start, GATE_TOKEN } from '../../scripts/gates/lib.mjs';
export { freePort, waitFor };

/**
 * startServer({ home, claudeHome, bin?, token?, env? }) -> { base, port, token, child, stderr(), stop(), get, post, patch, del }
 * The request helpers send the key and give back { status, body } (body is JSON when the answer is JSON).
 */
export async function startServer(opts) {
  const s = await start(opts);
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(s.base + path, { method, headers: { 'x-jade': s.token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text(); let json = text; try { json = JSON.parse(text); } catch { /* plain text */ }
    return { status: r.status, body: json };
  };
  return { ...s, get: (p, h) => call('GET', p, undefined, h), post: (p, b = {}, h) => call('POST', p, b, h), patch: (p, b = {}, h) => call('PATCH', p, b, h), del: (p, h) => call('DELETE', p, undefined, h) };
}
export { GATE_TOKEN };
