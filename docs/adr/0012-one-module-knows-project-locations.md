---
status: accepted
---
# One module knows where a project's files live

## Context

A project has folders, and Jade keeps its own records in a sub-folder of the first one. About a dozen files looped over a project's folders, expanded `~` by hand, or guessed the name of the Jade sub-folder, with small differences (a blank entry was ignored in one place and became a relative path in another). A rename of the sub-folder or a fix to "folder cannot be written to" meant editing all of them.

## Decision

`server/core/locations.js` answers every "where is it" question about a project: its folders, the chosen folder, the Jade folder and its named parts, how `~` is read, whether a path is inside a folder, and whether a file is one of Jade's own records. Reading and writing are separate: `pathFor` never makes anything and `dirFor` makes the folder when needed. It never imports the store, so any file may use it. Callers (store, files, memory, permissions, bridge, dashboards, skills, agentfiles, dreams, search, claudesetup) ask it. The matching pieces were gathered at the same time: one `safeName` and one `guessTitle` in `server/core/util.js` and `server/core/transcripts.js`, and one secret-name pattern in `server/core/redact.js`. One difference is kept on purpose: `transcripts.safeName` (for an uploaded file name: keeps the extension, refuses Windows device names, 255-byte limit) stays separate.

## Consequences

- Renaming the Jade folder or adding a part is one edit in `locations.js`.
- Blank or non-text entries in a project's `folders` are ignored everywhere.
- The prompt text that prints a project's folders "as saved" is deliberately not a lookup and is not changed, because it is part of what Claude Code receives (`docs/adr/0004-bedrock-gateway-locked-by-parity-test.md`).

## How to tell if this should be revisited

Revisit if a new file loops over `project.folders` or expands `~` by hand (a sign the module's interface is missing something), or if projects need more than one place for records.
