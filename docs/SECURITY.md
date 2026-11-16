# Security

What Jade protects against, what it does not, which file owns each guard, and the limits Jade states openly. It is written to be read by a project manager first. Words such as "key", "run" and "allowance" are defined in `GLOSSARY.md`. The decisions behind the guards are in `docs/adr/`. This document does not promise more than the code does: where a guard is a question and not a lock, it says so.

## The short version

- Jade runs on your computer and listens on this computer only (`127.0.0.1`). Nothing outside can reach it.
- A secret key stops other websites, other user accounts and programs that cannot read your files from using Jade.
- A program running as you can read the key and so can use Jade. A Claude run that is allowed to run commands can do the same. Jade asks you first before such a run touches its own control files, but that is a question, not a lock.
- What you ask Jade about, and the context it builds for it, goes to Claude through your plan, your company's gateway or Amazon Bedrock. Whoever runs that connection can see it.
- The model can be wrong or be misled by what it reads. Jade limits what a wrong answer can do; it cannot make it right.

## What Jade is protected against

| Threat | The guard | Owner |
|---|---|---|
| Another computer reaching Jade | Listens on `127.0.0.1` only; every request must name a localhost `Host` (stops DNS rebinding); status 421 otherwise | `server/index.js` |
| A web page in your browser calling Jade | Every write must carry the key in the `X-Jade` header (a cookie is not enough, other sites send cookies); the cookie is `HttpOnly` and `SameSite=Strict`; no other site may frame Jade (`frame-ancestors`); a file is never guessed to be another type (`nosniff`) | `server/core/auth.js`, `server/index.js` |
| Another user account, or a program that cannot read your files, using Jade or learning the key | The key is made once and kept owner-only in a folder only you can enter; reading your data needs the key as header or cookie; the page that carries the key is given only to a browser that already has the cookie; anyone else gets a page with no data in it | `server/core/auth.js`, `server/core/gatepage.js` |
| The key on a command line or in a log | The start link is printed to a terminal only, never to a log or pipe; launchers open a small owner-only file that moves on to the link, so the key is never in a program's arguments (the app window gets that file's address, `server/core/browser.js`, `test/app-window.test.js`); the link is answered with a small script-free page (no redirect, which a browser would strip the cookie from when the link was opened from a file) that sets the HttpOnly, SameSite=Strict cookie and moves on to `/` | `server/core/opener.js`, `scripts/jade`, `scripts/jade.cmd`, `server/index.js` |
| A run reading the Jade key from its settings or environment | The key is not in a run's environment and not in the per-run tool settings; the approval tool is told where the state folder is and reads the key file itself; the per-run settings are owner-only, kept outside the folder runs may write to, removed when the run ends and cleaned at start | `server/core/engines.js`, `server/mcp/approve.mjs`, `server/core/auth.js` |
| A run changing your files without you knowing | Four permission modes (`read`, `ask`, `irreversible`, `auto`); every Edit and Write goes through Jade's approval tool; before an edit or overwrite the earlier version is kept and can be restored; every decision is logged; Jade only edits files under your home folder and folders you add under Settings → Permissions | `server/core/permissions.js`, `server/mcp/approve.mjs` |
| A run changing what it is allowed to do | The allowance and install records, `config.json`, `engine.env`, the key, Claude Code's `agents` and `skills` folders and each project's `.claude/agents` and `.claude/skills` always ask before a run changes them, in every mode that allows changes; a run may never change an agent's own rules and criteria (`skeptic`, `build`); a command that would print the environment asks | `isJadeOwned` and `classify` in `server/core/permissions.js` |
| A run reading secrets with Claude's own tools | Claude's Read, Glob and Grep tools are refused `engine.env` and the whole `.state` folder; this is passed on the command line to Claude Code | `secretReadDenies` in `server/core/engines.js` |
| Secrets appearing in saved or shown text | Run output, errors, chat turns as stored, the live event stream, Diagnose and the Dreams digest pass through one redactor that replaces the keys in `engine.env` and common key shapes with `[hidden]`; custom header values are never shown back in Settings | `server/core/redact.js`, `server/core/provider.js` |
| A route serving Jade's secrets | No route lists, serves or indexes the `.state` folder or `engine.env`; module view files must really lie (after following links) inside the module's own folder | `isSecret` in `server/core/files.js`, `server/api.js` |
| A link or path leading out of an allowed folder | Paths are checked after links are followed (`realpath`); a link inside a project or plugin folder is never followed when agents are found; the static file route refuses paths that leave the public folder | `server/core/files.js`, `server/core/agentfiles.js`, `server/core/static.js` |
| Someone else's agent or skill running with your rights | Agents and skills from a project folder or a plugin are listed but run read-only until you allow them, and the allowance is tied to the file's content, so a changed file asks again; one place decides whether anything may run | `server/core/allowances.js`, `server/core/mayrun.js`, `docs/adr/0007-allow-rule-for-project-and-plugin-agents.md` |
| A model writing code that runs next to your data | A dashboard is a checked list of sections from fixed layouts, drawn by Jade's own code; every value is put on the page as text; no model-written HTML or script runs anywhere | `server/core/dashboardspec.js`, `public/js/dashboard/`, `docs/adr/0008-dashboards-fixed-layouts.md` |
| A previewed file running code against Jade | An HTML file is shown in a sandboxed frame with no network, no forms and no access to Jade (a content security policy on `/api/files/raw`); only files in folders Jade can reach are served | `server/api.js` (`/api/files/raw`), `server/core/files.js` |
| "Open" starting a program | Programs and scripts (`.exe`, `.sh`, `.js`, macro-enabled Office files and more) are never started by Open; they are shown in their folder instead | `isProgram` in `server/core/files.js` |
| Text in a transcript, a file or a conversation giving the model orders | Such text is handed over as quoted material (the Dreams digest and dashboard facts are fenced with markers the model is told never to obey); the Transcript agent runs with every tool off; checking runs have no tools, no connectors and none of your settings, hooks or skills, and must answer in a fixed JSON shape; Dreams has no file-reading tools and its web tools are refused unless you turn the web switch on | `server/core/judge.js`, `server/core/dreams.js`, `server/core/dashboards.js`, `agents/transcript.md` |
| A checker passing weak work | A verdict must follow a contract (every criterion answered, evidence really present in the source); a verdict that breaks it is `blocked` or `not-checked`, never a pass | `server/core/skeptic.js` |
| Oversized or hostile uploads | Every upload and body has a limit (table "Upload limits" below); programs and scripts cannot be attached; names are made safe | `server/index.js`, `server/core/transcripts.js`, `server/core/store.js` |
| One bad request taking Jade down | Every request is answered even on failure (500); an unreadable file stream ends one answer; uncaught errors are logged and the server keeps running | `server/index.js`, `sendFile` in `server/api.js` |
| Running two Jades by mistake | A second launcher for the same data folder refuses to start and does not touch the first's pid file | `jade.js` |
| The Claude bridge being used unasked | Off until `bridge.enabled`; it has no tool that sends mail, deletes or edits your files; its read-only fallback works only when the bridge is on | `server/core/bridge.js`, `bridge/` |
| Claude Code reporting out or updating itself on a gateway | Jade sets the quiet variables (no telemetry, no auto-update, no non-essential traffic) when Claude Code runs through a gateway or key | `QUIET` in `server/core/provider.js` (locked, see below) |
| A change to what is sent to Claude Code on Bedrock or a gateway going unnoticed | A parity test pins the command line, environment, settings files and system prompt | `test/provider-parity.test.js`, `docs/adr/0004-bedrock-gateway-locked-by-parity-test.md` |

