---
status: accepted
---
# No npm dependencies

## Context

Jade Base is used by project managers, often on a company laptop with a locked-down network and no one to help with `npm install`. A dependency tree is also something that has to be reviewed, patched and trusted for a tool that reads the person's files and runs an AI assistant. The app needs little: an HTTP server, files, child processes, a test runner, a WebSocket client for one gate. Node 20 has all of these built in.

## Decision

`package.json` has no `dependencies` and no `devDependencies`. Code imports only `node:` modules, relative files, and (in the browser) its own files. What a library would do is written small and local: reading `.docx`, `.pptx` and `.xlsx` with Node's `zlib` (`server/core/extract.js`), reading `.pdf` only when the computer has `pdftotext`, the test runner is `node:test`, and the pages gate talks to the browser with Node's own `WebSocket` and `fetch` (`scripts/gates/pages.mjs`). The front end is plain ES modules with one CSS file and no build step. The page loads web fonts from Google by default; the Privacy setting `privacy.webFonts` turns that off (`server/index.js` strips the font links).

## Consequences

- Start is `npm start` on any machine with Node 20 and Claude Code. Nothing to install, nothing to audit beyond this repository.
- Some things are done by hand and are less complete than a library: PDF text needs `pdftotext`; the zip reader in `extract.js` handles the formats project managers have, not every zip.
- A contributor who reaches for a package has to write the small version instead. Do not add one "just for this"; see the trigger below.

## How to tell if this should be revisited

Revisit if a required feature cannot be written locally in a few hundred lines with the right quality (for example reliable PDF layout reading, or a real browser test harness), and the people who use Jade can all run `npm install`. Even then, add the dependency to one named module with a test around it, and say so here. A new dependency also touches `docs/ARCHITECTURE.md` and the hygiene of the gates, so change those in the same commit.
