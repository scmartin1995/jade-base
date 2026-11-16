# Known limits

Things Jade does not do, or does less well than it could, that were found in review and are left on purpose for now. Each says what it is in plain words, who it touches, how you would notice, which file owns it, and what would make it worth fixing. Anything that is a decision with a reason has its own record in `docs/adr/`; this page is for what has no such record. Words such as "stand-in" are explained in `GLOSSARY.md`.

How to use this page: before you report something as a bug, look here. When you fix one, delete its entry in the same change.

## Things a project manager could run into

**1. Nothing has been tried against a real Claude Code.**
Every test and gate uses a stand-in for `claude` (`docs/TESTING.md` says so). Nobody has recorded how often the Transcript agent misses an item in real meetings, or confirmed that the plugin layout read from `~/.claude` matches every Claude Code version. Affects: anyone relying on the meeting extraction without reading the review page. Notice: items missing from a meeting that were clearly said (the "Possibly missed" list helps). Owner: `agents/transcript/**`, `server/core/meetings.js`. Worth fixing when: someone runs ten real meetings through it and writes down the miss rate; this needs a real login, which tests may not use.

**2. Built-in agents are not copied into Claude Code on first run.**
They run from the app until you press Install on the Agents page (README says so). Affects: people who expect to find the agents inside Claude Code straight away. Notice: Claude Code's own agent list lacks the Jade ones. Owner: `server/core/agentfiles.js`. Worth fixing when: people ask for it; it is a one-line change but it writes into their `~/.claude`, so it needs a decision.

**3. Search and the chat side panel look at part of the history.**
Chat search covers the newest 300 chats; the chat page loads the last 40 turns and the "files changed" side panel is built from those 40; the memory page loads 3,000 files and a list with no limit returns the newest 2,000; the file ring animation draws about 20 frames a second. All written in `docs/PERFORMANCE.md`. Notice: an old chat that search does not find; a file change from far back that the side panel does not list. Owner: `server/core/search.js`, `server/core/store.js`, `server/core/memory.js`. Worth fixing when: someone has more than 300 chats and needs the old ones searched.

**4. Home and Projects count open actions up to 1,000.**
More than 1,000 open actions would show 1,000. Owner: `public/js/views/home.js`, `projects.js`, and the counts route in `server/api.js`. Worth fixing when: anyone has that many.

**5. Same-size, same-time outside edits are not noticed.**
If another program changes a watched file without changing its size or its modified time, Jade's remembered file list keeps the old entry until the next full check. Two programs saving `actions.json` within milliseconds: the last writer wins. Edits made outside Jade to `.state/chats/*` are not noticed until restart. Owner: `server/core/files.js`, `server/core/store.js`. Worth fixing when: people sync the data folder with a cloud drive while Jade runs.

**6. The memory index is kept only in memory.**
After each start it is rebuilt in the background (about 20 seconds on the seed data); search results are partial until it finishes. Owner: `server/core/memory.js`. Worth fixing when: start-up becomes frequent or the index grows past a minute.

**7. The tool list is sent whole with each run event, and the server hides keys in each stream line again.**
Costs a little time on long runs with many steps; nothing is wrong on screen. The memory page redraws as a whole on each `memory` event. Owner: `server/core/jobs.js`, `server/index.js`, `public/js/views/memory.js`. Worth fixing when: a long run makes the page sluggish.

**8. Lists that re-read files on every call.**
`agents.list()` and `skills.list()` re-read and re-hash their folders each time; `search.projectFor` is worked out for every hit; a single chat is parsed in one block. Notice: a page with hundreds of agents or skills opens slowly. Owner: `server/core/agents.js`, `skills.js`, `search.js`. Worth fixing when: `npm run bench` shows these above 200 ms on a realistic folder.

**9. A search or the file ring has no time budget beyond doing its work in slices.**
Owner: `server/core/search.js`, `slices.js`. Worth fixing when: a very large folder freezes the page.

**10. Chat cannot take you to the Meetings, Dashboards or Dreams pages.**
The list of pages Jade may open for you (`navigate`) is in its instructions, and changing those words changes what is sent to Claude Code, which the parity fixtures pin (`test/fixtures/provider-parity-*.json`). So it was left. Notice: asking "open my meetings" answers in words but does not move the page. Owner: `server/core/agents.js` (the sentence at "navigate {route}"). Worth fixing when: someone agrees to re-record the fixtures; the new routes are `meetings`, `dashboards`, `dreams`, `routines`.

**11. The voice model download has no tests.**
Owner: `server/core/voicemodel.js`. Notice: a failed download shows only an error line. Worth fixing when: it breaks on someone else's computer.

**12. Dashboards pack two ids into one value (`projectId~dashboardId`) and the usual three columns are found by heading words.**
A dashboard's id pair is joined with `~` in a few places in `server/core/dashboards.js`; the Recent meetings columns for decisions, risks and actions are found by the words "key point/decision", "risk/issue" and "action" in the record headings. Any other heading now shows as its own column (a new Transcript skill needs no code change), but those three are still matched by words. Worth fixing when: a skill is added whose heading contains one of those words and should be a column of its own.

