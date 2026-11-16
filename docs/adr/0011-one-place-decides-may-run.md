---
status: accepted
---
# One place decides whether an agent or skill may run

## Context

The rule "an agent or skill from a project folder or a plugin must be allowed first, and the allowance must still match the file" was once written by hand in about eight places: the queue, the schedule, the bridge, a chat action, the chat's lists of what it may name, and the skills lookup. Each had its own wording, and a new way of starting one could forget a check, which is a security hole, not a style problem.

## Decision

`server/core/mayrun.js` has one function, `mayRun({ agent } | { skill }, how)`, that answers: may it run, may it only ask the PM first, what is the plain-words reason, is it read-only, may it edit. It takes the way it is being started (`manual` or `rerun` by hand; any other way such as a schedule, a chat or the bridge; or `offer`, for listing to a chat). It knows: module on or off, trusted or allowed, content hash still matching, read-only or not, and whether Jade can run that agent at all. Every caller asks it: `jobs.enqueue`, `scheduler`, `bridge`, the chat actions in `server/core/agents.js`, the chat lists, `skills.match`. `mayrun.js` imports nothing; `server/core/modules.js` hands it two lookups when it loads, so it cannot deadlock the module loader. `test/mayrun.test.js` walks every combination.

## Consequences

- A new way to start an agent must call `mayRun`. A reviewer can find a missed one by searching for the places that start a job.
- Until `modules.js` has loaded, an agent that names a module counts as switched off, which fails safe.
- Messages for a refusal read the same everywhere.

## How to tell if this should be revisited

Revisit if a decision needs input `mayRun` cannot get without importing the world (for example per-project rules). Do not copy the rule back into a caller; add the input to `mayRun`.