## What Jade does not protect against

Read this list as the honest edge of the guards.

1. **A program running as you.** It can read `<data folder>/.state/token` and `<data folder>/engine.env` and so can use Jade and your connection. The key keeps out other accounts and programs that cannot read your files; it does not keep out you.
2. **A Claude run that is allowed to run commands.** In the default mode (`irreversible`) a command that is not a delete, an install or something else Jade classes as dangerous runs without asking. Such a command can read the key file and the environment as the approval tool does. What stands in the way is that a command naming the `.state` folder, printing the environment (`printenv`, `env`, `$ANTHROPIC_...`) or touching an owned file asks first, and Claude's own file tools are refused. Jade can only read the command text before it runs; a command written to avoid those words may not be recognised. Treat a chat that can edit files with the care you would give a colleague at your keyboard. `read` mode allows no change at all.
3. **The connection key in the Claude process.** A gateway or Bedrock key must be in the environment of the Claude process (Claude needs it there). A run that may run commands could in principle find it. Redaction and asking are what is in the way.
4. **Secrets in unusual shapes.** Redaction replaces the keys held in `engine.env` and common key shapes. A secret typed into a chat in plain words, or in an unusual format, is not recognised and is stored as typed.
5. **`auto` mode.** It never asks about edits, deletions or sends through connectors (a command that names an owned file still asks). Every change is still logged and edits are still restorable, but a deletion made by command is not.
6. **What the model says.** Titles, notes, summaries and ideas are model words shown as plain text. They can be wrong, and text inside a transcript, a file or a Claude Code conversation can influence them. Jade marks such text to the model as quoted material, which lowers the risk and does not remove it. Check evidence before acting.
7. **What leaves your computer.** Your questions, the context Jade builds (parts of notes, files, transcripts, dashboard data and the text of fact files you tick, sample values of your data) go to Claude through your plan, gateway or Bedrock, and to connectors Claude Code calls for a question. Web search happens when a question asks for it. Web fonts load from Google unless you switch them off in Settings → Privacy (`privacy.webFonts`). An offline speech model downloads once if you ask for it. Jade has no analytics.
8. **Whoever has the start link.** The link carries the key. Do not paste it into chats, tickets or shared screens. A launcher leaves a small private file with the link in `<data folder>/.state/open.html` (owner-only on Linux and macOS).
9. **Windows file modes.** The owner-only mode of `engine.env`, the key and the state folder does not exist there. Jade tightens `engine.env` with `icacls` where it can; otherwise the access rules of the folder apply. Keep the data folder in your own profile. No test runs the Windows launcher (see `docs/TESTING.md`).
10. **An allowance is a click.** An allowance is a click, not a review. If you allow everything without reading it, it protects nothing. It covers at most 200 files and 4 MB of a skill folder.
11. **The bridge, when on.** A Claude Code session can read your actions and add notes. With Jade stopped and the bridge on, a read-only fallback reads the data folder directly, without the key.
12. **Claude Code itself.** Its own behaviour, settings and any connectors you add are outside Jade. Jade passes a defined set of variables through (the parity record lists them) and removes routing variables you did not choose.
13. **Everything else on your computer.** Disk encryption, screen locking, malware and who uses your account are yours to keep.

