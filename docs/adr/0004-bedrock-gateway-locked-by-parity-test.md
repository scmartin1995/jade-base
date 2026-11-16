---
status: accepted
---
# What reaches Claude Code is locked by a parity test

## Context

Many people use Jade on Amazon Bedrock or through a company gateway. The set-up in `server/core/provider.js`, `server/core/engines.js` and `server/core/models.js` can only be proven on a machine that has such a connection, which the automated tests do not have. On Bedrock a small change (a model name, an extra variable, a missing proxy setting, a different file inside a setting) can make every request fail, and nobody on the team can see why.

## Decision

Behaviour of those three files toward Claude Code is frozen. `test/provider-parity.test.js` builds, with a stand-in `claude`, the full record of what Jade hands Claude Code (command line, environment, the contents of the settings files, the approval-tool config and the system prompt, the connection check's web request) for every connection type, model choice and kind of run, and compares it with `test/fixtures/provider-parity-gateway.json` and `test/fixtures/provider-parity-plan.json`. A change to what is sent needs a re-record, and a re-record needs a reason in the commit message and a read of the diff. `test/fixtures/README.md` says what is pinned, how to re-record and how to read a failure. Two extra read refusals (for `engine.env` and the `.state` folder) were intended additions to the original behaviour, and are in the fixtures. The one-line rule is in `AGENTS.md`.

## Consequences

- A change to those three files is slow on purpose: it shows up as a fixture diff that a person must explain.
- The test cannot prove Claude Code accepts the flags, and it does not run on Windows quoting; it proves only that Jade's output has not changed.
- The test runs about 1,300 stand-in processes, in four parts side by side (`scripts/parity-harness.mjs --shard`), and takes about a minute on an idle machine.
- Any other change that touches these files may change only what it names (for example the key moved out of the tool settings; the per-run file path changed from `.state/tmp` to `.state/run`, and the fixtures were re-recorded with only that change).

## How to tell if this should be revisited

Revisit if a Bedrock machine becomes available to test on (then a live check could sit beside the record), or if the fixtures are re-recorded so often that the diff is no longer read. Never delete or loosen the test to make a change pass.
