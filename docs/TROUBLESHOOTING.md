# Troubleshooting

Find the sentence that sounds like your problem. Each entry says what it means, how to check, how to fix it, and which file in the repository owns the behaviour (for whoever, or whichever AI assistant, changes it). Words such as "data folder", "key" and "run" are defined in `GLOSSARY.md`. For how the pieces fit together, see `docs/ARCHITECTURE.md`.

## Where to look first

- **The data folder** is `~/JadeBase` unless `JADE_HOME` says otherwise. **The state folder** is `.state` inside it. In this document `<data folder>` means that folder.
- **Diagnose** (in the app): Settings → Engine → **Diagnose**, or the same button in the first-run set-up. It runs a real test question and shows a report: Claude Code's location and version, which connection Jade uses (with the key hidden), the names of the environment variables Claude Code gets, the result of the test, and the engine's own error words if it failed. The report has a **Copy** button. Owner: `diagnose` in `server/core/engines.js`; the box is `showDiagnose` in `public/js/providerform.js`.
- **Run output**: every run (chat reply, agent, check) is a job. The Activity drawer and the Agents page (Runs) show its output, its steps and its error, with keys hidden. The last 150 are kept in `<data folder>/.state/jobs.json` (the last 20,000 characters of each). Owner: `server/core/jobs.js`.
- **Server log**: if you started Jade with `npm start` or `npm run dev`, everything is printed in that terminal window. If you started it with the `jade` command on Linux or macOS, the log is `~/.local/state/jade/jade.log` (or under `XDG_STATE_HOME` if you set it). The Windows launcher (`scripts/jade.cmd`) writes no log file; start Jade with `npm start` in a terminal to see messages. The start link (which carries the key) is never written to a log. Owner: `jade.js`, `scripts/jade`.
- **A meeting's own file**: `<data folder>/.state/meetings/<id>.json` holds its status, error, items and checks. It contains the transcript's words: do not paste it anywhere you would not paste the meeting.
- **Skeptic's verdicts**: `<data folder>/.state/skeptic/verdicts.jsonl`, one line per verdict. Owner: `server/core/skeptic.js`.
- **File changes a run made**: `<data folder>/.state/changes.json` and the kept earlier versions in `<data folder>/.state/backups`. The Settings → Permissions page lists them and can restore. Owner: `server/core/permissions.js`.

## Starting and opening Jade

### Jade opens a page asking for a key

**Means.** You reached Jade's address without the key, so Jade shows a plain page with a box. It is not an error. The key is kept in `<data folder>/.state/token` and reaches a browser through the start link (Jade answers it with a short "Opening Jade" page that sets the key and moves on; if you see the key box right after using the start link, that is a bug to report).
**Check.** Look in the terminal where Jade started for a line `Open Jade: http://127.0.0.1:<port>/?key=...`. A message "Missing or wrong Jade key" in the app means the same.
**Fix.** Start Jade again from its shortcut or with `npm start` (they open the window with the key). Or paste the key, or the whole link, into the box. Do not share the link: anyone who has it has the key.
**Owner.** `server/core/auth.js`, `server/core/gatepage.js`, `server/index.js`. Background: `docs/adr/0005-server-key-and-start-link.md`.

### Jade will not start: "Port ... is busy"

**Means.** Another program (often an earlier Jade) is using the port. The launcher retries a few times, then stops with "Port <number> stays busy; another program is using it."
**Check.** The terminal says `Port <number> is busy. Is Jade already running? Set JADE_PORT to use another port.` If it says `Jade is already running (launcher <number>, data folder ...)`, a Jade for the same data folder is already up.
**Fix.** If it is Jade, use it: open it from its shortcut. To stop it, run `jade --stop` (Linux, macOS) or `scripts\jade.cmd --stop` (Windows). To run a second Jade, give it its own data folder and port: `JADE_HOME=~/JadeTwo JADE_PORT=4790 npm start`. Tests and trial runs the same way: a free port and a temp data folder, never the port or data folder of a Jade that is running.
**Owner.** `jade.js` (one launcher per data folder, the pid file `<data folder>/.state/jade.pid`), `server/index.js` (the port message), `server/core/config.js` (`DEFAULT_PORT`; see [ARCHITECTURE.md](ARCHITECTURE.md) section 1).

### Jade keeps crashing and then stops