## Windows, secrets and the Bedrock/gateway path

**12a. The app window is a browser underneath.**
Jade opens in a Chromium app window (`docs/adr/0019-app-window.md`), so the browser's right-click menu, refresh and shortcuts work, and the window is the browser's: if that browser is already running, Jade's window is part of it. Firefox and Safari have no app mode and get a tab. On some desktops (Linux under Wayland) the window is grouped by an address-derived name, not `--class=jade-base`. Not run by anyone on macOS or Windows (the tests check the command only). Owner: `server/core/browser.js`, `jade.js`. Worth fixing when: a macOS or Windows user reports the window not opening, or someone wants a real desktop app.

**13. A run that is allowed to run commands can read the key file and the engine key from its environment.**
Stated in `README.md` and `docs/SECURITY.md`. Affects: anyone who turns on "edits" for an agent they do not trust. Owner: `server/core/engines.js`, `server/mcp/approve.mjs`. Worth fixing when: Claude Code offers a way to give one tool a secret that a command cannot read.

**14. Windows: the tests and gates run there, a person has not.**
The test suite and the gates (`npm test`, `npm run gates`) now run on real Windows, macOS and Linux machines (GitHub's hosted ones, `.github/workflows/test.yml`) with Node 20, 22 and 24. That proves the server, the pages in a real headless browser, the file and folder handling and the watchers behave on those systems. It does not prove the whole product: the tests use a stand-in `claude`, never a real Claude Code, and nobody has yet run `scripts/jade.cmd`, `scripts/jade.cmd --stop` or a real Claude Code through Jade on Windows. A `)` or `#` in a home path is not handled by the launcher; the Windows launcher writes no log file; Windows command-line quoting is not covered by the parity test (`docs/TESTING.md`, ADR 0004).
Tests skipped on Windows, and why: those that make a read-only folder or an unreadable file with chmod, or check owner-only file modes (Windows does not enforce them, so the fall-back to the data folder when a project folder refuses writes is not tested there); the link to the secret key (links need rights an ordinary account lacks); the Unix launcher `scripts/jade` and the test that stops it; the PDF tools' stand-ins (Node cannot start a `.cmd` shim for the real `.exe` tools without a shell); the half of the bridge test that sends one very long command line (Windows refuses a command line over about 32,000 characters before the client starts); and the file-map watcher tests (watching differs there, and on Windows every unwatched folder is read again). Notice: Jade does not open on a Windows account whose folder name has those characters. Owner: `scripts/jade.cmd`, `server/core/engines.js` (`quoteCmdArg`). Worth fixing when: the first Windows user reports it; someone with a Windows computer must try it.

**15. `AWS_PROFILE`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from the parent environment pass through to the engine; `NODE_EXTRA_CA_CERTS` is removed unless set in `engine.env`.**
Pinned by tests; this is how it has always behaved. Affects: Bedrock users who rely on a corporate certificate (set `NODE_EXTRA_CA_CERTS` in `engine.env`, see `docs/TROUBLESHOOTING.md`). Owner: `server/core/provider.js`. Worth fixing when: someone decides it should differ; any change needs the parity fixtures re-recorded.

**16. `engines.js` still names the alias `sonnet` and one model id in the connection check.**
Locked by ADR 0003. Owner: `server/core/engines.js`. Worth fixing when: ADR 0003 is revisited.

**17. Parity coverage stops at the `web` connector, and nothing checks automatically that a re-record kept the old fields.**
Owner: `test/provider-parity.test.js`, `test/fixtures/README.md` (a person follows the procedure there). Worth fixing when: a connector other than `web` goes into a default agent.

**18. Some changes to what reaches Claude Code are in the ADRs only in part.**
ADR 0004 and 0006 name the extra read refusals and `icacls`; they do not yet name `maskHeaders`, the atomic write of the connection file, the split of `readImport`, or `quoteCmdArg`. Nothing is hidden (they are in the code and in `docs/TESTING.md`). Owner: `docs/adr/`. Worth fixing when: the ADR set is next edited.

## About the code (no effect on what you see)

**19. Feature code lives in `server/core`, and the README layout list is out of date.**
Meetings, dashboards, dreams and transcripts are in `server/core` and their routes are in `server/api.js` or the module files (ADR 0013 covers `api.js` and `store.js` only). The README "Layout" section still lists the earlier files. Owner: `README.md`, `server/core/`. Worth fixing when: a second person works on one of these features.

**20. Small duplications and untidy spots.**
`sha` helpers exist in `allowances.js`, `agentfiles.js`, `dreams.js` and `skeptic.js` (the last two cut the digest short on purpose); the Claude home folder is worked out in `config.js` and `claudehome.js`; defaults are repeated in `dreams.js`, `meetings.js` and `transcripts.js`; `extract.js` has `extractDetailed` beside `extractText`; the dashboard spec shape is written in `dashboardspec.js`, the layouts and the builder prompt; the effort helper is imported under four names (`effortOf`, `effort_`, `effort`); status strings are repeated beside the `ACTIVE` list; `export { section as sectionText }` in `meetings.js` exists for a test; `parseAgent` repeats a `key(all, ...)` call per field; `search.js` skips folders by a name pattern that still holds a leftover of the app's earlier name; `claudesessions.js` has a bare block; `dashboards.js` imports `quote` from `dreams.js`; `jobs.js` special-cases the id `skill-runner`. Affects: whoever edits those files. Worth fixing when: one of them causes a mistake, or the file is next changed.

**21. Test seams in production code.**
`meetings.js` has `use()` and a late `import()`; `agents.js` and `jobs.js` take starter functions (`useStarter`, `setLauncher`); `review.js` and `jobs.js` import each other; some modules import late. Owner: those files. Worth fixing when: a real dependency-injection seam is wanted for a second use.

**22. `agentfiles.js` and `agents.js` do several jobs each; `store.js` is not split.**
ADR 0013 decides `store.js`; the agent files are not covered. Worth fixing when: a change needs to touch two of its jobs at once.

**23. Front-end duplication.**
`public/js/views/setup.js` builds its report box twice; `public/js/actionsource.js` takes an `esc` parameter it does not need; the link-to-a-path rule is written in `table.js` and `meetings.js`; `agents.js` (the page) is large. Owner: `public/js/**`. Worth fixing when: that page is next changed.

**24. `docs/PERFORMANCE.md` has one measured run for the "after" column, not three; the first file walk took 3.0 s (was 3.9 s).**
Worth fixing when: the numbers are quoted.

**25. A watch test failed once under heavy load.**
`test/closing-fixes.test.js` "two parts watching one folder share one set of watches" passes alone; when many test files run at once it can fail. Owner: `server/core/util.js` (`watchShared`) and that test. Worth fixing when: it fails in a normal `npm test`.

## What the tests do not prove

**26. Whole-source and wording tests.**
About 40 tests read source text or pin prompt wording (`test/models-offerable.test.js`, parts of `core.test.js` and others), some assert only that a value is truthy, some check root-only or platform-only conditions, and stand-ins that read `argv` instead of behaving. They pass for the right reasons today but break when code is reworded. Worth fixing when: one fails on a harmless rename.

**27. The meetings end-to-end test answers from its own expected file.**
`test/meetings-e2e.test.js` proves the plumbing (upload, read, check, record), not the quality of extraction; item 1 above is the real check. The test file also depends on the order of its own steps.

**28. Remaining sleeps and clocks.**
20 and 100 ms sleeps remain in `test/permissions.test.js`, `test/output-folder.test.js`, `test/bridge.test.js`; free ports are found by closing and reusing a number, which can race; `PATH` is set per file; the permissions test uses `os.homedir`.

**29. Shared helpers are used by 15 of 86 test files.**
67 still build their own temp folder, 12 define their own `put`, 7 write their own stand-in `claude`, and the HTTP client is written several ways (`test/helpers/` has the shared ones). Worth fixing when: a helper changes and the copies drift.

**30. Routes with no test.**
`/api/engine/*`, `/api/connectors`, `/api/changes`, `/api/counts`, `/api/modules`, `/api/routines`, the open, reveal and choose routes under `/api/fs/`, `/api/skeptic`; the static `/` path traversal; and by-name-only coverage for `review.checkBuild`, `saveActions`, `explain.segment`, `native.chooseFolder`, `models.fromEndpoint`.

**31. The route order of a hot reload.** Fixed (kept in place); see `test/router-order.test.js`. Listed so it is not looked for.

## Changes nobody asked for that were kept

Each was weighed by asking whether a project manager would be surprised.

- Chats are stored one file each in `.state/chats/`; the old `chats.json` is renamed `chats.json.migrated`. Asked for; a release note is wanted.
- `.state/token` is rewritten to hold the key when `JADE_TOKEN` is set; `.state`, `tmp` and `run` are made owner-only on existing installs; `mcp-jade-*.json` left by older versions are deleted at start. All follow from keeping the key out of a run's reach. Invisible.
- Names given to meeting records and Dashboard files lose leading dots (so a title such as `.env` cannot make a hidden or special file). A record's name always starts with its date, so this rarely shows.
- A meeting's working title drops a leading word "Zoom" (the meeting list already did; the reading step now agrees, so the same title shows in both). The title can be edited on the review page.
- Blank entries in a project's folder list are ignored everywhere.
- Refusal sentences from the bridge and a chat's "run agent" action now use the queue's sentence.
- Dreams reads project folders through the shared location rule (no visible change).
- Routines and Voice answer 403 when their module is off; unhandled errors are logged and the server keeps running.
- The Settings and set-up pages show an "In use now" note for the checking agent.
