# Testing

What the tests and gates prove, what they do not prove (the rest that is known and left on purpose is in `docs/KNOWN-LIMITS.md`), how to add a test, and how to read a failure of the Bedrock and gateway parity test. Words such as "stand-in", "gate" and "parity test" are defined in `GLOSSARY.md`. Where the pieces are in the code, see `docs/ARCHITECTURE.md`.

## Running things

```bash
npm test                    # every test (node:test); a minute or two on an idle machine, longer when busy
npm run gates               # the checks below that look at the whole repository or at a started server
npm run test:one -- test/mayrun.test.js   # one test file (several may follow)
node scripts/gates/imports.mjs             # one gate
```

- `test/setup.js` runs before every test file. Unless a test chooses its own folders, it gives the test throw-away `JADE_HOME` and `JADE_CLAUDE_HOME` folders, so no test can read or write your real data folder or your real `~/.claude`. It also sets a test key (`JADE_TOKEN`) and takes every folder that holds a `claude` program out of `PATH`, so a real `claude` is never started. `npm run test:one` is `node scripts/test.mjs` (which lists the test files itself and starts `node --test --import ./test/setup.js` on them; this works the same on Node 20, 22, 24 and 26) plus the files you name. Use it for a single file. Running the files with plain Node, without that set-up,: some files fail for lack of the folders, and the others could reach a real `claude` or your real data. The docs gate refuses a document that shows the plain form. The runner does not hang silently: a test over 12 minutes fails (`--test-timeout`), and a run that prints nothing for 10 minutes, or takes over 17, names the test files it was last seen in, stops the test processes and exits 1 (`JADE_TEST_TIMEOUT_MIN`, `JADE_TEST_STALL_MIN`, `JADE_TEST_LIMIT_MIN` change the limits).
- No test or gate uses the port or data folder of a Jade that is running. Servers started by tests ask the system for a free port and use a temp data folder.
- A real Claude is never contacted: the model is a stand-in.

## What the tests prove

Tests are grouped here by what they protect. They go through a public function or an HTTP route wherever a seam exists. Each group lists its files; run one with the command above.

