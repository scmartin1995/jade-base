This file says how to add things. For how Jade works inside see [ARCHITECTURE.md](ARCHITECTURE.md); for the files, test and document of each common change see [where-to-change.md](architecture/where-to-change.md).

# Adding a module

A module is one file. Put it in `server/modules/<id>.js` (ships with Jade) or `<JADE_HOME>/modules/<id>.js` (yours; the same `id` replaces a built-in one). Manifests are read once at boot, and the launcher restarts the server when one changes.

```js
export default {
  id, name,                      // required: id is letters/digits/-/_ (a manifest without both is skipped, with a line in the log)
  icon, order, desc,             // optional: icon is a name from public/js/ui.js (default 'cpu'); order sorts the dock (default 500); desc is one line (default '')
  core,                          // true: cannot be switched off
  defaultOff,                    // true: off until the user turns it on (an explicit value in config.json still wins)
  nav,                           // [{ route, label }]: puts the module in the dock; a separator falls between each hundred of `order`
  views,                         // { route: 'file.js' }: the page for a route (default <route>.js)
  defaults,                      // config defaults, merged under what the user has set
  projectPanels,                 // [{ id, title, view: 'file.js', order }]: cards on every project page (below)
  settings, setup,               // carried to the browser for settings and first-run screens
  init(api),                     // api = { on, jobs, agents, store, config, bus, services }; what it returns becomes services[id]
};
```

A user module's views live in `<JADE_HOME>/modules/<id>/views/` and are served from `/modules/<id>/views/*` (`.js .css .json .svg` only). Built-in views stay in `public/js/views`. A view file is served only if where it really is (after following links) lies inside that folder and is not one of Jade's secrets.

**Switching a module off** (this is the one place that says what it does; other documents link here). Every route a module registers with `on(...)`, raw ones included, and its view files answer `403` with `<Name> is switched off. Turn it on under Modules first.` while the module is off, so a module writes no check of its own and cannot forget one (the guard is `router.scope(owner, check)` in `server/core/router.js`, used by `modules.init`). A core module has no switch and no guard. A route that has to live outside the module's own file (the Routines and Voice routes in `server/api.js`) wraps its handler in `modules.only('<id>', fn)`, which gives the same answer. Work that is not a route is guarded by its agent file: `jade-module: <id>`.

**Imports in a manifest.** Core files import the agents loader, which is still loading the manifests while a manifest file is read, so a manifest that needs a core file (`dreams`, `meetings`, `dashboards` do) imports it inside `init` with `await import('../core/x.js')`, not at the top. A manifest that needs none, or only files that do not reach the agents loader, may import at the top (the built-in `agents`, `skills` and `setup` do).
`on(method, pattern, fn, opts)` registers a route: `fn({ p, q, body, req, res })` returns JSON. With `{ raw: true }` the route is matched before the body is read and gets `{ p, q, req, res }` to answer itself (uploads, served pages); a raw route that streams a file must give the stream an `'error'` listener (`stream.on('error', () => res.destroy())`), or a file that cannot be read ends the server. Also: `jobs.register(kind, fn)`, `agents.addHandler(name, fn)`, `agents.addContext(name, fn)`.

```js
// <JADE_HOME>/modules/stopwatch.js
export default {
  id: 'stopwatch', name: 'Stopwatch', icon: 'clock', order: 300, desc: 'Times how long a task takes.',
  nav: [{ route: 'stopwatch', label: 'Stopwatch' }],
  views: { stopwatch: 'stopwatch.js' },        // <JADE_HOME>/modules/stopwatch/views/stopwatch.js
  defaults: { stopwatch: { started: 0 } },
  init({ on, config, bus }) {
    on('GET', '/api/stopwatch', () => ({ started: config.get().stopwatch.started }));
    on('POST', '/api/stopwatch/start', () => {
      config.save({ stopwatch: { started: Date.now() } });
      bus.emit('event', { type: 'stopwatch', payload: {}, at: Date.now() });
      return { ok: true };
    });
    return { elapsed: () => Date.now() - config.get().stopwatch.started };
  },
};
```

```js
// <JADE_HOME>/modules/stopwatch/views/stopwatch.js
export default {
  title: 'Stopwatch',
  async render(root, { api }) { root.textContent = JSON.stringify(await api('GET', '/api/stopwatch')); },
};
```

Check it with `node scripts/gates/sample-module.mjs`.

### Project panels

