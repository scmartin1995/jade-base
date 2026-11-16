---
status: accepted
---
# Deferred on purpose

Three pieces of work were found by the architecture review and left alone. Each is real and may be worth doing. Each has a trigger: do it when the trigger happens, not before.

## Moving the remaining routes out of `server/api.js`

**Context.** New modules (meetings, dashboards, dreams, set-up) register their routes inside their own manifest. The original features (projects, notes, actions, chats, skills, agents, jobs, files, memory, voice, bridge) still have their routes in one file, `server/api.js`, and their manifests are short stubs. That means two ways to add a route, and api.js changes in most commits. A switched-off module is guarded either way (`modules.only` in `api.js`, the guarded `on` in a manifest; see `docs/EXTENDING.md`).

**Decision.** Leave them. Moving routes is a large mechanical change that touches the file with the most history, and nothing is broken by it. `api.js` is also re-imported on change in development (`server/index.js`), and any move must keep an equivalent.

**Do it when:** a feature's routes need a rule of their own that does not fit in `api.js` (for example a second feature needing the same module guard in a new way), or when two people keep editing `api.js` at once and colliding.

## Splitting `server/core/store.js`

**Context.** `store.js` holds projects, actions, notes, remembered facts, chat threads, pasted attachments and a general key-value state file that other features also use (outputs, Dreams). It has many importers and others reach into its folders.

**Decision.** Leave it. The parts do not depend on each other, so splitting concentrates no new idea; the gain is smaller churn. The project-folder part was already moved out (`docs/adr/0012-one-module-knows-project-locations.md`).

**Do it when:** a change to chats forces a change to notes (or the reverse) more than once, or when `store.dirs` reach-ins cause a bug. Split chats and attachments first.

## A browser test harness

**Context.** Front-end code is plain ES modules with no test harness. Views are tested by rendering into a stand-in root with a stand-in api (`test/dashboard-views.test.js`, `test/meetings-views.test.js`); the `pages` gate opens every page in headless Chromium and fails on console errors. There are no interaction tests that click through a page. Adding a harness would need a browser library or a large local one, which `docs/adr/0001-no-dependencies.md` rules out for now.

**Decision.** Rely on the stand-in views, the pages gate and the rule that views never import the browser shell (`scripts/gates/imports.mjs`).

**Do it when:** a bug ships that a click-through test would have caught, twice; or the front end grows a flow too stateful to cover with a stand-in root (the chat work panel is the likeliest). Then add a small local harness over the Chrome DevTools protocol that the `pages` gate already speaks (`scripts/gates/lib.mjs`), rather than a dependency.