| Group | Files | What they prove |
|---|---|---|
| The key and the edges of the server | `test/key-gate.test.js`, `test/server-edges.test.js`, `test/upload-413.test.js`, `test/static.test.js` | The page carries no data without the key; the start link sets the cookie; one guard answers the same way for every route of a switched-off module; the folder picker and view files never list or serve `.state` or the key; an unreadable file or a failing request cannot take the server down; an over-large body gets its 413; a second launcher does not take over the first; paths cannot leave the public folder |
| Secrets and rights | `test/redact-stream.test.js` (a key split across streamed pieces is still hidden), `test/run-secrets.test.js`, `test/security.test.js`, `test/hardening.test.js`, `test/permissions.test.js`, `test/explain.test.js` | The key is not in a run's tool settings and the files are owner-only and removed after the run; the approval tool reaches `permissions.decide` with the key and is refused without it; links out of allowed folders are refused; owned files ask in every mode; allowances follow file content; each permission question has a plain-words version and edits can be restored |
| Who may run | `test/project-watch.test.js` (project agents and skills are noticed even when the folder is made later), `test/mayrun.test.js`, `test/agent-allowance.test.js`, `test/agentfiles.test.js`, `test/agent-override.test.js`, `test/agents-claude.test.js`, `test/skills-sources.test.js`, `test/claude-skills-e2e.test.js`, `test/modules.test.js`, `test/worker.test.js` | Every combination of origin, way of starting, module switch and allowance gives the stated answer; the queue, the schedule, the bridge, chat actions and chat lists agree; agents are found from every folder; installs never overwrite your edits; modules load, switch off and add routes, panels and agents |
| Chat | `test/chat-http.test.js`, `test/chatreply.test.js`, `test/chat-effort.test.js`, `test/chat-sources.test.js`, `test/warm.test.js`, `test/engine-env-watch.test.js`, `test/images.test.js`, `test/touched.test.js`, `test/subagents.test.js`, `test/subagents-restart.test.js`, `test/token-saving.test.js`, `test/build-loop.test.js`, `test/skeptic-chat.test.js` | Send, stream, stop and history over HTTP with a stand-in `claude`; what a chat reply adds to the prompt and what is written when it ends or fails; a second message waits for the first; a same-content rewrite of `engine.env` does not stop a running chat; pasted images become files; which files a reply changed (with the earlier version); sub-agent cards close after a restart; a build reply is checked by Skeptic |
| Meetings | `test/transcripts.test.js`, `test/meetings.test.js`, `test/meetings-e2e.test.js`, `test/meeting-agent-files.test.js`, `test/checker.test.js`, `test/meetings-views.test.js` | Every transcript format reads or is refused in plain words; the workflow's statuses, repair round, usage-limit pause and record; the real server with a stand-in `claude` end to end; the Transcript agent's files and sample meetings follow the contract and every quote is in its transcript; the checker-model rule (own file, Settings, one size up, and the stated fallbacks); a failed load is shown differently from an empty list |
| Dashboards | `test/dashboard.test.js`, `test/dashboard-robust.test.js`, `test/dashboard-render.test.js`, `test/dashboard-views.test.js`, `test/dashboard-safety.test.js`, `test/dashboard-claudesetup.test.js`, `test/dashboards.test.js` | `validateSpec` never throws, whatever a model answers (fuzzed names, types, sizes); values reach the page as text, never markup; numbers come from the data; building and changing with a fake model; a removed dashboard is not recreated; a failed load and a failed layout are reported; deleting stays inside the Dashboards folder |
| Dreams | `test/dreams.test.js`, `test/claudesessions.test.js` | Dreams end to end with a stand-in `claude`; which Claude Code conversations count, by scope and age; what is read and what is never read; accepting an idea shows the exact text and writes create-only |
| Models, effort, connection | `test/engines-public.test.js` (the command line, quoting, environment and Diagnose of `server/core/engines.js`), `test/models-offerable.test.js`, `test/setup.test.js`, `test/setup-files.test.js`, `test/effort.test.js`, `test/provider.test.js`, `test/import-desktop.test.js`, `test/enginehome.test.js` | Only discovered models are offered, smallest first; no model name in the set-up and Settings code; set-up refuses to finish without a successful test of these exact settings; effort reaches Claude Code as the right flag or none; the connection file reads and writes; "Use my Claude Code settings" works from a throw-away home |
| What reaches Claude Code | `test/provider-parity.test.js` with `test/fixtures/provider-parity-gateway.json` and `test/fixtures/provider-parity-plan.json` | Jade's output toward Claude Code on every connection type is exactly the frozen record: command line, environment, the contents of settings files, the approval-tool config and the system prompt, the connection check's web request, warm start equals cold start. See "How to read a parity failure" below |
| Data and files | `test/action-dedupe.test.js` (two actions count as the same only with the same words, project and owner), `test/router-order.test.js` (route order survives a reload), `test/removed-features.test.js` (no leftover wording for features that were removed), `test/project-storage.test.js`, `test/store-corrupt.test.js`, `test/project-legacy.test.js`, `test/locations.test.js`, `test/shared-rules.test.js`, `test/memory-roots.test.js`, `test/search.test.js`, `test/outputs.test.js`, `test/output-folder.test.js`, `test/ring-layout.test.js`, `test/action-done-note.test.js`, `test/core.test.js` | Project records go to the project folder or fall back to the data folder; a damaged `actions.json` is never read as empty or written over; old project files still load; the one module for locations; one safe-name and one secret pattern; the search index covers project folders; the classifier for finished deliverables agrees with the agreed examples; small parsing pieces |
| Schedule, bridge, pages | `test/routines.test.js`, `test/bridge.test.js`, `test/agents-page.test.js`, `test/agents-view.test.js`, `test/project-panels.test.js`, `test/browser-fixes.test.js`, `test/integration-fixes.test.js` | The Routines page's server side; the bridge client, its tool server and its routes (including with Routines off); view files rendered into a stand-in root; project panels from manifests; fixes found by driving the app in a browser, checked on the pieces that decide them; views never import the browser shell |
| The gates themselves | `test/gates.test.js` | The imports gate fails when a view is missing and names it; the browser finder works for Linux, macOS and Windows paths (with a faked platform); no gate can reach a real `claude`; the hygiene gate fails on a planted home path; the pages gate skips plainly with no browser |

