---
status: accepted
---
# The server key, and a start link that carries it

## Context

Jade listens on `127.0.0.1` and can read and change the PM's projects, files and chats, and start Claude Code. Without a secret, any web page open in the PM's browser (through a request to localhost), and any other user account on a shared computer, could talk to it. A password would be one more thing for a project manager to manage and lose.

## Decision

Jade makes a random key once and keeps it in `<data folder>/.state/token` (owner-only, in a folder only the owner can enter). Every write must carry it in the `X-Jade` header. Every read of the PM's data must carry it as that header or as the cookie the app page sets. The page that carries the key in a meta tag is served only to a browser that already has the cookie; anyone else gets a plain page with a box to paste the key (`server/core/gatepage.js`). The key reaches the browser through the **start link** `http://127.0.0.1:<port>/?key=...`, printed once to a terminal (never to a log) and opened by the launchers through a small owner-only file so the key is never on a command line (`server/core/opener.js`, `scripts/jade`, `scripts/jade.cmd`). The server answers the start link with a small page that sets the cookie and moves on to `/` with a zero-second refresh (no script, no redirect): a start link opened from a local file counts as another site, and a browser does not send a `SameSite=Strict` cookie on a redirect that follows, so a redirect landed people on the paste-the-key page. The page's own move starts on Jade's address, so the cookie goes with it and the key leaves the address bar. The cookie stays HttpOnly and SameSite=Strict. The server also checks the `Host` header is localhost, which stops DNS rebinding. Code: `server/core/auth.js`, `server/index.js`. `JADE_TOKEN` in the environment overrides the key (used by tests and gates).

## Consequences

- Other accounts on the computer, other websites and programs that cannot read the PM's files cannot use Jade.
- A program running as the PM can read the key file and so can use Jade. This is stated in `README.md` and `docs/SECURITY.md`, not hidden.
- The key does not change between restarts, so an open window keeps working.
- Anyone shown the start link has the key. It must not be pasted into chats or tickets.
- The one open route is the launcher's "is it running" check (`GET /api/engines` without the key answers only `{ running: true }`).

## How to tell if this should be revisited

Revisit if Jade is ever used from another computer (it is not: it binds to `127.0.0.1` only), if a shared account has to run it, or if the key file turns out to be read by tools it should not be. A per-user operating system mechanism (a socket in a private folder) would be the next step, and would change how the bridge and the launchers connect.