**Means.** The launcher restarted the server five times and it still failed to stay up. The message is "Jade keeps crashing; stopping. Fix the error above, then run npm start again."
**Check.** Read the error printed above that line. Typical causes: Node older than 20 ("Jade needs Node 20 or newer"), an edit to a file in `server/` that does not parse, or a module file in `<data folder>/modules/` that throws.
**Fix.** Run `node --version`. If you added a module of your own, move it out of `<data folder>/modules/` and start again. Changing core files restarts the server by itself; a typing mistake in one stops it until fixed.
**Owner.** `jade.js`; module loading in `server/core/modules.js` (a bad manifest is skipped with a line in the log).

### The window does not open, or opens blank

**Means.** The launcher could not start the browser as an app window, or the browser opened a stale file, or Jade opened a tab where you expected a window.
**Check.** The terminal says one line: `Jade opened in its own window.`, `Jade opened in a browser tab.`, or `No Chrome, Edge, Chromium or Brave was found, so Jade opened in a browser tab.` If it says `Open http://127.0.0.1:<port> in your browser...`, nothing could be started. If the line says "own window" but you see nothing, the window may have opened inside a browser that was already running (look for it there or on another desktop).
**Fix.** Install Chrome, Chromium, Edge or Brave (Firefox and Safari have no app window), or point `JADE_BROWSER` at one (`JADE_BROWSER=/path/to/chrome npm start`). Or use the `Open Jade:` link from the terminal in any browser.
**Owner.** `jade.js` (`openBrowser`), `server/core/browser.js`, `server/core/opener.js`, `scripts/jade`, `scripts/jade.cmd`.

### I want a tab in my browser, not a separate window

**Fix.** Start with `npm start -- --tab`, or set `JADE_WINDOW=tab`, or choose "A tab in my browser" in Settings → Look → Window (`window` in `config.json`: `'app'` or `'tab'`). `--tab` beats `JADE_WINDOW`, which beats the setting. If a window is already open you can also just use any browser with the `Open Jade:` link.
**Owner.** `server/core/browser.js` (`windowMode`), `server/core/config.js`.

### A save could not be written because another program held the file

**Means.** On Windows an antivirus scanner, a backup or sync program or the search indexer can hold one of Jade's files for a moment, so the new copy cannot be moved over it. Jade tries again for about a second. If the file is still held, the recent runs and the routines' last-run times are kept in memory and written again a few seconds later or at the next minute; the next successful save always holds the latest state.
**Check.** The terminal shows `Jade could not save the recent runs (EPERM); trying again.` (or `... when the routines last ran ...`). `EPERM`, `EBUSY` or `EACCES` means another program held the file.
**Fix.** Usually none. If it repeats, exclude the Jade data folder from that program's scan or sync.
**Owner.** `writeText` in `server/core/util.js`, `server/core/jobs.js`, `server/core/scheduler.js`.

### I changed a file and Jade did not notice

**Means.** Pages, agent files, skills, settings and `engine.env` are watched and apply at once. Core code files restart the server (after any running replies finish, up to 10 minutes). Module files are read at start.
**Check.** The terminal shows `changed, restarting the server`, or `restarting once the N running replies finish`.
**Fix.** If nothing happens, check the file was saved in the same folder Jade watches, and restart Jade. A same-content rewrite is deliberately ignored.
**Owner.** `jade.js`, `server/index.js` (watchers).
**After a folder was deleted.** A watcher is closed as soon as its folder is gone, or if it reports more than 500 changes in a second (`guardedWatch` in `server/core/util.js`, `docs/adr/0018-a-watcher-is-closed-when-its-folder-is-gone.md`). The folder is watched again when it comes back, within a few seconds; until then the file list is checked on the disk instead.

## Connecting to Claude

### No models are listed

**Means.** Jade only offers models it discovers; it found none (and does not guess). Straight after first set-up the list is empty until the connection check has run, and that first check uses the account's default model. On a plan it asks Claude Code for its list; on a gateway or Bedrock it also asks the endpoint.
**Check.** Settings → Engine shows "No models were found. Run Diagnose". Run **Diagnose**: the line `endpoint listed N model(s)` and the notes tell you whether Claude Code was found and whether the endpoint answered. The result is cached in `<data folder>/.state/models.json` (its `notes` field says why a source gave nothing).
**Fix.** Make sure Claude Code is installed and logged in (`claude auth login`). On a gateway or Bedrock, check the address and key, then press **Check and save**. Some gateways do not publish a model list; Jade then shows the names Claude Code accepts. Use the refresh button next to the model list (Settings → Engine, or the set-up step) to ask again.
**Owner.** `server/core/models.js`. Background: `docs/adr/0003-discovered-models-only.md`.

