---
status: accepted
---
# Jade opens in its own app window, not a packaged desktop app

## Context

Jade is a local web page. Started from the launcher it opened a tab in the person's normal browser, among their other tabs, with an address bar and bookmarks, and its taskbar entry was the browser's. A project manager wants a program that opens like a program. The launcher already tried an app-style window, but only on some systems, through a shell command (`open -na`, `cmd /c start`), by guessing browser names, and with no setting to turn it off.

## Decision

The launcher (`jade.js`) opens Jade in a Chromium "app window" when it can: the browser's own program is started with `--app=<address>`, `--new-window` and `--window-size=1280,860`, plus `--class=jade-base` on Linux so desktops can group it. The browser is found by one shared finder, `findBrowser` in `server/core/browser.js` (the page gate in `scripts/gates/lib.mjs` uses the same one): Chrome, Chromium, Edge and Brave in the usual places on Linux, macOS (`/Applications` and `~/Applications`) and Windows, then browser names on `PATH`. `JADE_BROWSER` (then `CHROMIUM`, `CHROME_BIN`) names a browser by hand. No `--user-data-dir` is given, so the window uses the person's normal browser profile: their password manager, extensions and zoom work. It is started detached, with no output kept and no console window, and the launcher never waits for it.

**The key.** The address given to `--app=` is the `file://` address of `.state/open.html` (ADR 0005), never the start link, so the key is in no program's argument list, exactly as before. That file moves the window on to the start link; the window stays an app window (checked by hand on Linux with Chromium; the `start-from-file` step of `scripts/gates/pages.mjs` still proves the file lands on the app, not the gate page).

**The setting.** `window` in `config.json` is `'app'` (default) or `'tab'`. `JADE_WINDOW` overrides it and `--tab` overrides both. With no browser found, or one that will not start, Jade opens a tab through the system (`xdg-open`, `open`, `start`), and the launcher prints one plain line saying which it used. Firefox and Safari have no app mode, so they only ever get a tab.

**Why not a packaged desktop app** (Electron or similar). It would bundle a whole browser engine (hundreds of megabytes) with every copy, need a separate build and signing for each system, need updating whenever the engine has a security fix, and add the project's first dependency (ADR 0001) and its first build step. An app window gets the same look from the browser the person already has and keeps updated.

## Consequences

- No build, no dependency, no new window code: only a command line.
- It is still a browser underneath: the right-click menu, refresh and keyboard shortcuts work, and a link to another site opens in the browser.
- The window's identity is the browser's: on some desktops (for example Linux under Wayland) the window group is named by the browser from the file's address, not by `--class`. The page title and icon (`public/index.html`, `public/icon.svg`) say "Jade".
- If the browser is already running, the new window opens in that running browser (it hands the request over), so closing the whole browser closes Jade's window too.
- `scripts/jade` and `scripts/jade.cmd` still open their own windows by their own rules; they do not read the `window` setting.

## How to tell if this should be revisited

Revisit if people want a dock or taskbar entry that survives closing the browser, a tray icon, or native notifications, or if Chromium drops `--app`. Those are the reasons a packaged app would be worth its cost.
