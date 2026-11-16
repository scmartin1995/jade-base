# The data folder

Everything Jade keeps for itself is a plain file under the **data folder**: `~/JadeBase` unless `JADE_HOME` says otherwise (`JADE_HOME` in `server/core/config.js`). A project's own material lives in the project's folder, under its **Jade folder** (`Jade/`, the name is the setting `storage.folderName`). Back to the [architecture map](../ARCHITECTURE.md).

How to read the last two columns:

- **Secret?** "Key" means the server key, "provider key" means the gateway or Bedrock key, "private" means the PM's own words and work (not a key, but not for sharing), "no" means nothing sensitive by design.
- **Delete?** "Yes" means Jade makes it again and nothing is lost. "Loses X" says what goes. "No" means it is the PM's own work or something that decides what is allowed.
- Stop Jade first (or at least make sure nothing is running) before deleting anything in `.state`.
- Who writes a file is named by path; the code that owns the file is the only code that should change its format.

## In the data folder

| Path | What it is | Written by | Secret? | Delete? |
|---|---|---|---|---|
| `config.json` | The PM's settings, and the flag that set-up is done | `server/core/config.js` (`save`), Settings, by hand | no (custom header values are not here; they are in `engine.env`) | Loses all settings; set-up runs again |
| `engine.env` | How Claude Code reaches Claude: the gateway or Bedrock address, key and model pins, in Claude Code's own variable names | `server/core/provider.js` (`configure`), by hand | **provider key** (owner-only, never served, listed or shown back) | Loses the connection; enter it again in Settings |
| `soul.md` | How Jade speaks and what it always does | `agents.ensureSoul` copies it once from `agents/jade/soul.md`; the PM or a chat edits it | no | Yes (the shipped copy is used and copied again) |
| `README.md` | A note about the folder | `store.init`, once | no | Yes |
| `projects/<id>.json` | One project: name, description, folders, tags, saved dashboard answers and the list of its dashboards | `server/core/store.js` | private | No (loses the project; its folder and files are untouched) |
| `notes/<date>-<slug>.md` | A Markdown note with front matter; used for notes that belong to no project, or to a project with no usable folder | `store.saveNote` | private | No |
| `actions.json` | Action items of the same kind (no project, or no usable project folder) | `store.js` | private | No |
| `memory/facts.md` | Facts Jade was asked to remember | `store.remember`, by hand | private | Loses the remembered facts |
| `skills/<name>/SKILL.md` | The PM's own skills | `skills.save`, by hand | no | No |
| `agents/<id>.md` | The PM's own agents, or a file that adds to a built-in agent | `agentfiles` (`createAgent`, `editFile`), by hand | no | No |
| `<agent>/<file>` (for example `skeptic/`, `build/`, `chat/`, `dreams/`) | The PM's own copy of an agent's file (criteria, lessons, a skill); it wins over the one shipped in `agents/` | by hand; Skeptic's lessons by hand only (no run may change them) | no | Yes (the shipped copy applies again), but it loses the PM's edits |
| `modules/<id>.js` and `modules/<id>/views/` | The PM's own modules. A module is code that runs with Jade's rights | by the PM | no | No. Treat as code you wrote |
| `dashboards/questions.json` | The PM's own version of the dashboard questions | by hand | no | Yes (the shipped questions apply) |
| `attachments/<chat>/...` | Pictures and files pasted or attached in a chat | `store.saveImage`, `store.saveAttachment` | private | Yes; loses the files a chat refers to. Jade removes them itself after 30 days, and a picture once what it shows is in a file (`server/core/tidy.js`) |
| `deliverables/` | Where Jade saves files it makes when a project has no folder (or the folder chosen in Settings is not there) | Claude runs, through the permission tool | private | No. It holds the PM's work |
| `work/` | A free scratch folder for runs | `permissions.workDir` | private | Yes, when nothing is running |
| `handoffs/<time>-<words>.md` | Briefs written for a Claude session by the bridge | `server/core/bridge.js` | private | Yes |
| `engine.env.<pid>.<time>.tmp` | A half-written `engine.env` (crash leftover) | `provider.js` | provider key, if it stays | Yes |
| `.state/` | Everything below. Owner-only (0700). **Never served, listed or indexed by any route** | | | |

## In `.state/`