### The Bedrock or gateway test fails

**Means.** The one-token test request, or the test run of Claude Code, did not succeed.
**Check.** Run **Diagnose** and read the line starting `check:`.
- `401` or `403 ... the key or token was rejected`: wrong or expired key, or the wrong kind of key for the address (a Bedrock key for a gateway, say). For a gateway, the message suggests trying the other key type.
- `Could not reach <address>: timed out` or a network code: wrong address, no route from this computer, or a company proxy. Proxy and certificate variables (`HTTPS_PROXY`, `NO_PROXY`, `SSL_CERT_FILE`) are passed to Claude Code; `NODE_EXTRA_CA_CERTS` is removed unless it is set in `<data folder>/engine.env`, so put it there if your company certificate is needed.
- `500` and above: the gateway or Bedrock is failing; try later or ask who runs it.
- A passing web check but a failing Claude Code check: read `engine output (last 1200 chars, masked)` in the report.
**Fix.** Correct the values in Settings → Engine (or **Use my Claude Code settings** if Claude Code already works on this computer), then **Check and save**. The key is stored in `<data folder>/engine.env`; do not paste that file anywhere.
**Owner.** `test` and `diagnose` in `server/core/engines.js`, `server/core/provider.js`. These are locked: see `docs/adr/0004-bedrock-gateway-locked-by-parity-test.md`.

### Bedrock works in Claude Code in a terminal, but not in Jade

**Means.** Jade does not start Claude Code the way your terminal does, on purpose, so a setting that works in a terminal can be missing here. Three differences matter (the reasons are in [ARCHITECTURE.md](ARCHITECTURE.md) section 10, and `docs/SECURITY.md`):

