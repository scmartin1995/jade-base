---
status: accepted
---
# Dreams reads conversations and is off by default

## Context

Dreams is useful because it looks at what the PM really did, including their conversations with Claude Code, and brings back ideas (an agent worth building, a skill, a note, a fact) with evidence. That text is personal. It goes to the model the PM chose, and the PM may not expect Jade to read their Claude Code history.

## Decision

Dreams is a module that is off until the PM turns it on (`defaultOff` in `server/modules/dreams.js`). What it reads is a setting, `dreams.claude`: `projects` (the default, only conversations in the folders of the PM's Jade projects), `all`, or `off` (Jade's own work only). It reads what the PM typed and what Claude answered (trimmed), the names of tools used and files touched, and whether a conversation ended in error. It never reads what tools returned, file contents or Claude's thinking (`server/core/claudesessions.js`). Anything that looks like a key is left out, and each source is fenced as quoted material with a random mark that the model is told never to treat as instructions. The run has no file-reading tools, and with `dreams.web` off (the default) its web tools are refused. Accepting an idea shows the full text of every file it would create, and nothing is created until the PM confirms that exact text; files are written create-only. The nightly run happens only when Routines is on too; "Dream now" works without it.

## Consequences

- Without the PM's opt-in, no conversation is read. Turning the module on does not by itself send everything: the scope setting limits it.
- The digest is sent to the chosen model and nowhere else. This is stated on the Dreams settings and in `README.md`.
- Ideas are model output about the PM's work and can be wrong; the evidence is shown beside each so the PM can check.

## How to tell if this should be revisited

Revisit if Dreams is turned on without the scope being understood (change the default to `off`), or if Claude Code changes its conversation file format (`server/core/claudesessions.js` reads a documented set of line types and ignores the rest; the tests would need new samples).
