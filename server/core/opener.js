// How a launcher opens Jade without putting the key on a command line (other users on the computer can read a program's arguments).
// It writes a small page into the owner-only data folder that moves on to the start link, and gives the address of that file.
// The key is in that file only; the launchers (scripts/jade, scripts/jade.cmd) do the same by hand.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as config from './config.js';
import * as auth from './auth.js';
import { openPlan, openWindow, windowMode } from './browser.js';

export function openerUrl(port) {
  const link = auth.startLink(port);
  const file = path.join(config.STATE, 'open.html');
  const html = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Opening Jade</title><meta http-equiv="refresh" content="0;url=${link}"><script>location.replace(${JSON.stringify(link)})</script>`;
  fs.mkdirSync(config.STATE, { recursive: true });
  fs.writeFileSync(file, html, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* not supported here */ }
  return pathToFileURL(file).href;
}

/**
 * Write the start-link file and open it in the configured window (app or tab), without starting a server. The one way every launcher
 * opens Jade: `node jade.js --open` (used by scripts/jade and scripts/jade.cmd) and the launcher's own start. Returns a promise of the
 * plan used, or null when nothing could be started. The address given to the browser is the file's, never the key link.
 */
export function openJade({ port, argv = process.argv, env = process.env, spawn, log = console.log, cfg = config.get() } = {}) {
  return new Promise(resolve => {
    let url;
    try { url = openerUrl(port); } catch { log(`Open http://127.0.0.1:${port} in your browser, using the link Jade showed when it started.`); return resolve(null); }
    const mode = windowMode({ argv, env, config: cfg });
    openWindow(openPlan({ url, mode, env }), {
      spawn,
      retry: () => openPlan({ url, mode: 'tab', env }),
      done: used => { log(used ? used.said : `Open http://127.0.0.1:${port} in your browser, using the link Jade showed when it started.`); resolve(used); },
    });
  });
}