| Path | What it is | Written by | Secret? | Delete? |
|---|---|---|---|---|
| `token` | The server key | `server/core/auth.js` | **key** (0600) | Yes: a new key is made and the browser needs the start link again |
| `open.html` | A page that moves to the start link, so a launcher can open Jade without the key on a command line | `server/core/opener.js` | **key** (it contains the start link; 0600) | Yes |
| `jade.pid` | The launcher's process id | `jade.js` | no | Yes, when Jade is stopped. Deleting it while Jade runs stops `--stop` from finding it |
| `jobs.json` | The last runs: what they printed, tools used, files changed | `server/core/jobs.js` | private (keys are hidden by `redact`) | Loses the run list |
| `chats/<id>.json` | One file per conversation, with its turns. Older builds kept all of them in `chats.json` (and, before that, one in `chat.json`): the first start moves them over, checks each copy, and keeps the old file as `chats.json.migrated` | `server/core/store.js` | private (keys hidden) | Loses that conversation |
| `meetings/<id>.json` | One meeting: status, items, verdicts, steps, the path of its transcript and record | `server/core/meetings.js` | private | Loses the meeting from the list; the transcript and any record already written stay in the Jade folder |
| `models.json` | The models discovery found | `server/core/models.js` | no | Yes (found again) |
| `connection-test.json` | That a connection test passed with these exact settings | `server/core/connection.js` | no | Yes; set-up cannot finish until the check is run again |
| `agents-allowed.json` | The Allow records for project and plugin agents and skills (path, content hash) | `server/core/allowances.js` | no, but it **decides what may run**: only Jade writes it, and a run asks before touching it | Yes; everything that needed an Allow asks again |
| `agents-installed.json` | The hash of each built-in agent file Jade copied into Claude Code's folders | `server/core/agentfiles.js` | no | Yes; Jade then treats the installed copies as changed and leaves them alone |
| `changes.json` and `backups/` | The log of every file a run changed, and the earlier versions that **Undo** puts back | `server/core/permissions.js` | private (copies of the PM's files) | Loses Undo for past changes. Jade prunes old backups itself |
| `schedule.json` | When each scheduled task last ran | `server/core/scheduler.js` | no | Yes; tasks may run again at once |
| `skill-usage.json` | How often each skill was used | `server/core/skills.js` | no | Yes |
| `dreams.json` | Dreams' ideas by night | `server/core/dreams.js` | private (quotes the PM's work) | Loses past ideas |
| `output-overrides.json` | The PM's corrections to what counts as a finished deliverable | `server/core/outputs.js` | no | Loses the corrections |
| `skeptic/verdicts.jsonl` | Every verdict the checking agent gave | `server/core/skeptic.js` | private | Loses the Skeptic page's history |
| `engine-home/` | A private Claude Code configuration folder used with a gateway or Bedrock (no login in it), with the PM's agents and skills linked in | `server/core/provider.js` (`engineHome`), `server/core/enginehome.js` | private (Claude Code may keep its own working files here) | Yes, when nothing is running |
| `tmp/` | Free scratch for runs: `engine-settings.json`, `no-connectors.json`, the system prompt file of a run, builder definitions, files for model calls | `server/core/engines.js`, `agents.js`, `judge.js` | private (system prompts) | Yes, when nothing is running |
| `run/` | The per-run tool settings (where the approval tool is and which job it speaks for). **No key in them**. Owner-only (0600 files). Each start has a file name of its own (`mcp-jade-<job>-s<random>.json`). Removed when the run ends; leftovers are removed at the next start | `server/core/engines.js` | no | Yes, when nothing is running |
| `models/` | The offline speech model, once downloaded | `server/core/voicemodel.js` | no | Yes; download it again |
| `reveal.log` | One line per "show in folder" click, to trace a dead click | `server/api.js`, `server/core/files.js` | no | Yes |

## In a project's Jade folder

`<project's first folder>/Jade/` (the name is `storage.folderName`; `locations.js` knows the parts in `PARTS`). These are the PM's project material and are meant to be kept with the project, shared and backed up with it. If the project has no usable folder (none, missing, or not writable) the same things are kept in the data folder instead (`notes/`, `actions.json`), so nothing is lost.

| Path | What it is | Written by | Secret? | Delete? |
|---|---|---|---|---|
| `Notes/<date>-<slug>.md` | The project's notes | `server/core/store.js` | private | No |
| `actions.json` | The project's action items | `server/core/store.js` | private | No |
| `Meetings/<date> <title>.md` | A meeting record the PM asked Jade to write | `server/core/meetings.js` (`writeRecord`) | private | No |
| `Meetings/transcripts/<name>` | A copy of each transcript that was dropped | `server/core/transcripts.js` (`receive`) | private | No, if a record or a meeting still points at it |
| `Dashboards/<name>.json` | A dashboard's specification (no data, no page, no script) | `server/core/dashboards.js` | no (names fields and layouts only) | Loses that dashboard (the project still lists it as "not built yet" and it can be rebuilt) |

A project's `.claude/agents/` and `.claude/skills/` belong to Claude Code and the project, not to Jade. Jade only reads them, and a run always asks before changing them.

## Rules that keep this safe

- Nothing in `.state` or `engine.env` may be returned, listed or indexed by any route: use `isSecret` in `server/core/files.js` whenever a route reads files.
- Text that may contain a key goes through `redact()` (`server/core/redact.js`) before it is stored or shown.
- Reading never creates a folder: use `locations.pathFor` or `store.projectPath` to read and `locations.dirFor` or `store.projectDir` to write.
- A new file in the data folder gets a row here, in the same commit.