## Where each secret lives

| Secret | Where | Who can read it | Shown anywhere? |
|---|---|---|---|
| The Jade key | `<data folder>/.state/token` | You (owner-only); the approval tool and the bridge read it from there | In the start link only; never in a log; hidden in stored text |
| The connection key and headers | `<data folder>/engine.env` | You (owner-only); passed in the environment to each Claude Code process | Settings shows only the last four characters of a key and `Name: ••••` for headers; hidden in stored text |
| Allowances | `<data folder>/.state/agents-allowed.json` | You; Jade | An owned file: a run asks before changing it |
| Chats, jobs, meetings | `<data folder>/.state/`, project folders | You | Run output is stored with keys hidden |

## Upload limits

The one list of size limits. Other documents link here.

| What | Limit | Setting or constant | Answer when over |
|---|---|---|---|
| A JSON request body | 2 MB | `limits.jsonBody` in `server/core/config.js` | 413 "Request body is over the N byte limit"; a body that is cut off while it is being read gets the same answer |
| A chat image | 8 MB | `MAX_IMAGE_BYTES` in `server/core/store.js` | 413 "An image must be under 8 MB" |
| Another chat attachment | 25 MB | `MAX_FILE_BYTES` in `server/core/store.js` | 413 |
| A transcript file | 25 MB | `meetings.maxBytes` (read by `limits` in `server/core/transcripts.js`) | the meeting says the file is over the limit |
| A transcript's text | 400,000 characters | `meetings.maxChars` | the meeting says to split it into shorter parts |

## Reporting a problem

If you find a way past a guard in this document, do not post it in a public place with a working example. Tell the person who gave you Jade, with the steps and the version (`GET /api/boot` reports `version`, or look in `package.json`). Fixes follow the rules in `AGENTS.md`: tests first, and a change that touches what reaches Claude Code is a re-record of the parity test, with a reason.

## How the guards are tested

`test/key-gate.test.js` (the key and the start link), `test/run-secrets.test.js` (the key out of the run's settings, file modes, the approval tool), `test/security.test.js` and `test/hardening.test.js` (links, secrets, owned files, allowances tied to content, modules that are off), `test/permissions.test.js` (what is allowed, asked or refused, and restore), `test/server-edges.test.js` (the guard for a switched-off module, secrets never listed or served, 413, crash safety), `test/mayrun.test.js` (who may run), `test/dashboard-robust.test.js` and `test/dashboard-render.test.js` (a model cannot break or inject into a dashboard), `test/provider-parity.test.js` (what reaches Claude Code). What these do not prove is in `docs/TESTING.md`.
