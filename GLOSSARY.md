# Jade Base glossary

The words Jade Base uses on its pages and in its code, with one meaning each. Where the code or the pages use two words for one thing, or one word for two things, the preferred word is named and the others are listed under _Avoid_ or _Also written_, with the files where they appear. Nothing here asks for a rename: the aliases are listed so that a reader (or an AI assistant) is not misled by them. For where each thing lives in the code, see `docs/ARCHITECTURE.md`.

## Language

### People and places

**Project manager (PM)**:
The person using Jade. The setting `role` holds what Jade calls them (default "project manager").
_Avoid_: user, owner (code comments use "user", "person" and "PM" for the same human; the pages say "you")

**Project**:
One piece of work the PM tracks: a name, a description, an optional list of folders, and the notes, actions, meetings and dashboards that belong to it. Kept as `projects/<id>.json` in the data folder.
_Avoid_: workspace, client

**Project folder**:
A folder on the PM's computer that a project points at (`folders` in the project file). The first one is the **chosen folder**: Jade keeps the project's own records inside it. The others are only read (search, file lists). Answered by `server/core/locations.js` (`foldersOf`, `firstFolder`).
_Avoid_: project directory, root, workspace folder

**Jade folder**:
The sub-folder named `Jade` inside a project's chosen folder, where Jade keeps that project's notes, actions, meetings and dashboards. Its name is the setting `storage.folderName`. If the project has no usable folder, the same material is kept in the data folder instead.
_Also written_: "Jade sub-folder" (README), `jadeDir` and "storage folder" (code, `server/core/locations.js`, `server/core/config.js`). Not the same as the **data folder**.

**Data folder**:
Jade's own folder, `~/JadeBase` unless `JADE_HOME` says otherwise. It holds the settings, notes, projects without a folder, chats, the soul file and the private `.state` folder.
_Also written_: `JADE_HOME` (code, `server/core/config.js`), "Jade home", "JadeBase" (README, Settings), "Jade data" (folder picker shortcut in `server/api.js`)
_Avoid_: "home folder" (that is the person's own home folder, `~`)

**App window**:
Jade opened in a browser's own window with no address bar, tabs or bookmarks (Chromium's `--app` mode), instead of a tab. The setting `window` (`app` or `tab`) chooses; see `docs/adr/0019-app-window.md`.

**State folder**:
`.state` inside the data folder. Holds the key, run records, caches and per-run files; private to the PM's account. Constant `STATE` in `server/core/config.js`. Not for hand editing, except as `docs/TROUBLESHOOTING.md` says.

**Claude home**:
Claude Code's own folder (`~/.claude`, or the folder in `JADE_CLAUDE_HOME`). Jade reads agents and skills from it and, when the PM agrees, installs its built-in ones there. `claudeHome()` in `server/core/config.js`.
_Avoid_: "Claude folder", "claude config" (the setting `CLAUDE_CONFIG_DIR` is something else: the private engine folder, see **Engine**)

### Running work

**Claude Code**:
The command line program (`claude`) Jade drives to do all model work. Jade has no other way to reach a model.
_Avoid_: the API, the SDK, "Claude" alone when the program is meant

**Connection**:
How Claude Code reaches Claude: the PM's Claude plan, a company **gateway**, Amazon Bedrock, or Bedrock through a gateway. Chosen under Settings → Engine, kept in `engine.env`. The code calls this the "provider" (`server/core/provider.js`: `mode()` gives `subscription`, `gateway`, `bedrock` or `bedrock-gateway`; `style()` gives `plan` or `gateway`).
_Avoid_: provider (in pages), backend, account

**Gateway**:
A company server that sits between Claude Code and Claude and is reached by an address and a key. Bedrock behind a gateway is still a gateway for the "style" check.
_Avoid_: proxy (a proxy is a network setting passed through as an environment variable, not a gateway)

**Engine**:
The Claude Code process Jade starts for a piece of work, with the connection applied to its environment. Code: `server/core/engines.js` (`run`, `claudeArgs`), `job.engine` (always `claude` today). The page text says "how Claude Code reaches Claude" instead.
_Avoid_: using "engine" for the connection itself; Settings → Engine is the one place the pages use the word, for the connection settings.

**Job**:
One queued or running piece of work in Jade's queue: an agent run, a chat reply, a Skeptic check. Has an id, a status (`queued`, `running`, `done`, `error`, `cancelled`) and live output. Code: `server/core/jobs.js`.
_Also written_: **run** (pages and README: "Runs", "Run now"; code comments: "every run is a job"). Prefer "run" on pages and "job" in code; they mean the same thing.

