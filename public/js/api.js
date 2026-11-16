// The plain calls to the server, with no browser shell: views and the drop bin get these (app.js re-exports them).
// Nothing here touches `window` or `document` at import time, so a test can load a view without a browser.
import { TOKEN } from './token.js';

export async function api(method, path, body) {
  const r = await fetch(path, {
    method, headers: { 'x-jade': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

/** Upload one file as the raw body of a POST, with progress. Same header and same error shape as api(); fetch cannot report upload progress. */
export function apiUpload(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', path);
    x.setRequestHeader('x-jade', TOKEN);
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(Math.round(e.loaded / e.total * 100)); };
    x.onerror = () => reject(new Error('The file could not be sent. Check that Jade is still running and try again.'));
    x.onload = () => {
      let data = {};
      try { data = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(data);
      else reject(Object.assign(new Error(data.error || x.statusText || 'The request failed.'), { status: x.status, said: !!data.error }));
    };
    x.send(file);
  });
}

/**
 * What the catch-all in app.js should say for an unhandled failure: nothing for a request cancelled on purpose, nothing for the same
 * message that was shown a moment ago (`ageMs` ago; a burst of identical failures is one toast). A real repeat, later, is shown again.
 */
export const REPEAT_QUIET_MS = 4000;
export function netMessage(reason, last = '', ageMs = 0) {
  if (!reason || reason.name === 'AbortError') return '';
  const m = reason.message;
  return typeof m === 'string' && m && (m !== last || ageMs >= REPEAT_QUIET_MS) ? m : '';
}
