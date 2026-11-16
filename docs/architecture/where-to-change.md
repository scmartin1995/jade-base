# Where do I change X?

One row for each common change: the files to touch, the test to run, and the document to read first. Back to the [architecture map](../ARCHITECTURE.md).

How to use it:

1. Find the row. Read the document in the last column before you edit.
2. Write the failing test first (helpers are in `test/helpers/`), see it fail, make the change, see it pass.
3. Run the test named in the row, then `npm test` and `npm run gates` before you finish.
4. If your change moves or adds a path, route, setting or npm script that a document names, fix the document in the same commit. `node scripts/gates/docs.mjs` will tell you what is wrong.

Two rows are **locked**: they change what Jade hands to Claude Code (its command line, environment or settings files), which people on Amazon Bedrock or a company gateway depend on. Read the warning in those rows before you start.

## Pages, modules and routes

| I want to... | Files to touch | Test to run | Read |
|---|---|---|---|
| Add a module (a switchable feature) | `server/modules/<id>.js`; its views in `public/js/views/` (a user's module: `<data folder>/modules/<id>.js` and `<data folder>/modules/<id>/views/`) | `node scripts/gates/sample-module.mjs`, `npm run test:one -- test/modules.test.js` | [EXTENDING.md](../EXTENDING.md), [ARCHITECTURE.md](../ARCHITECTURE.md) section 12 |
| Add a page to the navigation | The module's manifest (`nav`, `views`), a file in `public/js/views/` that exports `default { title, render }` | `node scripts/gates/imports.mjs` (checks the view file exists), `node scripts/gates/pages.mjs` (opens every page) | [EXTENDING.md](../EXTENDING.md), section 13 of the map |
| Add a card to every project page | `projectPanels` in the manifest; a view file; add its event name to `refreshOn` in `public/js/views/project.js` if it must update by itself | `npm run test:one -- test/project-panels.test.js` | [EXTENDING.md](../EXTENDING.md) "Project panels" |
| Add a route inside a module | `init({ on })` in the module's manifest (the module guard is automatic) | a test with `test/helpers/server.js`; see `test/server-edges.test.js` | [ARCHITECTURE.md](../ARCHITECTURE.md) section 2 |
| Add a core route | `server/api.js` (`on(...)`); if it belongs to a switchable module wrap it with `modules.only('<id>', fn)`; if it returns files, refuse secrets with `files.isSecret` | `npm run test:one -- test/server-edges.test.js` and a new test beside it | section 2 of the map, [SECURITY.md](../SECURITY.md) |
| Add a route that streams a file or takes an upload | a raw route (`{ raw: true }`); give the stream an `'error'` listener | `npm run test:one -- test/upload-413.test.js test/server-edges.test.js` | [EXTENDING.md](../EXTENDING.md) |
| Add a setting (with a control in Settings) | `DEFAULTS` in `server/core/config.js` (or `defaults` in a module's manifest); the control in the right section of `public/js/views/settings.js` (`data-k="group.name"` saves it by itself) | `npm run test:one -- test/server-edges.test.js` ("every setting the server reads has a default"), `node scripts/gates/docs.mjs` | [EXTENDING.md](../EXTENDING.md) "Adding a setting with a control in Settings" |
| Change what the page shows live | emit an event with `emit('data', { kind })` (`server/core/bus.js`); list the kind in the view's `refreshOn` | the view's own test, or `node scripts/gates/pages.mjs` | section 13 of the map |
| Add a helper that views share | `public/js/ui.js` (no browser shell import; views never import `public/js/app.js`) | `node scripts/gates/imports.mjs`, `npm run test:one -- test/integration-fixes.test.js` | section 13 of the map |
| Change how the app looks | `public/css/jade.css` | `node scripts/gates/pages.mjs` | section 13 of the map |

## Agents, skills and prompts

| I want to... | Files to touch | Test to run | Read |
|---|---|---|---|
| Add a built-in agent, with or without a schedule | `agents/<id>.md` with `jade-` keys (`jade-handler` or `jade-loop` makes it runnable; `jade-module` ties it to a module; `jade-schedule` runs it on its own, only while the Routines module is on, and a test must switch Routines on) | `npm run test:one -- test/agents-claude.test.js test/agent-allowance.test.js` | [EXTENDING.md](../EXTENDING.md) "Adding an agent" and, for a schedule, "Adding a built-in agent that runs on a schedule" |
| Change an agent's prompt | the agent's own file in `agents/` (the PM's copy in `<data folder>/agents/` wins for the PM) | `npm run test:one -- test/agentfiles.test.js`; for the Transcript agent `test/meeting-agent-files.test.js` | section 8 of the map |
| Change how Jade speaks in chat | `agents/jade/soul.md` (the shipped default; the PM's `soul.md` in the data folder wins) | `npm run test:one -- test/chatreply.test.js` | section 4 of the map |
| Change the rules and actions a chat reply can use | `ACTIONS_GUIDE` and `applyActions` in `server/core/agents.js`, with a test of the new action | `npm run test:one -- test/chat-http.test.js test/mayrun.test.js` | section 4 of the map |
| Add a context section an agent can ask for (`jade-context`) | `agents.addContext(name, fn)` from a module's `init`, or the `builders` list in `server/core/agents.js` | `npm run test:one -- test/modules.test.js` | [EXTENDING.md](../EXTENDING.md) |
| Add a skill | `<data folder>/skills/<name>/SKILL.md`, or `agents/<id>/skills/<name>/` for one an agent owns | `npm run test:one -- test/skills-sources.test.js` | [EXTENDING.md](../EXTENDING.md) "Adding a skill" |
| Add a handler for what an agent's finished run does | `agents.addHandler(name, fn)` in a module, and `jade-handler: <name>` in the agent file | `npm run test:one -- test/modules.test.js` | section 3 of the map |
| Change who may run an agent or skill, and how | `server/core/mayrun.js` only (callers do not decide for themselves) | `npm run test:one -- test/mayrun.test.js` (it walks every combination) | section 8 of the map, [SECURITY.md](../SECURITY.md) |

## Meetings, dashboards, Dreams

| I want to... | Files to touch | Test to run | Read |
|---|---|---|---|
| Add a transcript skill (a new kind of thing to pull out of a meeting) | `agents/transcript/skills/<name>/SKILL.md` and `schema.json`, and its name on the `skills:` line of `agents/transcript.md` | `npm run test:one -- test/meeting-agent-files.test.js test/meetings.test.js` | [EXTENDING.md](../EXTENDING.md) "Adding a skill to the Transcript agent" |
| Change what the transcript is checked against | `agents/skeptic/` files and the criteria in `agents/transcript.md` and the skills (the checking agent is given the agent's text and the one skill) | `npm run test:one -- test/meetings.test.js test/meetings-e2e.test.js` | section 5 of the map |
| Accept another transcript file type | `EXTENSIONS` and the reader in `server/core/transcripts.js`; `TRANSCRIPT_TYPES` in `public/js/dropbin.js`; the list of types in `README.md` (the docs gate cannot catch that one) | `npm run test:one -- test/transcripts.test.js` | section 5 of the map |
| Change the meeting record's layout | `section` and `writeRecord` in `server/core/meetings.js` | `npm run test:one -- test/meetings.test.js` | section 5 of the map |
| Change the upload size or length limits | `meetings.maxBytes` and `meetings.maxChars` (defaults in `server/modules/meetings.js`) | `npm run test:one -- test/transcripts.test.js test/upload-413.test.js` | section 5 of the map |
| Add a dashboard layout | one entry in `LAYOUTS` in `server/core/dashboardspec.js`; `public/js/dashboard/layouts/<id>.js`; add it to `scripts/gates/fixtures/dashboard.json` | `npm run test:one -- test/dashboard-render.test.js test/dashboard-robust.test.js` | [EXTENDING.md](../EXTENDING.md) "Adding a dashboard layout" |
| Add a data source or field to dashboards | `SOURCES` in `server/core/dashboardspec.js` (the model's schema and the page's field list follow from it) and `collect()` in `server/core/dashboards.js` (build the rows, cap them there, return them under `sources`); add the source to `scripts/gates/fixtures/dashboard.json` if a layout should show it | `npm run test:one -- test/dashboard.test.js test/dashboard-robust.test.js` | section 6 of the map |
| Change the dashboard questions | `server/modules/dashboards/questions.json` (or the PM's copy in `<data folder>/dashboards/`) | `npm run test:one -- test/dashboard.test.js` | [EXTENDING.md](../EXTENDING.md) "Changing the dashboard questions" |
| Add a kind of Dreams idea | `agents/dreams/kinds.json`, and what accepting it creates in `server/core/dreams.js` | `npm run test:one -- test/dreams.test.js` | section 7 of the map |

## Safety, secrets and the connection

| I want to... | Files to touch | Test to run | Read |
|---|---|---|---|
| Change what is hidden as a secret in text | `PATTERNS` and `SECRET_NAME` in `server/core/redact.js` (the patterns are not exported; callers use `redact()`). A second, separate list decides which connection variables Settings and Diagnose show only as "(set)": `SECRET` and `maskHeaders` in `server/core/provider.js` (locked, see the connection row below) | `npm run test:one -- test/hardening.test.js test/shared-rules.test.js test/run-secrets.test.js` | [SECURITY.md](../SECURITY.md) |
| Change when Jade asks before a run changes something | `server/core/permissions.js` (`classify`, `decide`, `jadeOwned`); its plain-words question in `server/core/explain.js` | `npm run test:one -- test/permissions.test.js test/hardening.test.js test/explain.test.js` | section 3 of the map, [SECURITY.md](../SECURITY.md) |
| Make a route refuse another secret place | `isSecret` in `server/core/files.js` | `npm run test:one -- test/security.test.js test/server-edges.test.js` | section 2 of the map |
| Change the key, the start link or the cookie | `server/core/auth.js`, `server/index.js`, `server/core/gatepage.js`, `server/core/opener.js` | `npm run test:one -- test/key-gate.test.js test/run-secrets.test.js` | section 1 of the map, [SECURITY.md](../SECURITY.md) |
| Change the default port | `DEFAULT_PORT` in `server/core/config.js`, and the copies that [ARCHITECTURE.md](../ARCHITECTURE.md) section 1 lists | `npm run test:one -- test/server-edges.test.js` ("the default port is written once") | section 1 of the map |
| Change what the file ring calls a finished deliverable | `DEFAULT_RULES` in `server/core/outputs.js`, or the setting `output.rules` | `npm run test:one -- test/outputs.test.js test/ring-layout.test.js` | section 15 of the map |
| **Change a connection variable, the command line or a model mapping** (locked) | `server/core/provider.js` (`ROUTING_VARS`, `EXTRA_ENV`), `server/core/engines.js` (`claudeArgs`, `engineModel`), `server/core/models.js`, `server/core/warm.js` | `npm run test:one -- test/provider-parity.test.js` must still pass; it takes minutes | section 10 of the map, `test/fixtures/README.md`, `docs/adr/` |
| Change the permission tool's settings handed to a run | `permissionMcpFile` in `server/core/engines.js`, `server/mcp/approve.mjs` (locked: the settings file is pinned) | `npm run test:one -- test/run-secrets.test.js test/provider-parity.test.js` | sections 3 and 10 of the map |

## Data, projects, the bridge and the checks

| I want to... | Files to touch | Test to run | Read |
|---|---|---|---|
| Add a file or folder to the data folder | the code that owns it, and a row in `docs/architecture/data-folder.md` | a test through the owning function; `node scripts/gates/docs.mjs` | [data-folder.md](data-folder.md) |
| Change where a project's files live | `server/core/locations.js` only (callers ask it; none expands `~` or loops over `project.folders` by hand) | `npm run test:one -- test/locations.test.js test/project-storage.test.js` | section 11 of the map |
| Add a field to a project | `saveProject` in `server/core/store.js`, the project page in `public/js/views/project.js` | `npm run test:one -- test/project-legacy.test.js test/project-storage.test.js` | section 11 of the map |
| Change which files a chat may attach | `REFUSED` and `saveAttachment` in `server/core/store.js` | `npm run test:one -- test/images.test.js` | section 4 of the map |
| Add a command to the Claude bridge | `bridge/jade-bridge.mjs`, `bridge/jade-mcp.mjs`, `server/core/bridge.js` and the `/api/bridge/...` routes in `server/api.js` | `npm run test:one -- test/bridge.test.js` | section 14 of the map, `bridge/README.md` |
| Add a gate | `scripts/gates/<name>.mjs` (use `scripts/gates/lib.mjs`), add it to `gates` in `package.json`, describe it in the gates table of `docs/TESTING.md` | a test in `test/gates.test.js` that makes it fail on purpose | [TESTING.md](../TESTING.md) |
| Add a test helper | `test/helpers/` (`env.js`, `fake-claude.js`, `server.js` exist already) | the tests that use it | [TESTING.md](../TESTING.md) |
| Change a time limit or a count (how long before a chat is called stuck, how many runs are kept, how many files are indexed) | stuck, idle and warm-worker numbers: `STUCK_MS`, `IDLE_MS`, `MAX_WORKERS` in `server/core/warm.js` (**locked** file); runs kept: the `150` and `20000` in `server/core/jobs.js`; agents at once: the setting `concurrency`; scheduler catch-up: `CATCH_UP_MS` in `server/core/scheduler.js`; index and file-map caps: `MAX_FILES` and `MAX_BYTES` in `server/core/memory.js`, `MAX` in `server/core/files.js`; every cap is listed in [PERFORMANCE.md](../PERFORMANCE.md) | the owning file's test (`npm run test:one -- test/warm.test.js` for warm.js, `test/memory-index.test.js`, `test/file-map.test.js`) | [PERFORMANCE.md](../PERFORMANCE.md) |
| Make something faster, or remember a result | read [PERFORMANCE.md](../PERFORMANCE.md) first: it must not block the server (cut work into slices), must be bounded in size, and must be checked against the disk; then the file that owns the data (`server/core/memory.js`, `files.js`, `store.js`, `search.js`, `outputs.js`) | `npm run test:one -- test/memory-index.test.js test/file-map.test.js test/store-notes-actions.test.js test/closing-fixes.test.js`, then `npm run bench` before and after | [PERFORMANCE.md](../PERFORMANCE.md), `docs/adr/0015-index-built-in-the-background-in-slices.md`, `docs/adr/0016-one-file-per-chat-with-safe-migration.md`, `docs/adr/0017-remembered-lists-are-checked-against-the-disk.md` |