**Run**:
What a person calls a job. See **Job**. Also the verb ("run an agent").

**Chat**:
A conversation with Jade: a list of turns, with its own model and effort choice. Saved one file per conversation in `chats/` under the state folder. Code and routes call it a **thread** (`store.newThread`, `/api/chats`); the pages say "chat".
_Avoid_: conversation, session. "Session" is Claude Code's own word for its conversation files (`server/core/claudesessions.js`), not a Jade chat.

**Thread**:
Code word for a **chat** (`thread` in `server/core/store.js`, `server/core/chatreply.js`, the `thread` field of a chat job). Use "chat" in anything a PM reads.

**Turn**:
One message in a chat, from the PM (`user`) or from Jade.

**Chat reply**:
Jade's answer to one message: its prompt, its warm process, what is saved when it ends or fails, and tidy-up afterwards. Owned by `server/core/chatreply.js`.

**Warm worker**:
A Claude Code process kept running for one chat, so a follow-up answers faster. Code: `server/core/warm.js`.
_Avoid_: confusing it with the **Worker** agent or with `checker.worker()` (see **Worker**).

**Effort**:
How hard the model thinks: `low`, `medium`, `high`, `xhigh`, `max`, or blank for the model's own default. Three settings: `chat.effort`, `agents.effort` (automated work) and `agents.checkerEffort` (the checking agent). An agent file may set its own with `jade-effort`. `server/core/effort.js`.

**Tier** (also **size**):
How big a model is: Quick, Everyday or Strong, read from the family in its name. Jade offers only models it discovered; it never writes a name. The pages say "size" and "one size up"; code says `tier` (`models.tierOf`). Pins in the connection file use `light` for quick and `standard` for everyday (`server/core/models.js`, `suggest`).
_Also written_: light = quick, standard = everyday.

**Checker**:
The model the checking agent runs on. Blank in Settings means one size above the model the Transcript agent uses. The rule lives in `server/core/checker.js`. "Checker" is also used for the **checking agent** itself (see **Skeptic**).

**Skeptic**:
The checking agent: it checks other work against what was really said or asked, and gives a **verdict** per item. Its agent file is `agents/skeptic.md`; its code is `server/core/skeptic.js`.
_Also written_: "the checking agent" (pages, README), "checker" (`server/core/checker.js`, Settings), "verifier" (the `jade-kind: verifier` key in `agents/skeptic.md`; `server/core/agents.js`). Prefer "Skeptic" for the agent and "checker" for its model.

**Verdict**:
Skeptic's answer for one item. Two vocabularies exist because there are two checking modes:
- checking against written criteria (chat replies, builds): `pass`, `fix_output`, `blocked` (`server/core/skeptic.js`, `verify`);
- checking against another agent's instructions (meeting items): `supported`, `wrong`, `not-asked`, `not-checked`, and `added-by-pm` for an item the PM added by hand (`server/core/skeptic.js` `checkAgainst`, `server/core/meetings.js`).
Anything that fails the contract is `blocked` or `not-checked`, never a pass.

### Agents and skills

**Agent**:
A Claude Code agent file (a Markdown file with front matter and a prompt) that Jade can list and run. Extra keys that start with `jade-` are read only by Jade. `server/core/agentfiles.js`.
_Avoid_: bot, assistant (Jade itself is "the assistant" on pages, and its agent id is `jade`)

**Built-in agent**:
An agent that ships with Jade, in `agents/`. Trusted. Runs from the app until the PM installs it into Claude home.
_Also written_: origin `built-in` (code), group "built-in".

**Own agent**:
An agent the PM wrote or Claude made for them, in Claude home (`~/.claude/agents`). Trusted. Code calls its origin `yours`; pages say "yours". A file with the same id as a built-in agent and no handler is a note added to that agent, not a replacement.
_Also written_: "your agent", `yours`, `custom` (`custom: origin === 'yours'` in `server/core/agentfiles.js`), "user's own".

**Project agent**:
An agent file in a project's own `.claude/agents` folder. Always listed, but not trusted: see **Allowance**. Origin `project:<id>`.

**Plugin agent**:
An agent that a Claude Code plugin brings. Not trusted, same as a project agent. Origin `plugin:<name>`.

**Trusted**:
An agent or skill from the built-in set or the PM's own Claude home. Its `jade-` keys are honoured without asking. Everything else is untrusted until allowed. `isTrusted` in `server/core/agentfiles.js`.

