---
status: accepted
---
# A watcher is closed when its folder is gone, or when it floods

## Context

On Windows with Node 22 and 24, when a folder watched with `fs.watch` is deleted, the watcher reports `rename` again and again without end (about 800,000 events in 12 seconds were counted). That spins the processor and keeps the process from ever exiting. Node 20 does not do this. It was found because a test file never finished on those machines; the same fault would hit a person who deletes or moves a project folder while Jade runs.

## Decision

Every long-lived `fs.watch` in the server goes through `guardedWatch` in `server/core/util.js` (project folders in `store.js`, the agent and plugin folders in `agents.js`, the file trees in `watchTree`, the Claude settings file in `index.js`). In its callback it closes the watcher when the folder no longer exists, and also when more than 500 events (2,000 for a whole-tree watch) arrive within one second. The owner is told why and forgets the watcher, so the folder is watched again if it comes back: project folders are looked at again every few seconds for a while, file trees fall back to checking the disk (the list is no longer believed to be watched), and the agent watches are armed again.

## Consequences

- A deleted folder costs one event, not a spin, and the process can exit.
- A folder that is deleted and made again at once is still the same watch (it exists when the event arrives); the file tree already notices the new folder and watches it afresh.
- A real flood of changes (a build writing thousands of files a second) closes that watcher and the list is then checked on the disk instead, which is slower but never wrong.

## How to tell if this should be revisited

Revisit if a list stays out of date after a busy build, or when the platforms no longer report endless events for a deleted folder.
