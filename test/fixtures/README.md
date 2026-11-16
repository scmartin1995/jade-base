# Provider parity fixtures

`provider-parity-gateway.json` and `provider-parity-plan.json` are the frozen record of what Jade hands Claude Code. They are checked by `test/provider-parity.test.js`, which builds the same record again from the current code and compares the two. A stand-in `claude` writes down what it was given; no real `claude` runs and nothing leaves the machine.

Why it matters: on Amazon Bedrock or a company gateway, a small change in what Jade sends (a model name, a variable, a setting) can make every request fail, and nobody on the team can see why. This test makes that change visible before it ships.

## What the fixtures pin

The record is made for 4 connection types (Anthropic key, Bedrock with a key, Bedrock through a gateway, an Anthropic-format gateway; the plain-login record covers the Claude plan) times 4 sets of model pins, with and without a discovered model list, times 8 model choices, for each kind of run: a chat reply, an agent run (read-only), an agent run with edits, a locked-down judge run, a chat reply with edits, and the connection check.

For every run (`runs`):

- `argv`: the full command line Claude Code is started with (temp folders replaced by `<JADE_HOME>`, `<TMP>`, `<APP>`).
- `files`: the contents of the files the command line only names: the tool settings (`engine-settings.json`), the MCP config (the approval tool), and the system prompt. Each text is kept once in `contents`, under a short hash; the test compares the text, so a failure shows the words that changed.
- `env`: the Claude and provider variables the child gets (the original record's field, kept as it was).
- `engineModel`: the model name Jade resolves for the choice.
- For `check` runs: the web request the connection check makes (`requests`) and its key headers (`requestHeaders`). The Bedrock-with-a-key check would call the real Amazon address, so the web call is answered by a stand-in and only written down.

Besides the runs:

- `fullEnvs`: the WHOLE environment the child gets, one per connection set-up, less the machine-specific names listed below. Proxy and certificate variables (`HTTPS_PROXY`, `NO_PROXY`, `SSL_CERT_FILE` and so on) are put in the parent on purpose, so a change that stops passing them on is seen.
- `extras`: scenarios the matrix does not cover. `ambient | ...`: the parent already holds `ANTHROPIC_*`, `AWS_*`, `CLAUDECODE` or the server key; the record shows which of them reach the engine. `other variables | ...`: every other provider variable Jade knows (Vertex, Foundry, Mantle, custom headers, region prefixes, caching and token settings). `bedrockKey check | ...`: the Bedrock-with-a-key check against each kind of answer. `inputs | ...`: folders, effort, sub-agents, a read-only run with no file reading, and a long system prompt.

The test also checks, apart from the fixtures, that a warm chat worker builds the same arguments, settings and system prompt as a cold start (apart from `--input-format stream-json`).

### Names left out of the whole-environment comparison

`PATH`, `HOME`, `TMPDIR`, `TEMP`, `TMP`, `PWD`, `OLDPWD`, `_`, `JADE_CLAUDE_HOME`: they hold the temp folders of this run, so they differ every time. `__CF_USER_TEXT_ENCODING` is added to every program macOS starts, so it is left out too. The list is `MACHINE_SPECIFIC` in `scripts/parity-harness.mjs`; keep it short. Everything else the child receives is compared. The harness builds its own parent environment (it does not inherit yours), so the record is the same on every machine. It includes `CLAUDE_EFFORT=medium` because the original record was made with it set.

### Windows: what the harness normalises

The record is the same on every system; the harness (`scripts/parity-harness.mjs`) hides what only Windows has, and nothing in the fixtures was changed for it.

- The stand-in `claude` is written by `test/helpers/stub.js`: on Windows a `.js` file with a `.cmd` shim next to it (found through `PATHEXT`), not a `#!` script. Its name never appears in the record.
- The child's environment needs `SystemRoot`, `ComSpec` and `PATHEXT` (so `cmd.exe` can start the shim) and `USERPROFILE` (where Windows programs look for the home folder). `WINDIR`, `SYSTEMDRIVE`, `HOMEDRIVE` and `HOMEPATH` are left out the same way. These names are in `WINDOWS_ONLY` in the harness and are removed from `fullEnvs` (case ignored). `PATH` also reaches `System32` there; `PATH` is already left out of the comparison.
- The temp folder is the real long path (not the 8.3 name `RUNNER~1`). A folder is replaced by its token (`<JADE_HOME>`, `<TMP>`, `<APP>`, `<NODE>`) in all three spellings (`C:\x`, `C:/x`, and `C:\\x` inside a JSON string), and the rest of such a path gets `/` for `\`, so a Windows path reads like the Linux one.
- Each part has 8 minutes on Windows (starting a `.cmd` shim is slower than a script).

## What is NOT pinned

Whether the real Claude Code accepts these flags and variables. Nothing here runs a real `claude`; it only proves that Jade's output has not changed. The Windows command quoting is not covered either.

## How to read a failure (for someone on a Bedrock machine)

The failure names the cell, for example `bedrockGateway | all | discovered | agentEdit | "opus"`: connection type, model pins, model list, kind of run, model choice. Then it shows what changed, in the old (expected) and new (actual) form.

1. A different model name or a missing `--model`: the way Jade maps a choice to a model changed. On a gateway or Bedrock this decides whether a request is accepted. Do not re-record until you know why.
2. A different `files.settings`, `files.mcp` or `files.system`: what is inside a file handed to Claude Code changed (for example a tool setting, the approval tool, or the system prompt wording).
3. A changed `fullEnv`: a variable was added, dropped or renamed. A missing proxy or certificate variable means a corporate network may stop working.
4. A changed `ambient | ...` scenario: a variable that was cleared now gets through (or the other way round).
5. A different `requests` or `requestHeaders`: the connection check calls a different address or sends the key a different way.
6. "warm and cold arguments differ": a chat reply and an agent run no longer start Claude Code the same way. Fix the code; this is never a reason to re-record.

If the change is the one you meant to make, re-record, and look through the diff of the fixture before you commit it. Do not accept a diff you cannot explain.

## How to re-record

The record is built from the current code, so first make sure the code is the code you want:

```
node scripts/parity-harness.mjs . /tmp/gateway.json                # the gateway and Bedrock record; --shard=K/N records one part
node scripts/parity-harness.mjs . /tmp/plan.json --plan            # the plain-login record
```

The gateway record is large; the test splits it into parts and runs them side by side (`--shard=1/4` ... `--shard=4/4`, each with its own `JADE_HOME` and `JADE_CLAUDE_HOME`, then the `envs`, `fullEnvs`, `contents`, `extras` and `runs` of the parts are joined in order). To re-record in one go, run the harness without `--shard`, which takes a few minutes. Copy the result over the fixture and run `npm run test:one -- test/provider-parity.test.js`.

To prove a re-record only added things: for every run in the old fixture, every field the old fixture has must be byte-identical in the new one (`argv`, `env`, `engineModel`, `requests`, `err`). Only new fields and new runs may appear. Say so in the commit message.

The other fixtures in this folder (`filing-fixtures.json`, `meetings/`, `transcripts/`) belong to other tests.
