---
status: accepted
---
# Project and plugin agents need an allowance, tied to the file's content

## Context

An agent file is instructions plus rights: it can ask for edit rights, Bash, a schedule, its own skills and the bridge. Files in a project folder or a plugin come from someone else (someone else's repository, a `git pull`, a plugin update). If Jade honoured their rights on sight, opening a shared project folder would be enough to run someone's instructions with the PM's rights.

## Decision

Agents and skills from the built-in set or the PM's own Claude home are trusted. Those from a project's `.claude/agents` and `.claude/skills`, or from a plugin, are always listed and can be run by hand at any time, but only as a read-only run, until the PM presses **Allow this agent to work on its own**. Until then their `jade-` keys are ignored (no edits, no commands, no timer, no skills of their own, not startable from a Claude session or from chat). The allowance is kept by the file's real path together with a hash of its text and of the skills it names (`server/core/allowances.js`); if anything differs later, it stops counting and the page says "changed since you allowed it". A link inside a project's or plugin's folder is never followed, and a file over 256 KB is ignored (`server/core/agentfiles.js`). The same rule applies to skills (`server/core/skills.js`). The rule itself is applied by `server/core/mayrun.js` (`docs/adr/0011-one-place-decides-may-run.md`).

## Consequences

- A `git pull` or plugin refresh that changes an agent asks the PM again. That is noise on purpose.
- The hash covers at most 200 files and 4 MB of a skill folder; larger folders are only partly covered.
- An agent that belongs to a module that is switched off cannot be started from anywhere, allowed or not.
- The allowance record is an owned file: a run always asks before changing it (`docs/SECURITY.md`).

## How to tell if this should be revisited

Revisit if PMs allow everything without reading (then the click protects nothing), or if teams need to share an allowance across machines (then it needs a signed or reviewed source, not a click). Do not weaken the content hash to reduce the prompts.
