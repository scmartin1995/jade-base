# Jade bridge

This lets a Claude session read and update Jade without copy and paste. Jade stays the organiser. Claude stays where the work
happens.

From a Claude session you can ask: what is open on this project, tick an action off with a note, add a note, find a file,
list the newest finished deliverables, start a Jade routine, ask Jade a question, and hand a task from Jade to a Claude session.

It cannot send mail, delete anything or edit your files. There is no tool for any of those.

## The two pieces

- `bridge/jade-bridge.mjs` is a small command line tool. Every call prints one line of JSON and exits 0, even when it fails
  (`{"ok":false,"error":"..."}`). Run `node bridge/jade-bridge.mjs --help` to see the commands.
- `bridge/jade-mcp.mjs` offers the same commands to Claude as tools named `jade_status`, `jade_actions`, `jade_action_done`,
  `jade_note_add`, `jade_find`, `jade_outputs`, `jade_output_override`, `jade_routines`, `jade_run`, `jade_job`, `jade_ask`
  and `jade_handoff`.

Neither needs anything installed. Both are plain Node.

## How it reaches Jade (tried in this order)

1. Straight to Jade on `127.0.0.1:4778` (or the port in `JADE_PORT`).
2. Through `powershell.exe`, for a Claude session in WSL, where `127.0.0.1` does not reach Windows. Whatever you type is passed
   to PowerShell as data, never pasted into a command, so quotes, `$` and non-English text are safe.
3. Reading Jade's data folder directly. This works only for looking things up (`status`, `actions`, `find`, `job`) and only
   when Jade is not running and the bridge is switched on in Jade's Settings (the switch is read from `config.json`). It never writes. Every command that changes something stops and says Jade must be running.

Each answer says which way it came in (`source`). To limit the ways tried, set `JADE_TRANSPORT`, for example `http,files`.

## Switching it on

Nothing here changes Claude's settings. When you decide to use it, add this one line to the Claude MCP configuration (or run it
once in a terminal). Use the real path to this repo on your machine:

```
claude mcp add --scope user jade -- node /full/path/to/jade-base/bridge/jade-mcp.mjs
```

If Claude runs in WSL and Jade runs in Windows, the path is the WSL path, for example `/mnt/c/Users/<you>/code/jade-base/bridge/jade-mcp.mjs`.

The bridge is off in Jade until you switch it on: Settings → Privacy → Claude bridge. Until then its routes answer 403. Every call also carries Jade's secret, which the bridge reads from `<Jade data folder>/.state/token` (or `JADE_TOKEN`); the file is owner-only (a program running as you can read it too). `jade_routines` and `jade_run` need the Routines module switched on.

## What it costs in tokens

Claude reads each tool's name and description at the start of a session. The twelve tools together are about 3,600
characters, roughly 900 tokens, every session while the server is switched on. Calls themselves cost only what they return
(a list of 20 files is a few hundred tokens). If you want it lighter, the command line tool costs nothing at rest: Claude
can call it through Bash only when needed.

## Asking Jade a question

`jade_ask` puts the question to Jade in a new conversation named "From Claude: ...". Jade answers from what it knows and can
read files, but in this mode it is told it may not change anything, and the code also removes its permission to edit files and
to add actions or notes. `--wait 60` waits up to 60 seconds for the answer; without it you get a job id and use `job` to check.
That conversation uses Jade's own engine, so it costs usage like any Jade chat.

## Handing a task to a Claude session

`handoff` writes a short brief to `<Jade data folder>/handoffs/<time>-<words>.md`: the task, the project's folders, the open
actions, and what done looks like. It returns a one-line prompt to paste into Claude. It is a plain file you can read first.

## Limits

- Text sent is capped at 100,000 characters.
- `run` starts only routines you can see on Jade's Routines page. Hidden helpers, builders and the checker cannot be started.
  A routine that needs a project needs `--project`. A routine that needs other input (a note, a folder) must be started in Jade.
