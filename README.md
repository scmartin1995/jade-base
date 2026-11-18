# Jade Base

[![test](https://github.com/scmartin1995/jade-base/actions/workflows/test.yml/badge.svg)](https://github.com/scmartin1995/jade-base/actions/workflows/test.yml)

Jade Base is a local web app for project managers. It keeps projects, notes and action items, searches your own files, and has a chat with Jade that runs on **Claude Code**, using the Claude plan you already have, or Amazon Bedrock or a company gateway. Drop in a meeting transcript and it gives you a checked record and action items; ask for a dashboard and it builds a page for a project. There are no other API keys and no npm dependencies: it needs Node 22+.

## Requirements

Node 22 or newer (an LTS release: 22, 24 or 26; Node 20 no longer gets security fixes and Jade warns when it starts on it), the Claude Code command line tool, and a way to reach Claude: a Claude plan you can log in to, or Amazon Bedrock or a company gateway (ask whoever runs it for the address and a key). Nothing else is installed: Jade has no npm dependencies.

## Start

```bash
npm install -g @anthropic-ai/claude-code   # if you do not have it
claude auth login                          # on a Claude plan
npm start                                  # opens Jade in its own window; also prints the start link
npm start -- --tab                         # open a tab in your browser instead of a window
npm start -- --no-open                     # only prints the start link
```

### How you open Jade (the key)

Jade keeps a **key** in `.state/token` in the data folder, readable only by you. On start, Jade prints one line in the terminal, `Open Jade: http://127.0.0.1:<port>/?key=…`, and shows nothing like it anywhere else (it is never written to a log). Opening that link gives your browser the key (through a short "Opening Jade" page) and moves straight on to `http://127.0.0.1:<port>/`, so the key does not stay in the address bar or history. The launchers do this for you: `npm start` and `scripts/jade` (Linux and macOS) and `scripts\jade.cmd` (Windows) open Jade with the key without showing it on a command line. If you open that address without the key (a bookmark, a new browser), you get a plain page saying Jade is running, with a box to paste the key or the whole link; or just start Jade again from its shortcut. A window that is already open keeps working when Jade restarts; the key does not change.

**The window.** With Chrome, Chromium, Edge or Brave installed (Edge always is on Windows), Jade opens in its own window with no address bar, tabs or bookmarks, using your normal browser profile (so your password manager and zoom still work). The terminal says `Jade opened in its own window.` Without one of those browsers, or in Firefox or Safari, which have no such window, Jade opens a tab and says so. The `jade` command (`scripts/jade`, `scripts\jade.cmd`) behaves the same. To always use a tab: `npm start -- --tab` (or `jade --tab`), `JADE_WINDOW=tab`, or Settings → Look → Window (`window` in `config.json`). `JADE_BROWSER=/path/to/browser` picks the browser. Why it is a window and not a packaged app: `docs/adr/0019-app-window.md`.

Your data lives in `~/JadeBase` (set `JADE_HOME` to use another folder, `JADE_PORT` for the port). Settings shows what Jade found.

### First run

The first time, Jade opens a short set-up: how Claude Code connects, which models the automated agents use (only models Claude reports are listed), how hard Jade should think in chats and in automated work (both start at the model's own default), your name, whether to add Jade's agents to Claude Code, and a first project. You can leave and carry on later from **Finish set-up** in the top bar, or run it again from Settings → Meetings and automated agents.

For Bedrock or a gateway, use Settings → Engine (*How Claude Code reaches Claude*): paste the address and key you were given, press **Check and save**, and use **Diagnose** if it fails. If Claude Code on this computer is already set up for Bedrock or a gateway, **Use my Claude Code settings** takes those over, so you type nothing. Ask whoever manages your gateway for the address and the key, and for the AWS region if there is one. The key is kept in `~/JadeBase/engine.env`, outside `config.json`.

### Meetings

Open **Meetings**, choose the project and drop a transcript on the box (`.vtt`, `.srt`, `.txt`, `.md`, `.docx`, `.pdf` or a Teams, Zoom or Otter `.json` export; there is a size limit, see "Upload limits" in `docs/SECURITY.md`). Jade reads it, pulls out key points, action items, and risks and issues, and a second agent checks each one against the exact words said. You tick what to keep, press **Record**, and the kept items are written to a Markdown record; kept action items also go on your action list. A file too long or cut short is refused with a reason, never trimmed. The same file dropped twice is recognised.

### Where files are saved

In the project's first folder, under `Jade/` (the name is set in Settings → Files): transcripts in `Jade/Meetings/transcripts/`, records as `Jade/Meetings/<date> <title>.md`, dashboards in `Jade/Dashboards/`. A project with no folder keeps these in the data folder.

On Linux, `bash scripts/install-launcher.sh` installs a `jade` command and a desktop entry. On Windows, use `scripts\jade.cmd`.

## What is in it

| Page | What it does |
|---|---|
| Home | Your projects, actions due and what agents are doing |
| Chats | Conversations with Jade, which can add actions and notes, create projects and run agents |
| Projects | A list of projects and a page per project: description, folders, files, notes, actions, meetings, dashboards |
| Meetings | Drop a transcript, check the results, record them (see above) |
| Dashboards | For each project, how it is set up in Claude Code and the dashboards built for it from a few questions |
| Notes | Markdown notes linked to projects; Jade can pull action items out of them |
| Action items | One list from notes, chat and agents |
| Memory | Search across folders you add and across your project folders, plus long-term facts |
| Skills | `SKILL.md` playbooks, in the Claude Code format; Claude Code's own skills in `~/.claude/skills` are listed too |
| Agents | The agents, their runs, and Skeptic, the checker: how often it passed or sent work back |
| Routines | What runs on a schedule or a button (off until you turn it on) |
| Dreams | A nightly look at the week's work that brings back ideas (off until you turn it on) |
| Voice | Wake word and spoken replies (off until you turn it on) |
| Modules, Settings | Switch parts on and off; engine, connectors, folders, permissions |

There is also a Claude bridge (`bridge/`, see `bridge/README.md`) so Claude Code can read Jade's actions and notes.

## Agents and skills

Agents are Claude Code agent files: `~/.claude/agents/<name>.md` (yours), a project's `.claude/agents/`, and the ones plugins bring. The **Agents** page lists all of them, including ones Claude builds for you in a session. Jade's built-in agents run from the app until you press **Install** (or answer yes in set-up), which copies them and the skills they own into Claude Code's folders; a file you have changed is never overwritten. An agent in a project folder or a plugin is always listed, and you can run it by hand from the Agents page at any time, but until you press **Allow this agent to work on its own** that run is read only: no edits, no commands, no timer, none of its own skills, and a Claude session cannot start it. The page shows where the file comes from and what it asks for; the allowance is kept in the data folder by the file's real path together with a hash of its text (and of the skills it names), and can be taken back. If the file or one of those skills is different later (a `git pull`, a plugin refresh), the page says **changed since you allowed it**, the allowance no longer counts, and you are asked again. Agents of yours and Jade's own need no allowing, and an agent still waiting for an allowance is not listed in Jade's chat. A link in a project's or plugin's folder is never followed, and an agent or skill file over 256 KB is ignored. Skills (`SKILL.md` folders) from Claude Code, your projects and plugins are listed read-only on the **Skills** page; a skill from a project or a plugin needs the same allowance (a button on its card) before chat can pick it by its words or a run can use it. An agent that belongs to a module that is switched off cannot be started from anywhere.

How Jade speaks and what it always does is a plain text file, `soul.md` in the data folder, made on first run from `agents/jade/soul.md`. Edit it, or ask Jade in a chat to change it. To add your own page, agent or skill, see `docs/EXTENDING.md`.

## Dreams

Dreams reads your last week of work and brings back ideas, each with the evidence behind it: an **agent** worth building, a **skill** for something you do the same way each time, something **worth writing down**, a fact **worth remembering**. It reads Jade's own week (chats, agent runs and failures, what the checking agent sent back, skills used, notes, finished actions, recorded meetings) and, if you allow it, your **Claude Code conversations**: what you typed to Claude and what Claude answered (trimmed), the names of tools used and the files they touched, and whether a conversation ended in an error. It never reads what tools returned, the contents of files, or Claude's thinking, and Jade's own background runs are not counted as your conversations. All of that text goes to the model you have chosen, nowhere else. IDE selections and open-file blocks, compaction summaries and anything that looks like a key are left out of it, and each source is fenced as quoted material between marker lines that carry a random mark, which the model is told never to treat as instructions. The Dreams run has no file-reading tools at all, and with the web switch off its web tools are explicitly refused.

Open **Dreams** to see each night's ideas. Dismiss one, or press the button on it: Jade then shows you the full text of every file it would create (a skill is written in two places: Claude Code's skills and Jade's own), and nothing is created until you confirm that exact text. Files are written create-only (nothing is overwritten, and a note with the same title that day is refused), and if one write fails the others are taken away again. An accepted agent or skill is made in Claude Code's folders (`~/.claude/agents`, `~/.claude/skills`), so it shows on the Agents and Skills pages as yours; a note goes in the project's `Jade/Notes`; a fact goes in memory. **Dream now** runs it at once.

Two switches, both under **Settings → Dreams** (the section appears when the module is on):

- **Which Claude Code conversations** (`dreams.claude`): `projects` (the default: only conversations in your Jade projects' folders), `all` (every conversation on this computer) or `off` (Jade's own work only).
- **Let Dreams search the web** (`dreams.web`, off by default): when off the agent has no web tools and is told nothing about looking outside; when on it may search with general terms only, never your name, company, projects or files, and brings back two more kinds of idea, each with a web address.

Dreams is **off by default**; switch it on under Modules. Its nightly run (`daily 02:30`, set in `agents/dreams.md`) happens only when Routines is on too. How far back and how much text: `dreams.days` (7), `dreams.maxCharsPerSession` (6000) and `dreams.maxChars` (60000); when a conversation or the whole section is cut, the text says so. What the agent is asked for is in `agents/dreams.md`, `agents/dreams/outward.md` (the web part) and `agents/dreams/kinds.json` (the kinds of idea and what each needs), all editable.

## Claude bridge

The bridge lets a Claude Code session read your actions and add notes through Jade. It is off until you switch it on under Settings → Privacy, and Jade must be running. Then register it once with `claude mcp add --scope user jade -- node /full/path/to/jade-base/bridge/jade-mcp.mjs` (details in `bridge/README.md`).

## Models

Jade only offers models it discovers. On Bedrock or a gateway that is the endpoint's own list; on a Claude plan it is the list Claude Code reports for `/model`. Nothing is typed into Jade's code. If none are found, the chat's model menu and Settings say so; run Diagnose. Chats use the everyday model found, unless you pick one in Settings or per chat.

## Dashboards and safety

A dashboard is a saved list of sections, not a page. You answer a short questionnaire; Jade gives your answers, a short description of the data it holds for the project (field names, counts, a few sample values with secrets hidden) and the text of the fact files you ticked to the model you chose. Ticked files are quoted to the model as facts to draw on; they are not imported, so a CSV of actions does not become action items. The model replies with a specification only: a title, an introduction and sections, each naming one of a fixed set of layouts (headline numbers, table, grouped list, bar chart, timeline, next two weeks, text, recent meetings), one of the project's data sources (actions, notes, meetings, files, the Claude Code set-up) and the fields, filters and sort to use. It writes no HTML and no script, and it writes no numbers: Jade counts every figure from the real data each time you open the dashboard, so refreshing needs no model.

Jade checks the specification strictly against a schema and against the data that exists (an unknown layout, source, field or key is rejected, strings are length-capped) and saves it as `<project folder>/Jade/Dashboards/<name>.json`, never overwriting an existing file when it is new. The app page then draws it with Jade's own code. Every value is put on the page as text, never as markup, and links go only to Jade's own pages or open a project file in the app's file preview. No model-written code runs anywhere: there is no frame, no injected data object and no page served from the dashboard folder. "Change it" asks the model for a revised specification from your words; you can also remove or reorder sections yourself without a model.

What remains: the model's own words (titles, introduction, notes and the text section) are shown on the page as plain text, so a model can say something wrong or misleading, though it cannot make the page do anything; and the text of the fact files you tick, and the sample values of your actions, notes and meetings, are sent to the model you chose, so tick only files you are willing to send, and note that a file with hidden instructions can influence what the model chooses to show (Jade marks that text to the model as quoted material, not instructions). Dashboards made before this change are kept and listed as "older dashboard": you can open the file in the preview or rebuild it in the new style from your saved answers; Jade no longer serves them with your project data. The file preview runs an HTML file's script in a sandbox with no network and no forms.

## Folders Jade reads

None are set by default. Add folders under Settings → Files; project folders are always read. Jade may edit files under your home folder and any folder you add under Settings → Permissions, in the mode you pick there (read only, ask, ask only for the irreversible, auto). Every change is logged and edits keep the previous version.

## Privacy and safety

Jade listens on `127.0.0.1` only, has no analytics, and keeps everything as files in `~/JadeBase`. What leaves the computer: your questions and the context Jade builds for them (to Claude via your plan, Bedrock or gateway), connector calls Claude Code makes when a question needs them, web search when a question asks for it, web fonts (switch off in Settings → Privacy), the update check (git asking GitHub whether this copy of Jade is behind; switch off in Settings → Updates), and, once, an offline speech model if you ask for it. Jade keeps a key in `.state/token` in the data folder (readable only by you). The page that carries the key is given only to a browser that opened the start link (or pasted the key); every write and every read of your data must show the key. **What this protects against:** another user account on the same computer (a shared or terminal server, say) and any program that cannot read your files cannot read or change anything through Jade's port, and cannot get the key by asking for the page. **What it does not protect against:** a program running as you can read the key file and so can use Jade; so can a Claude run that is allowed to run commands (in the default permission mode a command that is not a delete or an install runs without asking), so treat a chat that can edit files with the care you would give a colleague at your keyboard. Jade's own routes refuse to return the key file and `engine.env`. The key is not put in the environment of Claude processes, and not in the settings Jade writes for a run: the permission tool Jade gives each run is only told where the `.state` folder is and reads the key from `.state/token` itself. The `.state` folder is closed to other user accounts, those per-run settings are kept in `.state/run` (owner-only, never in the folder runs may write to), each is deleted when its run ends, and any left behind by a crash are deleted the next time Jade starts. This is not a lock against the run itself: a run that is allowed to run commands is able to read the key file the same way the permission tool does, so what stands in the way is the asking described below (a command that names `.state` asks first, and Claude's own Read tool is refused the folder). Jade's own state is not open to a run: only `.state/tmp` and `work/` are free for a run to write. The allowance and install records, `config.json`, `engine.env`, the key file, Claude Code's `agents` and `skills` folders and each project's `.claude/agents` and `.claude/skills` always ask before a run changes them (Edit, Write, or a shell command that names them), in every permission mode including auto; a shell command that would print the environment (`printenv`, `env`, `$ANTHROPIC_…`) asks too. Claude's own Read, Glob and Grep tools are refused `engine.env` and the `.state` folder. A gateway or Bedrock key still has to be in the environment of the Claude process (Claude needs it there), so a run that is allowed to run commands could in principle find it; the asking above is what stands in the way, and every place Jade stores or shows a run's text (the run, its error, the chat, the live event stream, Diagnose, the Dreams digest) has the keys in `engine.env` and common key shapes replaced by `[hidden]`. Custom header values are never shown back in Settings (`Name: ••••`; leave them as they are to keep the saved ones). On Windows the owner-only mode of `engine.env` does not exist: Jade tightens the file with `icacls` to your account when it can, and otherwise it keeps the access rules of its folder, so keep `~/JadeBase` in your own profile. Anyone who is shown the start link has the key, so do not paste it into chats or tickets. The Claude bridge is off until you switch it on, and Voice is off until you switch on the Voice module.

## Updating Jade

If Jade was installed with `git clone`, it checks a minute after it starts and then every six hours whether GitHub has a newer version of the branch it follows. When it has, **Update available** shows in the top bar. Settings → Updates lists what changed and has **Update now**, which brings this copy level with GitHub (a fast-forward only: it never overwrites changes made in this copy, and says why when it cannot update). Jade restarts by itself afterwards, once nothing is running; if the launcher itself changed, it asks you to start Jade again. **Check now** asks at once, and the switch on that page turns the automatic check off (`updates.check`). Without git, download the new version and replace the folder; your data in `~/JadeBase` is not in it.

Claude Code is updated separately: Jade turns off Claude Code's own automatic updates for the work it starts, so run `claude update` in a terminal now and then. Settings → Updates shows the version installed.

## If you want to change Jade or fix a problem

Open this folder with an AI assistant (or read the documents yourself). `docs/ARCHITECTURE.md` shows where each part of the code is. Start with `AGENTS.md`: it is the short list of rules and says which document to read for each kind of task, including `docs/TROUBLESHOOTING.md` when something goes wrong. `node scripts/gates/docs.mjs` fails when a document names a file, command, route or setting that does not exist, so they stay true.

## Tests and gates

`npm test` runs every test and `npm run gates` runs the checks that look at the whole project (imports, a boot test, every page, a sample module, personal material, and the documents). A test never touches your data or starts a real `claude`. What each one proves and how to run a single one: `docs/TESTING.md`. What is known to be left undone, on purpose, is in `docs/KNOWN-LIMITS.md`.

## Settings and look

Most settings are in **Settings**. A few are only in `config.json`, in your data folder (all have defaults); they are listed, with what each does, in `docs/EXTENDING.md` under "Settings a feature can read".

The look is the built-in Osaka Jade palette.
