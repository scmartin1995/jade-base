---
status: accepted
---
# Remembered lists are checked against the disk, not against a clock

## Context

The file list was thrown away and read again every 60 seconds, however little had changed, and read in one block (8 to 13 seconds on a 20,000-file project). Notes and actions were read again on every request. Faster answers had to stay right: a list that is out of date is worse than a slow one.

## Decision

A list that Jade remembers (the file map, the file ring, notes, actions) is kept together with what it was made from, and is used only while that is still true:

- The file map is a tree, folder by folder. A watcher marks the folder where something changed, and only that folder is read again. The remembered list is never allowed to be staler than the plain check (looking at the disk about once a minute was the old behaviour). Wherever watching cannot be trusted (a watch could not be put in place, the limit of watched folders was reached, a watched folder was deleted and made again) the file map falls back to checking the disk. A full read is also done now and then as a safety net. Until the watches are all in place the folder counts as unwatched.
- Notes and actions are kept with each file's size, modified time and file number; every use checks them (a stat per file), so edits made outside Jade are seen at once and only changed files are read.
- The file ring keeps each file's class until the file, a correction or the rules change.
- Every remembered thing has a size limit (see `docs/PERFORMANCE.md`), and is dropped with the folder or project it belongs to.
- A test for each compares the fast answer with a fresh full read after a file is added, changed, renamed and deleted.

## Consequences

- A change is visible when it happens, not up to a minute later, and an unchanged tree costs almost nothing.
- An edit that keeps a file's size, modified time and file number the same cannot be seen until the next full read (a tool that restores times and rewrites in place with equal length).
- Two programs saving the same actions file within a few milliseconds: the last writer wins.

## How to tell if this should be revisited

Revisit if people report a list that stays out of date, or if a folder cannot be watched on their system and the one-minute check is too slow for them.