## What the gates prove

Each gate prints one line of JSON (`pass`, details) and exits non-zero on failure. `npm run gates` runs them in order.

| Gate | Proves | Does not prove |
|---|---|---|
| `scripts/gates/imports.mjs` | Every relative import, `export from` and literal dynamic import points at a file that exists; every view a route, nav entry or project panel needs exists (derived from the built-in module manifests, so it follows `public/js/app.js`); no file under `public/js/views`, `public/js/dashboard` or `public/js/dropbin.js` imports the browser shell `app.js` | That the code runs; that a computed import path is right |
| `scripts/gates/boot-smoke.mjs` | The real server boots on a temp data folder and a free port, serves the page, throws nothing | Anything a browser does |
| `scripts/gates/pages.mjs` | Every route the dock offers, plus Settings, opens in headless Chromium, Chrome or Edge without console errors, uncaught exceptions or the app's error states | Anything after the page loads (no clicking through a flow); anything when no browser is found: the gate then prints `SKIPPED: no Chromium, Chrome or Edge was found...` and passes. `CHROMIUM=/path` points it at one |
| `scripts/gates/sample-module.mjs` | A one-file module dropped into `<data folder>/modules` shows up in `GET /api/boot`, its route answers and its view is served; taking it away leaves a healthy app; a project panel can be added the same way | That every module in the field loads |
| `scripts/gates/hygiene.mjs` | Tracked files contain no real home path, no e-mail address other than a placeholder, no key or token shape, no session or scratchpad temp path (generic example paths such as `/home/u` are allowed) | Anything in untracked files or in Git history |
| `scripts/gates/docs.mjs` | Documents do not name a repository path, npm script, route or setting key that does not exist; a test command that leaves out the set-up import | That the documents are right, only that what they name exists |

The hygiene gate also reads an optional file named `.hygiene-terms` at the repo root, with one term or regular expression per line, for names that belong to one person or company. That file is listed in `.gitignore`, so it is never committed; create it on your own machine.

All server gates start Jade through `startServer` in `scripts/gates/lib.mjs`, which puts the stand-in `claude` first on `PATH` and removes every folder that holds a real one.

## What the tests do not prove

Honest limits:

- **Real Claude Code.** No test starts a real `claude`. The stand-in parses real command lines and answers in the real stream format, but whether Claude Code accepts the flags and variables is not proved. The parity test shows that Jade's output did not change, not that it is accepted.
- **Real Bedrock or a gateway.** Never tested here. The Windows command quoting is not covered either.
- **Model quality.** The meeting end-to-end test uses a stand-in whose answers are built from the same expected file the test checks, so it proves the plumbing and the files, not extraction or checking quality. The "not supported" path is not exercised there (it is covered in `test/meetings.test.js` with a faked model).
- **Windows and macOS.** Tests run on one operating system. The Windows launcher (`scripts/jade.cmd`) and the PowerShell bridge route are not run by any test; the PowerShell test is skipped when `powershell.exe` is missing. Owner-only file modes are not checked on Windows, and a test that needs a read-only folder is skipped when run as `root`.
- **The browser.** There is no click-through test. Front-end code is tested by rendering views into a stand-in root with a stand-in api, plus the `pages` gate (page load only). A change to behaviour that needs a real click is unproved until someone tries it. This is deferred on purpose: `docs/adr/0013-deferred-on-purpose.md`.
- **Source-text tests.** A few tests read source files as text because no public seam exists: the file watchers in `jade.js` and `server/index.js` (`test/core.test.js`), CSS and class names (`test/browser-fixes.test.js`), a few front-end checks (`test/agent-allowance.test.js`, `test/effort.test.js`, `test/dreams.test.js`), and prompt-wording pins in several files. They pass for the wrong reason if code is deleted, and fail when code is reformatted. Prefer a behaviour test when you can.
- **Time.** A few tests order things by the clock (a short wait or a three-millisecond gap) because turns are keyed by time in the product.
- **Untested routes.** `opener.js`, `voicemodel.js`, `/api/engine/*`, `/api/connectors`, `/api/fs/*` and `/api/memory/*` have little or no direct test.

## How to add a test

