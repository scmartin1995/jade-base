---
status: accepted
---
# How secrets are handled, and the limits we state

## Context

Two secrets matter: the Jade key (`docs/adr/0005-server-key-and-start-link.md`) and the connection key for a gateway or Bedrock. Claude Code needs the connection key in its own environment to work, and Jade lets Claude Code run commands (Bash) when the PM allows edits. A run that may run commands can, in principle, read anything the PM's account can read. A guarantee that Jade cannot keep would be worse than a plain statement of what it does.

## Decision

Reduce exposure everywhere Jade controls it, and say plainly what remains.

- **The Jade key is not given to Claude.** It is not in the environment of any Claude process and not in the per-run tool settings. The approval tool (`server/mcp/approve.mjs`) is told where the state folder is and reads the key file itself. The per-run settings file is written owner-only into `<data folder>/.state/run` (not the free `.state/tmp`), removed when the run ends, and stale ones are removed at start. `.state` and its private sub-folders are made owner-only (`server/core/auth.js`, `server/core/config.js`, `server/core/engines.js`).
- **The connection key lives in `engine.env`** (owner-only, never in `config.json`, never in git) and in the Claude process environment, because Claude Code needs it there. Settings never shows a custom header value back.
- **Asking stands in the way.** Claude's own Read, Glob and Grep tools are refused `engine.env` and the whole `.state` folder (`secretReadDenies` in `server/core/engines.js`). A shell command that names `.state`, prints the environment, or touches Jade's owned files asks first, in every permission mode that lets a run change anything; in `read` mode nothing may change (`server/core/permissions.js`).
- **Text is cleaned before it is kept or shown.** Every run's output, error, the chat, the live event stream, Diagnose and the Dreams digest pass through `server/core/redact.js`, which replaces the keys in `engine.env` and common key shapes with `[hidden]`.
- **Routes never serve secrets.** No route lists, serves or indexes `.state` or `engine.env` (`isSecret` in `server/core/files.js`, real-path checks in the module view route in `server/api.js`).

## Consequences

- The statement in `README.md` ("Privacy and safety") and `docs/SECURITY.md` is exact: a run that is allowed to run commands could read the key file the same way the approval tool does; what stands in the way is the asking, not a lock. The same is true of the connection key in the environment.
- Redaction is by shape and by known value. A secret in an unusual shape, or one the PM types into a chat as plain words, is not recognised.
- On Windows the owner-only file mode does not exist. Jade tightens `engine.env` with `icacls` where it can; otherwise the folder's access rules apply. Keep the data folder in your own profile.

## How to tell if this should be revisited

Revisit if Claude Code offers a way to give the approval tool, or the connection key, to a process a run cannot read (a credential helper, an operating system keychain), or if a report shows a secret reaching a stored text without being hidden. A change to what Claude Code receives is a parity change (`docs/adr/0004-bedrock-gateway-locked-by-parity-test.md`).
