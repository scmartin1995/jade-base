---
status: accepted
---
# The checking agent runs one size above the agent it checks

## Context

Skeptic checks the Transcript agent's items against the exact words said. A checker as small as the model it checks shares its blind spots; a checker far larger costs more than the whole meeting. The PM has no way to know which to pick.

## Decision

When the setting for the checking agent's model is blank, it runs one size above the model the Transcript agent uses (quick, then everyday, then strong), chosen only from models that discovery found (`server/core/checker.js`). The rule lives in that one file, applies at run time, and Set-up and Settings show what will be used by asking the server (`GET /api/setup/checker`). If there is no size above, or Jade does not recognise the size of the model, the checker uses the same model and the page says so; it never guesses silently. A model chosen in Settings, or in the agent's own file for a trusted agent, wins over the rule.

## Consequences

- A PM who picks the quick model for the agents gets an everyday checker without choosing it.
- On a connection where only one size is offered, the checker is the same model as the agent. That is stated, not hidden.

## How to tell if this should be revisited

Revisit if the checking results show a same-size checker passes things a larger one rejects, or the reverse; the numbers are on the Agents page (how often Skeptic passed or sent work back, `GET /api/skeptic`).
