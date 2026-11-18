# Jade Base: instructions for an assistant

Jade Base is a local web app for project managers. It keeps projects, notes, action items and meeting records, and talks to Claude by driving the `claude` command line tool (Claude Code) in the background.
It is Node 22+ (the minimum is `engines` in `package.json`; CI tests 22, 24 and 26), plain JavaScript modules, no npm dependencies, no build step. The server is in `server/`, the pages in `public/`.
Data lives as plain files in a data folder (`~/JadeBase` unless `JADE_HOME` says otherwise). The user is a project manager, not a programmer: anything a person reads must be plain English.

## Commands

- `npm test` runs every test (`node:test`). Each test gets its own temporary data folder; a real `claude` is never started.
- `npm run gates` runs the checks that are not unit tests: imports, boot smoke, pages, sample module, hygiene, docs.
- `npm run test:one -- test/<file>.test.js` runs one test file. `node scripts/gates/<name>.mjs` runs one gate.
- Start for a trial, without touching real data: `JADE_HOME=$(mktemp -d) JADE_CLAUDE_HOME=$(mktemp -d) JADE_PORT=<free port> npm run dev`. The start link with the key is printed to the terminal (set `JADE_SHOW_LINK=1` if the output is not a terminal).

## Hard rules

1. **Do not change what Jade hands to Claude Code** (command line, environment, files named on the command line) unless the task says so. That is `server/core/provider.js`, `server/core/engines.js`, `server/core/models.js`, `server/core/warm.js`. People on Amazon Bedrock or a company gateway depend on it, and `test/provider-parity.test.js` pins it. If it fails, read `test/fixtures/README.md` before touching a fixture. Never re-record to make it pass.
2. **No dependencies.** Not even a dev dependency. Use Node's own modules.
3. **No model names in code, settings defaults or set-up text.** Models come from discovery (`server/core/models.js`). Say "the everyday model", never a product name.
4. **Tests and trial runs use a free port and a temp data folder.** Never the port or the data folder of a Jade that is running (where the usual port is written: `docs/ARCHITECTURE.md` section 1). Ask the system for a free port; stop only the processes you started.
5. **Never run a real `claude`, and never touch `~/.claude`, `~/JadeBase` or any real data folder.** Use `JADE_HOME` and `JADE_CLAUDE_HOME` on temp folders. `tools/wire-check.mjs` does start a real `claude`; it is for a person to run by hand, not for an assistant.
6. **Secrets.** The server key is in `<data folder>/.state/token`; the provider key is in `<data folder>/engine.env`. Never print, log, copy or commit either. Text that may hold one goes through `redact()` in `server/core/redact.js` before it is stored or shown. No route may serve `.state` or `engine.env` (`isSecret()` in `server/core/files.js`).
7. **Tests first.** Write the failing test through a public function or an HTTP route, see it fail, then fix. Helpers are in `test/helpers/`. A change to behaviour without a test is not finished.
8. **No personal material** in any tracked file (home paths, names, handles, mail addresses): `node scripts/gates/hygiene.mjs` fails on it.
9. **Keep the docs true.** `node scripts/gates/docs.mjs` fails when a document names a path, npm script, route or setting that does not exist. A change that moves or renames one updates the docs in the same commit.
10. Stay inside the task's files. A fix that needs another area's file is described, not made.

## Where to read (do this before you change code)

- To find out where something lives, how a request or a run flows, or what an area promises: `docs/ARCHITECTURE.md`.
- To find which files, test and document go with a change ("add a layout", "add a setting", "change what is redacted"): `docs/architecture/where-to-change.md`.
- To know what is in the data folder, what holds a secret and what is safe to delete: `docs/architecture/data-folder.md`.
- To add a module, page, agent, skill, transcript skill, dashboard layout, setting or route: `docs/EXTENDING.md`.
- For what a word means (project, run, job, allowance, checker, gate...): `GLOSSARY.md`.
- For why a thing is the way it is, before you change or "improve" it: `docs/adr/`.
- For a problem report ("it will not start", "a meeting stays on Reading"): `docs/TROUBLESHOOTING.md`.
- For what the app protects and what it does not: `docs/SECURITY.md`.
- For the speed rules (nothing blocks the server, what is remembered and how it is bounded, what is paged), the measured numbers and how to measure again: `docs/PERFORMANCE.md`.
- For what was left on purpose, who it affects and when to fix it: `docs/KNOWN-LIMITS.md`.
- For what each test and gate proves, and how to add a test: `docs/TESTING.md`.
- For the Bedrock and gateway fixtures: `test/fixtures/README.md`.
- For the Claude bridge: `bridge/README.md`.
- For using the app (what a person sees): `README.md`.