**Allowance**:
The PM's one-click yes ("Allow this agent to work on its own") for one project or plugin agent or skill. Tied to the file's real path and a hash of its text (and of the skills it names); if either changes, the allowance stops counting ("changed since you allowed it"). Stored in `agents-allowed.json` under the state folder; code in `server/core/allowances.js`. Whether a thing may run is decided only in `server/core/mayrun.js`.
_Avoid_: permission (that word belongs to the **permission mode**, a different thing), approval

**Permission mode**:
What Jade does before a run changes a file: `read`, `ask`, `irreversible` (default) or `auto`. Setting `permissions.mode`. `server/core/permissions.js`.
_Avoid_: using "permission" for an allowance.

**Skill**:
A `SKILL.md` folder (the Claude Code format) that an agent or chat loads by name. Sources: yours, built-in, Claude Code's, projects', plugins'. A skill from a project or plugin needs an allowance. `server/core/skills.js`.

**Handler**:
The `jade-handler` key of an agent file: which piece of Jade code runs the agent (`chat`, `markdown`, `skill`, `actions`, `dreams`). With `jade-loop` it names a loop instead. An agent with neither cannot be run by Jade. `server/core/agents.js`.

**Routine**:
An agent or skill automation that runs on a schedule or a button, shown on the Routines page. Not a separate kind of thing: it is an agent plus a schedule.
_Avoid_: task, cron job. (`scheduler.tasks()` in `server/core/scheduler.js` returns "tasks"; these are the same things.)

**Worker**:
Three unrelated things share this word. (1) The **Worker** agent (`agents/worker.md`, kind `builder`): Jade's builder that a chat hands build tasks to. (2) A **warm worker**: a kept-alive chat process (`server/core/warm.js`). (3) `checker.worker(id)` in `server/core/checker.js`: the model for a working agent such as Transcript. Use the full phrase each time.

**Soul**:
`soul.md` in the data folder: a plain text file for how Jade speaks and what it always does. Made on first run from `agents/jade/soul.md`; the PM's to edit.

### Meetings

**Meeting**:
One transcript and everything made from it: status, items, checks, record. Kept in `<data folder>/.state/meetings/<id>.json`. Status goes `queued`, `reading`, `extracting`, `checking`, `repairing`, then `review`, then `recorded`; or `paused` (usage limit) or `failed`. `server/core/meetings.js`. The page shows `queued` and `reading` both as "Reading…".

**Transcript**:
The text of what was said in a meeting, in a `.vtt`, `.srt`, `.txt`, `.md`, `.docx`, `.pdf` or `.json` file. Saved untouched in the Jade folder. `server/core/transcripts.js`.
_Also written_: the **Transcript agent** (`agents/transcript.md`), which reads a transcript. Say "transcript file" or "Transcript agent" when both are near.

**Item**:
One thing pulled out of a transcript: a key point, an action item, or a risk or issue, each with the exact quote that supports it. Code: `items` inside each skill's result in the meeting file.
_Avoid_: finding, result. Do not use "item" for an **action** alone: "action item" is one kind of item.

**Action**:
A task with an owner and a due date, kept in the project's `actions.json` (or the data folder's). Pages say "Action items". An action can come from a note, a chat, an agent or an accepted meeting item.
_Also written_: "action item" (pages), "task" (code comments, avoid).

**Record**:
The Markdown file written when the PM presses Record on a meeting: `<Jade folder>/Meetings/<date> <title>.md`, holding the items the PM kept. `writeRecord` in `server/core/meetings.js`. The word also appears for bookkeeping files (the "allowance and install records", `agents-installed.json`): those are not meeting records.
_Avoid_: minutes, summary

**Review**:
The step where the PM ticks which items to keep before recording. Status `review`; setting `meetings.accept` (`review` or `auto`). Not the same as `server/core/review.js`, which is Skeptic checking a chat reply.

### Dashboards

**Dashboard**:
A saved list of sections for a project, drawn by Jade's own code from fresh data every time it is opened. Not a page: no model writes HTML. Saved as `<Jade folder>/Dashboards/<name>.json`. `server/core/dashboards.js`.
_Avoid_: report, page. An **older dashboard** is an HTML page made before this design; it is listed but no longer served with project data.

