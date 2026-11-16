---
status: accepted
---
# The memory index is built in the background, in slices

## Context

The search index read every text file of every project folder in one block when Jade started. On a large project folder the server did not answer anything for 20 to 30 seconds, and a saved note could stop it for 5 to 16 seconds while the index was rebuilt.

## Decision

The index is built after the server is listening, in short slices (about 12 ms of work, then other requests get their turn). Only one build runs at a time and a second request joins the running one. What was read is remembered per file, keyed by size and modified time, so an unchanged folder costs one stat per file. A saved file updates only that file (and the word counts are kept in step), and a PDF with no text is remembered as empty instead of being read again. Pages that depend on the index say "still reading your files" while it is not finished, and the file list is paged. The folder watches are put in place in short turns too, and the memory index and the file map share one set of watches per folder.

## Consequences

- Jade answers its first request at once on any size of folder; a first search may see only part of the files until the first pass ends.
- The index lives in memory only, so every start reads the files again (in the background). Keeping it on disk was not done: it would need its own versioning and could go stale unseen.
- The index holds at most 8,000 files; a file under two folders is indexed once.

## How to tell if this should be revisited

Revisit if people wait too long for the first pass on their folders (then keep the index on disk, checked by size and modified time), or if the 8,000-file limit cuts off real material.
