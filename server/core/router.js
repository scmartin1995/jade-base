// The route table, shared by api.js, modules and index.js. Routes are registered under an owner name ("api", "mod:notes"), so a file
// that is re-imported (api.js on hot reload) replaces its own routes instead of adding them twice.
const routes = [];

const compile = pattern => {
  const keys = [];
  // a trailing * captures the rest of the path as p['*']; :name captures one segment
  const star = pattern.endsWith('*');
  const re = new RegExp('^' + pattern.replace(/\*$/, '').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + (star ? '(.*)' : '') + '$');
  if (star) keys.push('*');
  return { re, keys };
};

/** `fn`, but `check()` runs first and may throw (with a `status`) to refuse. The one shape for "this feature is off": a module's switch, a setting. */
export const guard = (check, fn) => (...args) => { check(); return fn(...args); };

/**
 * `on(method, pattern, fn, opts)` for one owner. Asking for a scope again drops what that owner registered before.
 * opts.raw: matched in index.js before the body is read; fn gets { p, q, req, res } and answers the response itself.
 * `check`: when given, it runs before every route of this owner (see guard), so none of them can forget it.
 */
export function scope(owner, check) {
  // a scope asked for again (api.js after a hot reload) takes the place its routes had, so the order in which routes are tried does not change
  const at = routes.findIndex(r => r.owner === owner);
  for (let i = routes.length - 1; i >= 0; i--) if (routes[i].owner === owner) routes.splice(i, 1);
  let n = 0;
  return (method, pattern, fn, opts = {}) => {
    const r = { owner, method, ...compile(pattern), fn: check ? guard(check, fn) : fn, raw: !!opts.raw };
    if (at < 0) routes.push(r); else routes.splice(Math.min(at + n++, routes.length), 0, r);
  };
}

/** The first route that answers this request, with its path parameters; raw says whether to look at raw routes or normal ones. */
export function match(method, pathname, raw) {
  for (const r of routes) {
    if (r.raw !== raw || r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const p = {};
    r.keys.forEach((k, i) => { try { p[k] = decodeURIComponent(m[i + 1]); } catch { p[k] = m[i + 1]; } });
    return { fn: r.fn, p };
  }
  return null;
}

export const jsonLimit = cfg => Number(cfg?.limits?.jsonBody) || 2 * 1024 * 1024;
