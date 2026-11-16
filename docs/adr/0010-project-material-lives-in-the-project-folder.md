---
status: accepted
---
# A project's material lives in the project folder

## Context

Jade began with everything under one data folder. Project managers keep their project work in shared drives and synced folders, and want the notes, meeting records and dashboards to sit with the project, be found by their other tools, and stay when Jade is removed.

## Decision

Everything that belongs to a project is kept in the **Jade folder** inside its first folder (`<project folder>/Jade`, named by `storage.folderName`): transcripts and records in `Meetings/`, dashboards in `Dashboards/`, notes in `Notes/`, and the action list in `actions.json`. The data folder holds only what belongs to Jade itself (settings, projects without a folder, chats, agent state). A folder that is missing, read-only, or refuses a write (a sync folder that is offline) does not block the work: Jade keeps that project's material in the data folder and says so on the project page (`server/core/locations.js` decides, `server/core/store.js` writes). Everything reads and writes through `server/core/locations.js` (`docs/adr/0012-one-module-knows-project-locations.md`).

## Consequences

- The PM can open, search, back up and share a project's records with ordinary tools. Records are plain Markdown and JSON.
- A project that moves between a usable folder and the data folder has records in two places; Jade does not merge them.
- Reading must not create folders. Readers use the non-creating path (`pathFor`, `store.projectPath`); only writers make folders (`dirFor`, `store.projectDir`).
- Jade edits files under the PM's home folder and any folder added under Settings, in the permission mode chosen (`docs/SECURITY.md`).

## How to tell if this should be revisited

Revisit if project folders on network drives are slow enough to make Jade feel slow, or if people want one project's records in more than one place. Splitting by place would change `locations.js` first.
