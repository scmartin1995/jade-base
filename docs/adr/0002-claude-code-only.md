---
status: accepted
---
# Claude Code is the only way Jade reaches a model

## Context

Jade began as a single-user tool. Most people use it on Amazon Bedrock or a company gateway, where the connection is already set up for Claude Code (and where the company has approved Claude Code, not a new client). A second engine would double the paths that must be tested on Bedrock, which the automated tests cannot reach.

## Decision

Jade starts the `claude` command line program for every piece of model work: chats, agents, checks, dashboards, Dreams. It has no direct API client for answering questions and no second engine (no other assistant is supported on purpose). The only direct web calls to a model service are the model-list lookups (`server/core/models.js`) and the one-token connection check on a gateway or Bedrock (`test` in `server/core/engines.js`); they read or test, and never answer a question. The one other download is the offline speech model, only when Voice is on (`server/core/voicemodel.js`). Everything that decides how Claude Code is started lives in `server/core/engines.js`, `server/core/provider.js` and `server/core/models.js`, and is pinned by `docs/adr/0004-bedrock-gateway-locked-by-parity-test.md`.

## Consequences

- Jade inherits Claude Code's login, tools, connectors, usage limits and settings, and the PM's plan or gateway works without a second set of keys. There are no other API keys in Jade.
- Jade cannot work where Claude Code cannot. If `claude` is not found, Jade says so (Diagnose, `docs/TROUBLESHOOTING.md`).
- Tests never start a real `claude`. They put a stand-in first on `PATH` (`test/helpers/fake-claude.js`).

## How to tell if this should be revisited

Revisit if the people using Jade need a model service Claude Code cannot reach, or if Claude Code stops offering a headless mode (`-p`) with JSON output, a JSON schema option and a permission prompt tool, which Jade relies on. A second engine would need its own parity record and its own entry here.
