// A hand-written stand-in program (a `claude`, a `pdftotext`) that a test puts first on PATH.
// On Linux and macOS it is a script with a `#!` line, made runnable. Windows cannot run that, so there the body goes in a .js file
// and a `.cmd` shim of the same name (found through PATHEXT) starts it with this Node.
import fs from 'node:fs';
import path from 'node:path';

/** Write the stand-in `name` into `dir` from the JavaScript in `body`; returns the path a caller would run. */
export function writeStub(dir, name, body) {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, name + '-stub.js'), body);
    const shim = path.join(dir, name + '.cmd');
    fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "%~dp0${name}-stub.js" %*\r\n`);
    return shim;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}\n${body}`, { mode: 0o755 });
  return file;
}