Work red, then green: write the test first, through a public function or an HTTP route, watch it fail for the right reason, then change the code. The method is the one in `AGENTS.md`.

1. **Choose the seam.** Prefer a route on the real server (HTTP) or an exported function over reading source text. Do not mock your own modules; use a stand-in only for the Claude process and the network.
2. **Use the helpers** in `test/helpers/`:
   - `test/helpers/env.js`: `tmpHome(prefix, { apply })` makes `<tmp>/home` (the data folder), `<tmp>/claude` (Claude home) and `<tmp>/bin`, and returns `{ root, home, claudeHome, bin, env, cleanup }`. With `{ apply: true }` it also sets `JADE_HOME` and `JADE_CLAUDE_HOME` in this process, for a test that imports server code directly (do it before the first import of `server/core/config.js`). `put(file, text)` writes a file and its folders.
   - `test/helpers/fake-claude.js`: `installFakeClaude(bin, { reply, putOnPath })` writes the stand-in `claude` and returns `{ reply(text), calls() }`. `reply` sets what a one-shot run answers; `calls()` lists what it was asked (arguments and standard input). A conversation run answers `echo: <what was said>` in two streamed pieces, and never answers a message containing `HANG`, so a test can stop it.
   - `test/helpers/server.js`: `startServer({ home, claudeHome, bin })` starts the real server as a child on a free port with the key set, and returns `{ base, token, get, post, patch, del, stop, stderr }`; each request helper sends the key and returns `{ status, body }`. `freePort()` and `waitFor(fn, { timeout, message })` are exported too: wait for a condition, never for a fixed time.
3. **Name the test as a sentence** that says what must be true ("a switched-off module answers 403 on every route"). Put it in the file for its group, or a new `test/<topic>.test.js`.
4. **Keep it independent.** Use your own temp folders; never touch the data folder or port of a Jade that is running, `~/.claude`, or a real `claude`; use a free port and a temp data folder. Clean up what you start (`after` hooks), and stop servers you start by their own process id.
5. **Check the test can fail.** Break the code on purpose, see it fail, put it back.
6. **A change to what reaches Claude Code** needs the parity test too; read the next section first.
7. Run `npm test` and the gates before you finish.

Adding a **gate** works the same way: put it in `scripts/gates/`, use `lib.mjs` for the sandbox, port and stand-in, print one JSON line, add it to the `gates` script in `package.json`, and give it a test in `test/gates.test.js` that proves it fails on a planted fault.

## How to read a parity failure on a Bedrock machine

The test compares what Jade hands Claude Code with a frozen record. It cannot see a Bedrock machine; it protects it. The full guide is `test/fixtures/README.md`. In short:

1. The failure names the cell, for example `bedrockGateway | all | discovered | agentEdit | <model choice>`: connection type, model pins, model list, kind of run, model choice. Then it shows the old (expected) and new (actual) values.
2. Read what changed:
   - a different model name or a missing `--model`: how Jade maps a choice to a model changed. On a gateway this decides whether a request is accepted;
   - a different file content (`files.settings`, `files.mcp`, `files.system`): a setting, the approval tool config or the system prompt changed;
   - a different `fullEnv`: a variable was added, dropped or renamed. A missing proxy or certificate variable can stop a company network working;
   - a changed `ambient` scenario: a variable that was cleared now gets through, or the reverse;
   - different `requests` or `requestHeaders`: the connection check calls another address or sends the key differently;
   - "warm and cold arguments differ": a chat reply and an agent run no longer start Claude Code the same way. Fix the code; never re-record for this.
3. If the change is the one you meant to make, re-record and read the fixture diff line by line. Prove that every field the old fixture had is unchanged (`argv`, `env`, `engineModel`, `requests`, `err`) and that only new fields or runs were added, unless the ticket names a change. Say so in the commit message. If you cannot explain a line, do not accept it.
4. Never loosen the test or delete a fixture to get past a failure. The reason is in `docs/adr/0004-bedrock-gateway-locked-by-parity-test.md`.

The test runs more than a thousand stand-in processes in four parts side by side. Its limit is six minutes (five per part); on a busy machine it can be slow. A timeout is not a parity failure: run it alone on a quiet machine before you blame the code.
