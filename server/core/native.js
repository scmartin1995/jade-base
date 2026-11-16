// The computer's own folder chooser (Explorer / Finder / the Linux desktop's file chooser), so nobody types paths.
// Returns { path } | { cancelled: true } | { unsupported: true, reason }. The UI falls back to Jade's own browser.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import * as config from './config.js';
import { which, expand } from './util.js';

function run(cmd, args, { timeout = 10 * 60e3 } = {}) {
  return new Promise(resolve => {
    let out = '', err = '';
    const p = spawn(cmd, args, { windowsHide: false });
    const t = setTimeout(() => p.kill(), timeout);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    p.on('close', code => { clearTimeout(t); resolve({ code, out: out.trim(), err: err.trim() }); });
  });
}

/** A PowerShell single-quoted string: nothing inside is expanded; a quote (straight or curly, which PowerShell also reads as one) is doubled. */
export const psQuote = v => `'${String(v).replace(/['\u2018\u2019\u201A\u201B]/g, m => m + m).replace(/[\r\n]+/g, ' ')}'`;
const tilde = p => { const h = os.homedir(); return p === h ? '~' : p.startsWith(h + path.sep) ? '~' + p.slice(h.length) : p; };

export async function chooseFolder({ title = 'Choose a folder for Jade', start = '~' } = {}) {
  const from = expand(start || '~');
  if (process.platform === 'darwin') {
    const script = `POSIX path of (choose folder with prompt ${JSON.stringify(title)} default location (POSIX file ${JSON.stringify(from)}))`;
    const r = await run('osascript', ['-e', script]);
    if (r.code !== 0) return /-128/.test(r.err) ? { cancelled: true } : { unsupported: true, reason: r.err };
    return { path: tilde(r.out.replace(/\/$/, '')) };
  }
  // Windows: the dialog below opened behind every other window (the server's PowerShell has no right to take the front), so
  // "Add folder" looked dead and each click left another hidden dialog waiting. Jade's own browser is used instead.
  if (process.platform === 'win32' && process.env.JADE_NATIVE_PICKER !== '1') return { unsupported: true, reason: 'Windows: using Jade\'s folder browser' };
  if (process.platform === 'win32') {
    // the title and the start folder come from the request: single-quoted PowerShell strings (a quote doubled), where nothing is expanded,
    // not double-quoted ones, where $(...) would run
    const q = psQuote;
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog;
      $f.Description = ${q(title)}; $f.UseDescriptionForTitle = $true; $f.SelectedPath = ${q(from)};
      $top = New-Object System.Windows.Forms.Form -Property @{TopMost=$true};
      if ($f.ShowDialog($top) -eq 'OK') { $f.SelectedPath } else { '::cancel::' }`;
    const r = await run('powershell', ['-NoProfile', '-STA', '-Command', ps]);
    if (r.code !== 0) return { unsupported: true, reason: r.err };
    return r.out === '::cancel::' ? { cancelled: true } : { path: tilde(r.out) };
  }
  // Linux and BSDs: zenity / kdialog if installed, otherwise the XDG desktop portal (works on any modern desktop).
  if (which('zenity')) {
    const r = await run('zenity', ['--file-selection', '--directory', `--title=${title}`, `--filename=${from}/`]);
    return r.code === 0 && r.out ? { path: tilde(r.out) } : { cancelled: true };
  }
  if (which('kdialog')) {
    const r = await run('kdialog', ['--getexistingdirectory', from, '--title', title]);
    return r.code === 0 && r.out ? { path: tilde(r.out) } : { cancelled: true };
  }
  if (which('python3')) {
    const helper = path.join(config.APP_ROOT, 'server', 'native', 'pick-folder-portal.py');
    const r = await run('python3', ['-I', helper, title, from]);
    try {
      const j = JSON.parse(r.out.split('\n').pop() || '{}');
      if (j.path) return { path: tilde(j.path) };
      if (j.cancelled) return { cancelled: true };
      return { unsupported: true, reason: j.error || r.err || 'no answer from the desktop portal' };
    } catch { return { unsupported: true, reason: r.err || r.out }; }
  }
  return { unsupported: true, reason: 'No folder dialog available on this system' };
}