A module can add cards to the project page. List them under `projectPanels`; each enabled module's panels are drawn after the page's own cards, sorted by `order` (then by the module's `order`).

```js
projectPanels: [{ id: 'time', title: 'Time spent', view: 'time-panel.js', order: 10 }],
```

`view` is a file name only (letters, digits, `.`, `-`, ending in `.js`). A built-in module's file is in `public/js/views/`; a user module's is in `<JADE_HOME>/modules/<id>/views/`. The file's default export has a `render` function that is given the card's body, the page context (the same `{ api, ui, state, go, ... }` a view gets) and the project:

```js
export default {
  async render(root, { api }, project) { root.textContent = project.name; },
};
```

A panel that fails to load shows a short message in its card and the others still appear. Check it with `node scripts/gates/sample-module.mjs`.

# Adding an agent

An agent is a Claude Code agent file: `<claude home>/agents/<name>.md` (`~/.claude/agents`, or the folder in `JADE_CLAUDE_HOME`), a project's `.claude/agents/`, or `agents/<id>.md` in the app for a built-in. It appears on the Agents page by itself.

```md
---
name: my-agent
description: What it is for, in one line.
tools: Read, Grep
skills: [my-skill]
---
The prompt, in plain text.
```

Claude Code reads those four keys. To let Jade run it, add `jade-handler: markdown` (or `jade-loop`) to the front matter; without one it is shown and readable but has no Run button. Other Jade keys: `jade-id`, `jade-name`, `jade-module` (the module that must be on for it to run), `jade-icon`, `jade-kind` (`verifier` or `builder`), `jade-input` (`none`, `project`, `message`...), `jade-context` (which sections of context it is given), `jade-connectors` (which official connectors it may use), `jade-schedule` (`every 1h`, `weekdays 09:00`; runs only when the Routines module is on), `jade-edits` (may create and edit files), `jade-checked` (Skeptic checks its work), `jade-loop` (a built-in loop such as `meeting`), `jade-hidden`, `jade-web` (a setting that must be on for the agent to use web search), `jade-effort` (how hard the model thinks for this agent: `low`, `medium`, `high`, `xhigh` or `max`; it beats `agents.effort` in Settings, and blank or any other word sends nothing so the model's own default applies).

Agents from a project's `.claude/agents` or a plugin are always listed, and the PM can run one by hand from the Agents page at any time. Until the PM presses **Allow this agent to work on its own** for that file, its `jade-` keys are not honoured: a hand-started run is read-only (no edits, no Bash), it has no schedule, context, connectors or skills of its own, and a Claude session cannot start it through the bridge. The page shows where the file comes from and what it asks for. The allowance is kept in `<JADE_HOME>/.state/agents-allowed.json`, keyed by the file's real path, with a hash of the file's text and of the skills it names; if either changes later, the agent is treated as not allowed again ("changed since you allowed it") until the PM allows it afresh. It is removed with **Take the allowance back**. Such a file must be a plain file inside its folder (links are ignored) of at most 256 KB, and an agent that still needs an allowance is left out of the agents Jade's chat knows about. `jade-read: none` (honoured for files of yours or allowed) gives a run no file-reading tools at all; `jade-module` means the agent cannot be started while that module is off, from any route. Files of yours (`~/.claude/agents`) and built-ins are trusted and need none. Never write a model name; the model comes from Settings. Built-ins are copied to Claude Code from the Agents page (Install) and never overwrite a file you changed.

# Adding a built-in agent that runs on a schedule

This is one job, in one place. The pieces are separate in the code, which is why people miss one.

1. **The file.** `agents/<id>.md`. A complete example (the shape of `agents/dreams.md`, with a generic handler):

```md
---
name: jade-weekly-digest
description: "One line: what it does for the project manager."
jade-id: weekly-digest
jade-name: Weekly digest
jade-handler: markdown
jade-input: none
jade-icon: calendar
jade-schedule: fridays 16:00
---
The prompt, in plain text. Never a model name.
```

   `jade-handler: markdown` makes it runnable and does nothing extra when it ends; a handler of your own (`agents.addHandler(name, fn)` in a module) goes there instead. Add `jade-module: <module id>` only if the agent belongs to a module that can be switched off. `jade-input: project` runs it once for each project. The schedule words are read by `parse` in `server/core/scheduler.js` (`every 2h`, `daily 02:30`, `weekdays 09:00`, `mon,wed 08:30`).
2. **Routines must be on.** The scheduler looks at agents only while the Routines module is on, and Routines is off until the person turns it on. A scheduled agent therefore never runs on a fresh install until they do. The person can change or turn off the schedule on the Routines page; what they set there beats `jade-schedule`.
3. **It is a built-in.** A built-in is trusted, so it needs no allowance (the allowance rule is for project and plugin agents). It is copied into Claude Code's own folder only when the person presses Install on the Agents page; the copy is recorded in `<data folder>/.state/agents-installed.json` and never overwrites a file they changed. Jade runs the file in `agents/` itself, so scheduling does not need the copy.
4. **Test it.** Switch Routines on in the test (`config.save({ modules: { routines: true } })`, as `test/agent-allowance.test.js` does) and check `scheduler.tasks()` lists `agent:<id>` with your schedule. Run `npm run test:one -- test/agents-claude.test.js test/agent-allowance.test.js test/routines.test.js`.
5. **Documents.** If the agent writes a new file or folder, add its row to `docs/architecture/data-folder.md`.

# Adding a skill

A skill is a folder with a `SKILL.md`: `<claude home>/skills/<name>/SKILL.md`, a project's `.claude/skills/<name>/`, or yours in `<JADE_HOME>/skills/<name>/`. It shows on the Skills page.

```md
---
name: my-skill
description: When to use it, in one line.
---
The steps to follow.
```

An agent uses a skill by naming it on its `skills:` line. Jade resolves each name for a built-in agent `<id>` in this order: `<claude home>/skills/jade-<id>-<name>` (the installed copy), `agents/<id>/skills/<name>` in the app, then a skill of that name in your own folders (never one from a project folder or a plugin: a built-in agent's instructions are not taken from someone else's folder, even if you have allowed other agents from there). For your own agents, and for a project or plugin agent you have allowed, any skill of that name is used; before it is allowed only skills of yours are. A skill folder named `jade-<id>-<name>` belongs to that agent: it is listed as "used by" and never picked by chat's word matching. Skills from Claude Code, projects and plugins are read-only here. A skill from a project or a plugin is listed, but chat does not pick it and it cannot be run until the PM presses **Allow this skill** on the Skills page; the allowance holds the hash of the skill's folder and lapses if the folder changes.

# Adding a skill to the Transcript agent

The Transcript agent reads a meeting once per skill. A new skill is a folder in `agents/transcript/skills/<name>/` with two files, and a line in `agents/transcript.md`:

1. `SKILL.md`: `name`, `description`, and what to look for, in plain words.
2. `schema.json`: the shape of the answer. It must be `{ items: [ { ...your fields, quote } ] }` with `quote` required (the exact words from the transcript; Jade drops nothing but flags any quote it cannot find). Add an `x-jade` block:

```json
"x-jade": { "heading": "Decisions", "quoteField": "quote", "saveTo": "record", "show": ["text", "owner"] }
```

`heading` is the section in the record; `show` lists the fields displayed (the first is the headline). `longText` (optional) lists the fields drawn as a larger text box on the review page; a field not listed there is a one-line box unless its text is long. `quoteField` names the field that holds the quote, so the review page keeps it out of the editable fields. `saveTo: "record"` keeps accepted items in the record only; `"actions"` also adds them to the action list and needs `"map": { "text": "<field>", "owner": "<field>", "due": "<field>" }`. `due` names the field that holds a calendar date (`YYYY-MM-DD`); the date is used only if it is a real date, otherwise the action has no date. `dueWords` (optional) names the field holding the deadline as it was said ("by Friday"); when there is no usable date, those words are added to the action's text. The built-in action skill has both: `due` (the words) and `due_date` (a date the model fills only when it follows from the words and the meeting date, which Jade gives it with the transcript), mapped as `"due": "due_date", "dueWords": "due"`.

A field edited or added by hand on the review page must be text or a list of text and match the skill's schema (including `enum`), or the change is refused.

3. Add the name to `skills:` in `agents/transcript.md`.

The checking agent, the review page, the meeting record and the dashboards' Recent meetings section pick it up with no change to Jade's code: the only edits are the skill folder and the `skills:` line in `agents/transcript.md`, which are agent files. A heading that is not about key points or decisions, risks or issues, or actions appears as an extra column in Recent meetings. Check it with `npm run test:one -- test/meeting-agent-files.test.js`: it checks that the three shipped skills are still on the line and that every skill on the line has a folder with a `SKILL.md`, and a `schema.json` of the shape above.

# Adding a dashboard layout

A dashboard is a JSON specification; Jade draws it. A layout is one renderer file and one schema entry, nothing else:

1. Add an entry to `LAYOUTS` in `server/core/dashboardspec.js`: `{ label, help, uses, need, sources?, groupType? }`. `uses` lists the options the layout reads (`source`, `filter`, `sort`, `limit`, `fields`, `group`, `note`, `figures`), `need` the ones it cannot do without, `sources` the sources it is limited to. The schema given to the model, the strict check of what it returns and the layout list sent to the page all come from this entry, so the builder agent can then choose it: its prompt (`agents/dashboard-builder.md`) holds no list of layouts, and the schema carries the layout's id. The model is given each layout's id, label, `help` and the options it needs, as a "Layouts" section that `buildPrompt` in `server/core/dashboards.js` builds from this table, so write `help` as a plain sentence about what the layout shows. (To add a data source or a field, add it to `SOURCES` there and collect its rows in `collect()` in `server/core/dashboards.js`.)
2. Add `public/js/dashboard/layouts/<id>.js` (the file name is the layout id) exporting `default function render(section, { data, schema })` that returns an element. Build it with `h()` and `s()` from `public/js/dashboard/dom.js`, which insert every value as text and allow only a short list of attributes (links only to `#/...` routes; project files through `fileLink()`). Never use `innerHTML`. Use `select()`, `filtered()` and `groupRows()` from `engine.js` for the rows, and count every number from them. Export `usesNote = true` if the layout shows the section's note itself.

`test/dashboard-render.test.js` fails if a layout has an entry without a file or the other way round, and renders each with hostile text to check it stays text; add your layout to the fixture in `scripts/gates/fixtures/dashboard.json` so the pages gate draws it too.

# Changing the dashboard questions

The questions a person answers for a new dashboard are in `server/modules/dashboards/questions.json`. To change them for yourself, copy it to `<JADE_HOME>/dashboards/questions.json`; that copy wins. Each question is `{ id, type, label, help, required }` where `type` is `choice`, `multi`, `text`, `longtext`, `folder` or `files`. `multi`, `choice` and `files` can take `"optionsFrom": "show" | "files"` (filled from what Jade holds for the project) and `"other": true` (a free-text extra). The answers are saved on the project and given to the Dashboard Builder, which returns a specification (not a page); code collects the data when the dashboard is opened, so a refresh needs no model.

# Adding a project panel

See *Project panels* above. The Meetings and Dashboards cards on a project page are built that way (`server/modules/meetings.js`, `public/js/views/meetings-panel.js`). A panel that should update by itself when something changes needs its event name in the project page's `refreshOn` list in `public/js/views/project.js`.

# Adding a setting with a control in Settings

A setting is a value in `config.json` that code reads and the person can change. The steps, in order (write the test first):

1. **Give it a default.** In `DEFAULTS` in `server/core/config.js`, or in `defaults` in a module's manifest (this is how a module's own settings get theirs). Code reads it with `config.get().<group>.<name>`. The test "every setting the server reads has a default" in `test/server-edges.test.js` fails if code reads a setting that has no default. A default must not name a model.
2. **Read it where it is used.** Always through `config.get()`, never a copy kept at the top of a file, so a change takes effect without a restart.
3. **Put a control in Settings.** Open `public/js/views/settings.js`. The page is one section at a time; `SECTIONS` at the top lists them (`id`, label, icon, one-line description), and the code below builds the section's HTML as a string when `sec` equals the id. Add your control inside the section it belongs to:
   - a switch: `rowSwitch('Plain title', 'One sentence of help', 'group.name', c.group.name)`;
   - a number or choice: an element with `data-k="group.name"` and `data-num` for a number (for example the "Agents at once" choice), or `data-bool` for a checkbox. A text input needs only `data-k`.
   `c` is the settings the page was given (`state.boot.config`). Wording rule: plain English for a project manager, no setting key and no jargon in the label or help text.
4. **There is nothing to wire for saving.** One handler in the same file (`set(path, value)`) listens for `change` on every `[data-k]` element, turns `group.name` into `{ group: { name: value } }` and sends it to `POST /api/config`, which merges it into `config.json` (`config.save` in `server/core/config.js`). That route accepts any key, so the default in step 1 is what makes a setting real. A setting that is not a plain value (a list of folders, say) needs its own handler like the ones below `set` for `permissions.roots`.
5. **Test it.** Server side: save through `POST /api/config` (see `test/helpers/server.js`) and check the code that reads it behaves differently. The page has no click test (see `docs/TESTING.md`); a view that is rendered into a stand-in root is tested in the `*-views.test.js` files, and `node scripts/gates/pages.mjs` opens Settings without console errors.
6. **Update the documents.** The list below ("Settings a feature can read") if a feature depends on it. `node scripts/gates/docs.mjs` fails if a document names a setting that does not exist.

# Settings a feature can read

All are in `config.json`, with a default in `server/core/config.js` (a module adds its own with `defaults`).

- `role`: what the soul file says the user does (default `project manager`).
- `connectors.keywords`: for each connector id, a regular expression (as text); a chat gets that connector only when its message matches.
- `output.rules`: the folder and file names the file ring knows: `systemNames`, `inputDirs`, `workingDirs`, `archiveDirs`, `outputDirs`, `recordDirs` (lists) and `bundleDir` (one folder name, off by default). See `DEFAULT_RULES` in `server/core/outputs.js`.
- `bridge.enabled`: the Claude bridge routes answer only when this is true, and the bridge's read-only fallback (reading the data folder while Jade is not running) refuses while it is false. The Routines commands (`routines`, `run`) also need the Routines module on.
- `memory.reindexMinutes` (15): how often the memory folders are re-read; 5 at the least. `agents.checkerModel` (blank): a model for the checking agent alone; blank means one size above the model the agents use (see `server/core/checker.js`).
- `chat.effort`, `agents.effort`, `agents.checkerEffort`: how hard the model thinks in chats, in automated work (the Transcript agent, dashboards, routines and other agent jobs) and in the checking agent (blank: same as `agents.effort`). Each is blank (the model's own default) or `low`, `medium`, `high`, `xhigh`, `max`. A chat's own choice beats `chat.effort`; `jade-effort` in an agent file beats `agents.effort` for that agent. Code reads them through `server/core/effort.js` and passes the result as the existing `effort` argument.

- `dreams.claude`, `dreams.web`, `dreams.days`, `dreams.maxCharsPerSession`, `dreams.maxChars`: the Dreams module (off until switched on). `claude` is `projects` (conversations in the PM's Jade project folders), `all` or `off`; `web` (default false) gives the Dreams agent its web tools and its "looking outward" section, and nothing else may; `days` is how far back (7); the two limits are in characters (6000 per conversation, 60000 in all) and a cut is always said in the text. Claude Code's conversations are read only by `server/core/claudesessions.js`, which keeps typed messages, replies, tool names and file paths, and never tool output, file contents or thinking. A module that needs the same reads that file; do not parse the session files elsewhere.
- Agent file keys used by Dreams: `jade-web: <setting>` (an agent's web connector is used only while that setting is true, for example `dreams.web`; with it off the run has no web tools). A context builder (`agents.addContext(...)`) may be async and may return `''` to leave its section out.

Jade's voice is `<JADE_HOME>/soul.md` (first run copies `agents/jade/soul.md` there). The system prompt starts with it; `{{assistant}}` and `{{role}}` are filled in.

# Routes and the server's secret

Every route a module registers with `on(...)` is protected for you: the server answers 401 or 403 unless the request carries the secret (see `server/core/auth.js`). Code in a view should call the `api` it is given, which sends it. A script that calls the server some other way reads the secret from `<JADE_HOME>/.state/token` and sends it as the `X-Jade` header.

How the key and the start link work, and what the key does not protect against, is in [SECURITY.md](SECURITY.md) and `docs/adr/0005-server-key-and-start-link.md`; the port and the order of checks on a request are in [ARCHITECTURE.md](ARCHITECTURE.md) sections 1 and 2. For your route this means: anything you serve outside `/api/` (a module's view files) needs the key like an API read, so a route of yours that serves data is safe by default. No file route may return or index `<JADE_HOME>/.state/` or `engine.env` (`files.isSecret`); if you add a route or an index that reads files, check with it. A body over `limits.jsonBody` is answered 413 (the upload limits are listed in [SECURITY.md](SECURITY.md)).

# Skeptic's lessons

Skeptic reads approved lessons from a folder you edit by hand: `<JADE_HOME>/<workflow>/lessons` and `<JADE_HOME>/skeptic/lessons.md`. Nothing in Jade writes a lesson any more, so the folder is empty unless you put something there; a run is never allowed to change it.