**Spec** (specification):
The JSON a model returns for a dashboard: a title, an introduction and sections. Checked strictly by `server/core/dashboardspec.js` (`validateSpec`) before it is saved and again each time it is read.
_Avoid_: schema (the schema is the shape a spec must fit, `jsonSchema` in the same file)

**Layout**:
One of the fixed section shapes a dashboard may use: headline numbers, table, grouped list, bar chart, timeline, next two weeks, text, recent meetings. `LAYOUTS` in `server/core/dashboardspec.js`; one renderer per layout in `public/js/dashboard/layouts/`.

**Source**:
One of the project's data sets a dashboard section reads: actions, notes, meetings, files, the Claude Code set-up. `SOURCES` in `server/core/dashboardspec.js`.
_Avoid_: using "source" for where an action came from (the action's `source` field) or for a skill source (a folder skills come from). Context makes it clear, but write "data source" when mixing.

**Questionnaire**:
The short set of questions a PM answers to ask for a dashboard. Questions come from `server/modules/dashboards/questions.json` (or the PM's copy). The answers are saved on the project.

### Dreams and memory

**Dreams**:
The nightly look at the week's work that brings back ideas. Off by default. `server/core/dreams.js`.

**Idea**:
One thing Dreams brings back, of a **kind**: an agent worth building, a skill worth having, worth writing down, worth remembering, and (only when looking outward is on) from outside and tools to try. Kinds are listed in `agents/dreams/kinds.json`. Accepting one shows the exact text first.

**Digest**:
The text Dreams hands the model: Jade's own week plus, if allowed, a trimmed copy of the PM's Claude Code conversations, fenced as quoted material. Built in `server/core/dreams.js` and `server/core/claudesessions.js`.

**Memory**:
Two things under one page. (1) The search index over the folders Jade reads (`server/core/memory.js`). (2) Long-term facts Jade was asked to remember (`memory/facts.md`). The page says "Memory" for both. The index is built in the background after every start, so for a short while the page says "Jade is still reading your files".

### Connecting things

**Module**:
One of Jade's switchable features: a manifest file in `server/modules/` (or the PM's `<data folder>/modules/`) that gives it a page, routes, settings and background work. Switched off, every route and agent of the module refuses. `server/core/modules.js`.
_Avoid_: plugin (that is a Claude Code plugin), extension, add-on. Also not an ES module, which this repository writes as "JavaScript module" or "file".

**Page**:
What the PM sees in the window: Home, Chats, Projects and so on. In the code a page is a **view** (a file in `public/js/views/`).
_Avoid_: screen

**View**:
Code word for a page: a file that exports `render`. A **project panel** is a view drawn as a card on the project page.

**Route**:
Two meanings, one word. A page route is the `#/name` address in the browser (`public/js/app.js`). A server route is a method and path such as `GET /api/projects` (`server/core/router.js`). Write "page route" or "server route" when it matters.

**Connector**:
An app Claude Code is connected to (Gmail, Calendar, Drive, the web). A chat gets a connector only when its message matches the connector's keywords. `server/core/engines.js`.
_Avoid_: integration, tool. (A "tool" in Jade's code is a Claude Code tool such as Read or Edit.)

**Bridge**:
The small program (`bridge/`) that lets a Claude Code session read Jade's actions and add notes. Off until `bridge.enabled` is set. `bridge/README.md`.

**Handoff**:
A task written to a file for a Claude Code session to pick up, through the bridge (`handoff` in `server/core/bridge.js`).

### Security words

**Key**:
Two different secrets share this word, and the pages sometimes use both. Prefer the full name.
- **Jade key**: the random secret in `<data folder>/.state/token` that every request to Jade must carry. It reaches the browser through the **start link**. Code and settings call it `token` (`JADE_TOKEN`, the `x-jade` header, `server/core/auth.js`).
- **Connection key**: the key or token for a gateway or Bedrock, kept in `engine.env` (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`).
_Avoid_: "API key" for the Jade key; "token" on a page.

**Start link**:
The address `http://127.0.0.1:<port>/?key=…` printed once when Jade starts. Opening it gives the browser the Jade key and moves on to the plain address. Launchers open it through a small private file so the key is never on a command line.

**Hidden**:
The replacement `[hidden]` that `server/core/redact.js` puts where a key or secret would show in a stored or displayed text.

**Owned file**:
A file or folder that decides what Jade may do (the allowance and install records, `config.json`, `engine.env`, the key, the agents and skills folders). A run always asks before changing one. `isJadeOwned` in `server/core/permissions.js`.

### Technical words used in the documents

Plain meanings for the words a person reading the documents may not know. Nothing here is a Jade concept of its own.

**Front matter**:
The block of `key: value` lines between two lines of `---` at the top of a Markdown file. An agent file and a skill file start with one. Claude Code reads some keys; Jade reads the ones that start with `jade-` (the **`jade-` keys**, such as `jade-handler` and `jade-schedule`, see **Handler**).

**Loop**:
A fixed piece of Jade code that an agent can name with `jade-loop` instead of `jade-handler`, for work that has several steps of its own: `meeting` (reading a transcript), `dashboard` (building a dashboard) and `skeptic-check` (checking work). Use a **handler** for an agent that is one run of Claude Code; use a loop when Jade's code drives several steps itself. Registered with `jobs.register` in code.

**Context builder**:
A small function that makes one section of the background text an agent is given (for example the project list or the facts Jade remembers). An agent asks for sections by name with `jade-context`; code adds a new one with `agents.addContext`.

**Slice**:
A short piece (about 10 to 15 milliseconds) of a long job. Long work is cut into slices with a pause between them, so other requests are answered in between and Jade never feels stuck. "Sliced" means done this way. `docs/PERFORMANCE.md`.

**Raw route**:
A server route that writes its own answer instead of returning data for Jade to send (used for uploads and for sending a file). It runs before the request body is read. `{ raw: true }` in code.

**Event stream** (server-sent events):
A web page connection that stays open so the server can push news to the page (a run's text as it arrives, a list that changed). The page keeps one open at `/api/events`.

**Process id (pid)**:
The number the computer gives a running program. Jade keeps its launcher's in a file (`.state/jade.pid`) to tell whether a Jade is already running.

**Cookie**:
A small value a browser stores for a site and sends back with each request. Jade's start link sets one that holds the Jade key.

**DNS rebinding**:
A trick where a web page on the internet makes your browser talk to a program on your own computer under another name. Jade refuses any request whose `Host` is not the local address.

**Hash**:
A short fingerprint of a file's text. If a single character changes, the fingerprint changes. An allowance holds the hash of the agent or skill it was given for, so a changed file has to be allowed again.

**Link** (symbolic link, junction):
A file or folder that points at another place. Jade follows a link to its real place (`realpath`) before deciding whether a path is allowed, so a link cannot lead out of a folder that is allowed.

**Regular expression**:
A compact text pattern that matches words of a certain shape. A setting that takes one (for example `connectors.keywords`) holds it as plain text.

**Approval tool** (MCP):
How a run asks Jade for permission. Claude Code can be given extra tools through a standard called MCP (Model Context Protocol). Jade gives each run one, `server/mcp/approve.mjs`, which Claude Code calls before it changes a file; Jade answers allow or refuse. The **bridge** uses the same standard the other way round.

**Pin** (model pin):
A model name fixed for one size in `engine.env` (`ANTHROPIC_DEFAULT_HAIKU_MODEL` and its two siblings), so that a size such as "everyday" means a specific model on a gateway. Read by `pins()` in `server/core/provider.js`.

**Routing variable**:
An environment variable that decides where Claude Code sends its requests (the address, the key, Bedrock switches, the region). Jade removes every one it knows from the environment it was started from and sets only its own from `engine.env`. The list is `ROUTING_VARS` in `server/core/provider.js`.

**Inference profile**:
An Amazon Bedrock name for a model reachable in a region or group of regions. A Bedrock model name in `engine.env` may be one. Jade passes it on as it is.

### Development words

**Gate**:
A script under `scripts/gates/` that checks the whole repository or a started server and fails with a clear message (imports, boot smoke, pages, sample module, hygiene, docs). Run all with `npm run gates`.
_Avoid_: calling a test a gate: a test is a file in `test/` run by `npm test`.

**Parity test**:
`test/provider-parity.test.js`: it records what Jade hands Claude Code (command line, environment, settings files, system prompt) and compares with the frozen record in `test/fixtures/`. See `docs/adr/0004-bedrock-gateway-locked-by-parity-test.md`.

**Stand-in**:
A small fake `claude` program that tests and gates put first on `PATH`, so a real one is never started. `scripts/gates/lib.mjs` (`writeStandIn`), `test/helpers/fake-claude.js`.
_Avoid_: mock (a stand-in is a real executable file, not an object).

**Seam**:
A place where one piece of behaviour can be swapped without editing the code around it, such as a stand-in for the Claude process or `judge.use()`. Used in the sense of `docs/ARCHITECTURE.md`.