1. **A private Claude Code folder.** With Bedrock or a gateway, Jade runs Claude Code with its own configuration folder, `<data folder>/.state/engine-home` (it sets `CLAUDE_CONFIG_DIR` to it). Your `~/.claude/settings.json` is therefore not read, and any `env` block in it has no effect in Jade. Your agents and skills are linked into the private folder so they still show up (`server/core/enginehome.js`). Nothing in that folder holds a login.
2. **Routing variables from the program that started Jade are removed.** `provider.scrub` deletes every name in `ROUTING_VARS` (`server/core/provider.js`) from the environment before each run. That list includes `AWS_REGION`, `AWS_DEFAULT_REGION`, `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_*` (address, key, model names), the `CLAUDE_CODE_USE_*` switches and `NODE_EXTRA_CA_CERTS`. Other variables are passed on unchanged: `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `HTTPS_PROXY`, `NO_PROXY`, `SSL_CERT_FILE`, `HOME`. Your `~/.aws` files are read as usual because `HOME` is unchanged.
3. **What Jade sets itself** comes only from `<data folder>/engine.env` (every variable in that file is passed as it is) plus the quiet variables (`QUIET` in `provider.js`: no telemetry, no automatic update).

**Check.**
1. Run **Diagnose** (Settings, Engine). Read these lines: `provider:` (does it say Bedrock?), `engine config dir:` (it should end in `.state/engine-home`), `engine env (names only):` (the names Jade passes; `AWS_REGION` must be there for Bedrock) and `check:`.
2. Open `<data folder>/engine.env` and confirm the region and the key or profile you use in the terminal are in it. Do not paste this file anywhere: it holds a key.
3. In a terminal, run `env | grep -E '^AWS_|^CLAUDE_CODE_|^ANTHROPIC_'` (names only: add `| cut -d= -f1`). Any name from `ROUTING_VARS` there is ignored by Jade; put its value in `engine.env` instead (Settings, Engine does this for the common ones, or **Use my Claude Code settings** copies them from `~/.claude/settings.json`).
4. For a profile or single sign-on: the profile name must reach Jade (`AWS_PROFILE` in the environment Jade was started from, or in `engine.env`), and the sign-in must be current (`aws sso login`).

**Fix.** Put the missing variable in `engine.env` (or in Settings, Engine), then **Check and save**. If the name is in `ROUTING_VARS`, Jade will only use the value from `engine.env`. Do not edit `provider.js` for this: it is locked by a test (`docs/adr/0004-bedrock-gateway-locked-by-parity-test.md`).
**Owner.** `scrub`, `env`, `ROUTING_VARS`, `EXTRA_ENV` and `engineHome` in `server/core/provider.js`; `server/core/enginehome.js`; `diagnose` in `server/core/engines.js`.

### "Claude Code is not installed"

**Means.** `claude` is not on the `PATH` Jade was started with.
**Check.** Diagnose shows `claude: NOT FOUND on PATH`. In a terminal, `claude --version`.
**Fix.** `npm install -g @anthropic-ai/claude-code`, then restart Jade from a terminal that can run `claude`. A launcher started from a desktop shortcut may have a shorter `PATH` than your terminal.
**Owner.** `detect` in `server/core/engines.js`.

### The first-run set-up will not finish

**Means.** Set-up refuses to finish until the server has heard Claude answer a test with exactly these settings. It answers 409 "not yet heard back from Claude".
**Check.** Press **Check and save** on the connection step. Any change to the connection after a passing test makes the record stale.
**Fix.** Run **Check and save** again after the last change; if it fails, use the entry above. Set-up can be left and continued later from **Finish set-up** in the top bar.
**Owner.** `server/core/connection.js`, `server/modules/setup.js`.

### A reply stops with "usage limit" or an hour-long pause

**Means.** Your Claude plan's usage limit was reached. Jade does not count it as a failure: a scheduled run waits until the reset; a meeting shows "Paused until HH:MM because the usage limit was reached" and carries on by itself.
**Check.** The run's error text names the reset time ("resets 6:40pm"). Jade reads it as this computer's local time; with no time given it waits an hour.
**Fix.** Wait: a paused meeting carries on by itself at the reset. Using a gateway or Bedrock avoids the plan limit.
**Owner.** `limitUntil` in `server/core/judge.js`; `server/core/meetings.js` (`pump`, `resume`).

## Meetings

### A meeting stays on "Reading"

**Means.** "Reading…" is shown for both `queued` and `reading`. Meetings are done one at a time, so a meeting waits behind another one, or behind a usage-limit pause. It may also be waiting for a free slot (Jade runs two agents at a time: the setting `concurrency`).
**Check.** Open **Meetings**: is another meeting "Pulling out key points…" or "Being checked…"? Look at the Activity drawer for the Transcript run and its output. If Jade was restarted while it ran, the meeting goes round again on start; the run list may show "Interrupted by restart".
**Fix.** Wait for the earlier meeting. If nothing is running and it still says Reading, restart Jade (a meeting caught in the middle is resumed on start), or **Run again** on the meeting. If the same meeting fails each time, read its error (next entry).
**Owner.** `server/core/meetings.js` (`enqueue`, `resume`, `ACTIVE`), `server/modules/meetings.js`; status words in `public/js/views/meetings.js`.

### A meeting says "Could not be read: ..."

**Means.** The transcript was refused, with a reason in plain words. A file is never trimmed to fit.
**Check.** The reason is on the meeting. Common ones: the file is over the size limit (`meetings.maxBytes`), the text is over `meetings.maxChars` ("split it into shorter parts"); the numbers are in the "Upload limits" table in [SECURITY.md](SECURITY.md), a `.vtt` that is not a WEBVTT file, a `.json` that is not a transcript export, a `.pdf` or `.docx` with no readable text, or "PDF reading needs the pdftotext tool, which is not installed".
**Fix.** Split a long transcript, export captions again, or install `pdftotext` (part of Poppler) for PDFs. The same file dropped twice is recognised as a duplicate and not read again.
**Owner.** `read` in `server/core/transcripts.js`, `server/core/extract.js`. Limits: [SECURITY.md](SECURITY.md), "Upload limits".

### Items show "not checked", or the checker keeps sending items back

**Means.** For each item Skeptic answers `supported`, `wrong`, `not-asked`, or `not-checked` when its answer broke the contract (its evidence was not in the transcript, say). Items the checker disputes are sent back once (`meetings.maxRounds`), then shown to you as they are.
**Check.** Open the meeting's review: each item shows its quote, verdict and note. Counts show how many passed, were corrected, or were not checked.
**Fix.** Tick or untick items yourself: the PM decides what to keep. If many are `not-checked`, the checking model may be too weak for the language or length; choose a stronger one under Settings → Meetings and automated agents (blank means one size above the Transcript agent). A persistent problem with one skill is a prompt problem: see `agents/transcript/skills/`.
**Owner.** `server/core/skeptic.js`, `server/core/checker.js`, `server/core/meetings.js`.

### The meeting record was written somewhere unexpected, or not in the project folder

**Means.** Records go in `<project folder>/Jade/Meetings/` (transcripts in `Meetings/transcripts/`). If the project has no folder, or its first folder is missing, read-only or refuses the write (an offline sync folder), Jade keeps the material in the data folder and says so on the project page.
**Check.** The project page shows a one-line notice, "The project folder ... so this project's notes and actions are kept in Jade's data folder for now." The folder name `Jade` is the setting `storage.folderName`.
**Fix.** Make the folder exist and be writable, then record again. Files already kept in the data folder are not moved automatically.
**Owner.** `server/core/locations.js`, `storageNotice` in `server/core/store.js`. Background: `docs/adr/0010-project-material-lives-in-the-project-folder.md`.

## Dashboards

### A dashboard says it could not be built

**Means.** The model's answer was not a valid specification (an unknown layout, a field that does not exist, text too long) twice, or the model call itself failed. Jade then saves nothing.
**Check.** The Dashboard Builder run in the Activity drawer shows `The answer was not accepted: ...` and `The dashboard could not be made: ...` with the first problems. A message "This dashboard was removed while it was being built, so nothing was saved" means you deleted it meanwhile.
**Fix.** Press **Rebuild**. If it repeats, ask for something simpler in the questionnaire, or choose a stronger model for dashboards (`dashboards.model`, otherwise the agents' model). A dashboard cannot show a thing the fixed layouts and data sources do not cover.
**Owner.** `server/core/dashboards.js`, `server/core/dashboardspec.js`. Background: `docs/adr/0008-dashboards-fixed-layouts.md`.

### A dashboard opens but a section is missing, or says "could not be loaded"

**Means.** "Could not be loaded" means the request failed; it does not mean you have none. A section that fails to draw is reported in the page and in the browser console (section title, layout, error). "The file for this dashboard is missing" or "could not be read" means its `.json` in `<project folder>/Jade/Dashboards/` was moved, edited by hand or damaged; it is checked again every time it is read.
**Check.** Open the browser's developer console for the section error; look at the file in `<project folder>/Jade/Dashboards/`.
**Fix.** **Rebuild** it from its saved answers. An "older dashboard" (an HTML page made before this design) is listed but never served with project data: open its file in the preview or rebuild it.
**Owner.** `readSpec` in `server/core/dashboards.js`; drawing in `public/js/dashboard/view.js`.

## Agents and chats

### An agent will not run

**Means.** One place decides whether an agent or skill may run, and it says why in plain words.
**Check.** The message names the reason:
- "... belongs to the <Name> module, which is switched off. Switch it on under Modules first."
- "... comes from a project folder or a plugin and has not been allowed ... to work on its own yet. Allow it on the Agents page first." (A hand-started run of such an agent is allowed, but read-only.)
- "... has not been allowed since it changed": the file or one of its skills is different from when you allowed it (a `git pull`, a plugin refresh). Read it, then allow it again.
- "... is a Claude Code agent Jade cannot run; use it from Claude Code": the file names no handler or loop.
- A skill: "The skill ... has not been allowed. Allow it on the Skills page first."
**Fix.** Do what the message says. An agent from a project or plugin that never appears in Jade's chat is waiting for an allowance.
**Owner.** `server/core/mayrun.js`, `server/core/allowances.js`, `server/core/agentfiles.js`. Background: `docs/adr/0007-allow-rule-for-project-and-plugin-agents.md`, `docs/adr/0011-one-place-decides-may-run.md`.

### An agent or skill I added does not appear

**Means.** Jade lists agent files in `~/.claude/agents`, each project's `.claude/agents`, and plugin agents, and skill folders likewise.
**Check.** A file over 256 KB is ignored; a link in a project or plugin folder is not followed; a file that does not parse (half-saved) is skipped until it does; `*.new.md` files are copies kept beside yours and are not agents. An agent with the same id as a built-in one and no handler is a note added to the built-in one, not a new agent. An agent in a project folder is shown only if that folder belongs to a Jade project.
**Fix.** Fix the file, check its front matter, and reload the Agents page.
**Owner.** `server/core/agentfiles.js`, `server/core/skills.js`.

### A chat stops with no answer

**Means.** The reply ended early. The chat leaves a note saying why.
**Check.** The note is one of: "Jade restarted before this reply finished" (the launcher restarted the server); "You stopped this reply"; "This reply looked stuck: No sign of progress for 15 minutes, so I stopped it" (what it had done is kept, and so are any files it changed); "This reply stopped: <reason>" (the engine's own error, with keys hidden). Open the run in the Activity drawer for the full output.
**Fix.** Send the message again. For a connection error, see "The Bedrock or gateway test fails". A first reply is slower than later ones because a Claude Code process is started (about two seconds, longer when a connector loads).
**Owner.** `server/core/chatreply.js`, `server/core/warm.js`, `server/core/jobs.js`.

### Jade asked me to approve something, or a change was refused

**Means.** In the default permission mode Jade asks before something that cannot be undone, and always asks before changing Jade's own control files. `Jade could not be reached to approve this: ...` means the approval tool could not reach the server (Jade was restarting, or the key file was unreadable), so the change was denied.
**Check.** Settings → Permissions shows the mode and the recent changes. Each question explains in plain words what will happen and whether it can be undone.
**Fix.** Answer the question; choose another mode if the questions are too many (`read`, `ask`, `irreversible`, `auto`). Restore a change from the change list. A question about a command that names the `.state` folder is on purpose.
**Owner.** `server/core/permissions.js`, `server/core/explain.js`, `server/mcp/approve.mjs`. Background: `docs/SECURITY.md`.

### A module's page or route says "is switched off"

**Means.** The module (Routines, Voice, Dreams, ...) is off. What a switched-off module does is in [EXTENDING.md](EXTENDING.md) ("Switching a module off").
**Fix.** Turn it on under Modules.
**Owner.** `server/core/router.js`, `server/core/modules.js`.

### Routines or a nightly Dreams run did not run

**Means.** Routines is off by default, and schedules run only when it is on. If the computer was asleep, the run happens when Jade next sees it, up to 12 hours late.
**Check.** The Routines page lists each routine's schedule and last run. A schedule is text such as `daily 02:30`.
**Fix.** Turn Routines on under Modules; check the schedule on the Routines page or in Settings → Schedule.
**Owner.** `server/core/scheduler.js`.

## Dreams

### Dreams found nothing

**Means.** An empty night is a valid answer ("Nothing worth bringing that night"), but several settings make it likelier.
**Check.**
- The module is on (Modules) and, for the nightly run, Routines is on too. **Dream now** works without Routines.
- `dreams.claude` is `projects` by default: only Claude Code conversations in the folders of your Jade projects count. Set `all` in Settings → Dreams to read every folder, or `off` to read only Jade's own work.
- Only the last `dreams.days` (7) days count, and text is capped by `dreams.maxCharsPerSession` and `dreams.maxChars`; the text says when it was cut.
- The two sources are labelled in the run: `(no sessions in that time)` means no matching Claude Code conversation was found.
**Fix.** Adjust the setting, do some work, press **Dream now**. Ideas that repeat earlier ones are dropped on purpose.
**Owner.** `server/core/dreams.js`, `server/core/claudesessions.js`. Background: `docs/adr/0009-dreams-reads-conversations-off-by-default.md`.

## Files, search and data

### Search finds nothing, or files cannot be previewed

**Means.** Jade searches the folders it is told about: project folders, folders added under Settings → Files, and the data folder's notes. A preview is refused for anything outside those ("That file is not in a folder Jade can reach") and for Jade's own secrets.
**Check.** Is the folder a project folder or added under Settings → Files? Is the file type readable (`.md .txt .org .docx .pptx .xlsx .pdf`, and `.pdf` needs `pdftotext`)? The index rebuilds every `memory.reindexMinutes` (15) minutes and when files change.
**Fix.** Add the folder under Settings → Files and wait for the next reindex (or restart Jade, which rebuilds it).
**Owner.** `server/core/memory.js`, `server/core/files.js`, `server/core/search.js`.

### Actions or notes are missing, or "The action list ... could not be read"

**Means.** A project's `actions.json` that does not parse (edited by hand or cut short) is never read as empty and never written over. New actions go to the data folder until it is fixed.
**Check.** The project page names the file and a saved copy of it.
**Fix.** Open the file, fix the JSON (or restore the copy), and Jade picks it up.
**Owner.** `server/core/store.js` (`inspectActions`, `storageNotice`).

### A big file is refused ("over the limit")

**Means.** Uploads and request bodies have limits, listed in one place: the "Upload limits" table in [SECURITY.md](SECURITY.md). A refused request says which limit it went over.
**Fix.** Use a smaller file; for a transcript, see the Meetings entries above.
**Owner.** `server/index.js`, `server/core/store.js`, `server/core/transcripts.js`.

## Other

### The bridge says it is switched off

**Means.** The Claude bridge is off until `bridge.enabled` is on (Settings → Privacy). Jade must also be running; with Jade stopped, the bridge can only read.
**Fix.** Switch it on in Settings, then register it once as `bridge/README.md` says.
**Owner.** `server/core/bridge.js`, `bridge/`.

### Voice or the wake word does not work

**Means.** Voice is off until its module is on, and the offline speech model downloads from the internet the first time you ask (many company networks block it). The browser needs microphone permission.
**Fix.** Turn on the Voice module, allow the microphone, and retry the model download from a network that permits it.
**Owner.** `server/core/voicemodel.js`, `public/js/voice.js`.

### Jade feels slow

**Means.** Most waiting is Claude, not Jade. Things Jade does itself: a new chat starts a Claude Code process (a few seconds); connectors such as Gmail or Calendar load only when your message matches their keywords; only two agents run at once (`concurrency`); the memory index is built in the background after every start (a big folder takes a minute or more; pages say "still reading your files" meanwhile) and checked again every `memory.reindexMinutes`; the file list is read again when a folder changes, in short slices that let other requests through (where the computer cannot watch a folder, each folder's modified time is checked every minute); the model list is refreshed in the background.
**Check.** The Activity drawer shows what is running and how long. A very large project folder (tens of thousands of files) makes the first file list and the first search after a start slower; later ones are quick. Search looks through the newest 300 chats only. The numbers Jade is held to are in `docs/PERFORMANCE.md`. Repeated "Interrupted by restart" in runs means Jade is being restarted: check you are not editing files in `server/`.
**Fix.** Lower `concurrency` only if the computer is struggling; raise the reindex minutes; keep very large folders out of the memory folders; use the quick or everyday model for background agents.
**Owner.** `server/core/warm.js`, `server/core/jobs.js`, `server/core/memory.js`, `server/core/files.js`.

### A test or gate fails after I changed something

**Means.** The tests and gates guard behaviour (`docs/TESTING.md`). A failing provider-parity test means what Jade hands Claude Code changed.
**Check.** Run `npm test` and read the name of the failing test; for the parity test, read `test/fixtures/README.md` ("How to read a failure").
**Fix.** Change the code back, or fix the test if its premise is wrong. Do not re-record the parity fixtures to make a failure go away unless you can explain every line of the diff.
**Owner.** `docs/TESTING.md`.

## What to give an AI assistant when asking for help

Give the assistant the smallest set that shows the problem, with secrets already out. Safe to paste:

1. **What you did and what you saw**, with the exact message on the screen (word for word).
2. **The Diagnose report** (Settings → Engine → Diagnose → Copy). Keys are hidden in it and it names only the environment variables Claude Code gets, not their values.
3. **The run's output** from the Activity drawer or the Agents page (Runs). Keys are replaced with `[hidden]` there.
4. **The terminal lines** printed around the time it went wrong (the server log), without the `Open Jade:` line, which carries the key.
5. **Versions**: `node --version`, `claude --version`, and which connection you use (plan, gateway, Bedrock, Bedrock through a gateway).
6. **The failing test or gate** and its message, if you are changing code: `npm test`, or the one gate that failed.
7. **`<data folder>/config.json`** if a setting is involved. It holds settings, not keys, but it may name your folders; remove what you would not share.

Do **not** paste:

- the start link, or anything after `?key=`;
- `<data folder>/.state/token` (the Jade key);
- `<data folder>/engine.env` (the connection key);
- a transcript or a meeting file, a project's files, or your chats, unless you are sure the assistant may see them.

Tell the assistant to read `AGENTS.md` first, then this file and `docs/ARCHITECTURE.md`. If it needs to see a file in your data folder, show it only the parts that matter.
