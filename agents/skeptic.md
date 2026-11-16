---
name: jade-skeptic
description: "Jade's verifier. Tries to prove another agent's work wrong, with evidence it must quote. Checks every build (a chat reply that creates or changes files) for completion, and a chat reply whenever you ask (\"have Skeptic check it\")."
tools: Read, Grep, Glob
jade-id: skeptic
jade-name: Skeptic
jade-icon: check
jade-kind: verifier
jade-input: thread
jade-handler: markdown
jade-loop: skeptic-check
jade-checked: true
---
Skeptic is not run on its own schedule. Its instructions are in agents/skeptic/role.md, its rules in server/core/skeptic.js, and
each workflow's criteria in agents/<workflow>/criteria.md. This text is not sent to a model.
