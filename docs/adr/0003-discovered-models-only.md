---
status: accepted
---
# Only discovered models are offered, and no model name is written in the code

## Context

Model names change often and differ by connection. On Bedrock a model is an inference profile id with a region prefix; behind a gateway it is whatever the gateway lists; on a plan it is an alias Claude Code accepts. A name typed into the code works on one machine and fails on another, and the failure looks like a broken request, not a wrong name.

## Decision

Every place that offers or uses a model gets it from discovery (`server/core/models.js`: Claude Code's own `/model` answer, plus the endpoint's list when it has one), cached in `<data folder>/.state/models.json`. The settings `models.claude`, `agents.model`, `agents.checkerModel` and `dashboards.model` default to blank, and blank means "use the model Jade would pick anyway": the everyday one found, or Claude Code's own default when none was found (`models.everyday()`). Models are ranked by size (quick, everyday, strong) from the family in their name; a name Jade does not recognise is handled in a stated way (the same model, with a note), never silently (`server/core/checker.js`). Tests enforce that no model name appears in the set-up and Settings pages, the set-up route or the set-up files (`test/models-offerable.test.js`, `test/setup-files.test.js`). The one place family names do appear is the locked connection code (`server/core/provider.js`, `server/core/engines.js`, `server/core/models.js`): Claude Code's own pin variables are named after the three families, and the connection check and the "everyday" fallback use the family alias. That is Claude Code's vocabulary and part of what the parity test freezes, not a list of models Jade offers. Documents follow the same rule as the pages: use "quick", "everyday", "strong".

## Consequences

- If discovery finds nothing, the pickers say so and send the PM to Diagnose, instead of offering a guess.
- An agent file's `model:` key is honoured only for a trusted agent and only when that model was discovered (`server/core/checker.js`, `pinned`).
- Choosing the "everyday" model for blank settings means a PM sees different models on different connections. That is intended.

## How to tell if this should be revisited

Revisit if discovery becomes unreliable on a connection people use (the model list is empty or wrong on Bedrock, say). The fix then is in discovery, not a typed list. Changing how a model choice reaches Claude Code changes the parity record; see `docs/adr/0004-bedrock-gateway-locked-by-parity-test.md`.
